// ============ 检测规则层 ============
// 纯函数：评级标准、必检项目目录、缺项 / 不达标判定、合格结论。
// 不接触 React 与 localStorage，页面层只调用这里的函数。

import type {
  Blocker,
  Grade,
  ItemDef,
  Order,
  RequirementSnapshot,
  ResultKind,
  TestEntry,
  TestVersion,
  VersionEval,
} from "./types";

/** 可选评级（灰卡） */
export const GRADE_OPTIONS: Grade[] = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1];

export function gradeLabel(g: Grade | null | undefined): string {
  if (g == null) return "—";
  return Number.isInteger(g) ? String(g) : `${Math.floor(g)}-${Math.ceil(g)}`;
}

/** 检测项目目录：耐洗、摩擦（干湿）、汗渍，外加两项常见必检 */
export const ITEM_DEFS: ItemDef[] = [
  {
    key: "washing",
    name: "耐洗色牢度",
    standard: "GB/T 3921",
    kinds: ["change", "stain"],
    defaultMin: { change: 3.5, stain: 3.5 },
  },
  {
    key: "rubbing",
    name: "耐摩擦色牢度",
    standard: "GB/T 3920",
    kinds: ["change", "stain"],
    defaultMin: { change: 3, stain: 3 },
  },
  {
    key: "perspiration",
    name: "耐汗渍色牢度",
    standard: "GB/T 3922",
    kinds: ["change", "stain"],
    defaultMin: { change: 3.5, stain: 3.5 },
  },
  {
    key: "light",
    name: "耐光色牢度",
    standard: "GB/T 8427",
    kinds: ["change"],
    defaultMin: { change: 4, stain: 4 },
  },
  {
    key: "water",
    name: "耐水色牢度",
    standard: "GB/T 5713",
    kinds: ["change", "stain"],
    defaultMin: { change: 3.5, stain: 3.5 },
  },
];

export const ITEM_MAP: Record<string, ItemDef> = Object.fromEntries(
  ITEM_DEFS.map((d) => [d.key, d]),
);

export function itemName(key: string): string {
  return ITEM_MAP[key]?.name ?? key;
}

/** 摩擦项目对结果类别的行业叫法：变色=干摩，沾色=湿摩 */
export function kindLabel(itemKey: string, kind: ResultKind): string {
  if (itemKey === "rubbing") {
    return kind === "change" ? "干摩" : "湿摩";
  }
  return kind === "change" ? "变色" : "沾色";
}

/** 订单对某项目某类别的最低要求：订单设置优先，缺省取目录默认 */
export function requiredMinGrade(
  req: RequirementSnapshot,
  itemKey: string,
  kind: ResultKind,
): Grade {
  const set = req.minGrades[itemKey]?.[kind];
  if (set != null) return set;
  return ITEM_MAP[itemKey].defaultMin[kind];
}

/** 两条复测评级的有效值：取低（行业按较差值评定）；缺一不可 */
function effectiveGrade(
  entry: TestEntry,
  kind: ResultKind,
): Grade | null {
  const a = entry.gradeA[kind];
  const b = entry.gradeB[kind];
  if (a == null || b == null) return null;
  return Math.min(a, b);
}

/**
 * 核心判定：一个检测版本对照订单要求。
 * 规则：
 *  1. 必检项目没有录入        → 缺项（missing）
 *  2. 录了但方向/条件/两次复测缺数据 → 资料不全（incomplete）
 *  3. 任一类别的有效评级低于订单最低评级 → 不达标（below）
 * 无任何 blocker 才算合格。
 */
export function evaluateVersion(version: TestVersion): VersionEval {
  const req = version.requirement;
  const blockers: Blocker[] = [];
  const minGrades: VersionEval["minGrades"] = {};
  let lowest: Grade | null = null;

  for (const itemKey of req.requiredItems) {
    const def = ITEM_MAP[itemKey];
    const entry = version.entries.find((e) => e.itemKey === itemKey);
    minGrades[itemKey] = {};

    if (!entry) {
      blockers.push({
        kind: "missing",
        itemKey,
        itemName: def.name,
        detail: "未做检测",
      });
      for (const k of def.kinds) minGrades[itemKey][k] = null;
      continue;
    }

    const fieldGaps: string[] = [];
    if (!entry.direction.trim()) fieldGaps.push("试样方向");
    if (!entry.condition.trim()) fieldGaps.push("试验条件");

    const gradeGaps: string[] = [];
    for (const kind of def.kinds) {
      const a = entry.gradeA[kind];
      const b = entry.gradeB[kind];
      if (a == null || b == null) {
        gradeGaps.push(
          `${kindLabel(itemKey, kind)}复测${a == null ? "一" : ""}${b == null ? "二" : ""}`,
        );
        minGrades[itemKey]![kind] = null;
      } else {
        const g = Math.min(a, b);
        minGrades[itemKey]![kind] = g;
        lowest = lowest == null ? g : Math.min(lowest, g);
        const need = requiredMinGrade(req, itemKey, kind);
        if (g < need) {
          blockers.push({
            kind: "below",
            itemKey,
            itemName: def.name,
            detail: `${kindLabel(itemKey, kind)} ${gradeLabel(g)} 级，低于订单要求 ${gradeLabel(need)} 级`,
          });
        }
      }
    }

    if (fieldGaps.length || gradeGaps.length) {
      blockers.push({
        kind: "incomplete",
        itemKey,
        itemName: def.name,
        detail: [...fieldGaps, ...gradeGaps].join("、") + " 未填",
      });
    }
  }

  return { blockers, minGrades, lowest, pass: blockers.length === 0 };
}

/** 保存时的状态：未提交→草稿；提交后无 blocker→合格，否则→待改善 */
export function sampleStatus(version: TestVersion | undefined) {
  if (!version || !version.submitted) return "draft" as const;
  if (version.report) return "reported" as const;
  return evaluateVersion(version).pass ? ("pass" as const) : ("improve" as const);
}

/** 合格且未作废时才允许生成整单报告 */
export function canReport(version: TestVersion | undefined): boolean {
  return (
    !!version &&
    version.submitted &&
    !version.voidReason &&
    evaluateVersion(version).pass
  );
}

export function orderSnapshot(order: Order): RequirementSnapshot {
  return {
    requiredItems: [...order.requiredItems],
    minGrades: JSON.parse(JSON.stringify(order.minGrades)),
  };
}
