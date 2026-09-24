// ============================================================
// 检测规则层：色牢度项目目录、评级刻度、合格判定。
// 只接收数据、返回判定结果，不接触存储与页面。
// ============================================================

export type TestKey = "wash" | "rub_dry" | "rub_wet" | "persp" | "water" | "light";

export interface TestItemDef {
  key: TestKey;
  name: string; // 完整名称
  short: string; // 列表简称
  defaultCondition: string; // 默认试验条件
}

/** 必检项目目录：摩擦固定拆分为干 / 湿两项 */
export const TEST_CATALOG: TestItemDef[] = [
  { key: "wash", name: "耐洗色牢度", short: "耐洗", defaultCondition: "GB/T 3921 A(1) 40℃×30min" },
  { key: "rub_dry", name: "耐摩擦色牢度（干）", short: "干摩擦", defaultCondition: "GB/T 3920 干摩 往复10次" },
  { key: "rub_wet", name: "耐摩擦色牢度（湿）", short: "湿摩擦", defaultCondition: "GB/T 3920 湿摩 含水率95%~100%" },
  { key: "persp", name: "耐汗渍色牢度", short: "汗渍", defaultCondition: "GB/T 3922 酸液+碱液 37℃×4h" },
  { key: "water", name: "耐水色牢度", short: "耐水", defaultCondition: "GB/T 5713 浸渍 37℃×4h" },
  { key: "light", name: "耐光色牢度", short: "耐光", defaultCondition: "GB/T 8427 方法2 蓝标4级" },
];

export function itemDef(key: TestKey): TestItemDef {
  return TEST_CATALOG.find((d) => d.key === key)!;
}

/** 试样方向 */
export const DIRECTIONS = ["经向", "纬向", "经纬向"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** 色牢度评级刻度：1~5 级，半级一档 */
export const RATING_STEPS: number[] = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

/** 评级显示：3.5 → "3-4"，4 → "4" */
export function ratingLabel(v: number | null | undefined): string {
  if (v == null) return "—";
  return v % 1 !== 0 ? `${Math.floor(v)}-${Math.ceil(v)}` : String(v);
}

/** 判定所需的最小记录形状（存档层的 TestRecord 天然满足） */
export interface RatingRecordLike {
  itemKey: TestKey;
  rating1: number | null;
  rating2: number | null;
}

/** 两条复测取低值作为该项最终评级；未录全则不算完成 */
export function finalRating(r: RatingRecordLike): number | null {
  if (r.rating1 == null || r.rating2 == null) return null;
  return Math.min(r.rating1, r.rating2);
}

export type ItemState = "missing" | "incomplete" | "fail" | "pass";

export const ITEM_STATE_LABEL: Record<ItemState, string> = {
  missing: "未录入",
  incomplete: "评级未录全",
  fail: "低于要求",
  pass: "合格",
};

export interface ItemEval {
  def: TestItemDef;
  required: number; // 订单最低评级
  record: RatingRecordLike | null;
  final: number | null;
  state: ItemState;
}

export interface BatchEvaluation {
  items: ItemEval[];
  missing: ItemEval[]; // 缺项：未录入或评级未录全
  failing: ItemEval[]; // 低于订单最低评级
  lowest: ItemEval | null; // 已完成项中的最低分
  doneCount: number; // 已完成（两条复测齐全）的项目数
  pass: boolean; // 全部必检项完成且达标 → 可出整单报告
}

/** 按订单必检要求判定一个批次的全部检测记录 */
export function evaluateBatch(
  requirements: Partial<Record<TestKey, number>>,
  records: RatingRecordLike[]
): BatchEvaluation {
  const items: ItemEval[] = TEST_CATALOG.filter((def) => requirements[def.key] != null).map(
    (def) => {
      const required = requirements[def.key]!;
      const record = records.find((r) => r.itemKey === def.key) ?? null;
      const final = record ? finalRating(record) : null;
      let state: ItemState;
      if (!record) state = "missing";
      else if (final == null) state = "incomplete";
      else if (final < required) state = "fail";
      else state = "pass";
      return { def, required, record, final, state };
    }
  );
  const missing = items.filter((i) => i.state === "missing" || i.state === "incomplete");
  const failing = items.filter((i) => i.state === "fail");
  const scored = items.filter((i) => i.final != null);
  const lowest =
    scored.length > 0
      ? scored.reduce((a, b) => ((a.final ?? 99) <= (b.final ?? 99) ? a : b))
      : null;
  return {
    items,
    missing,
    failing,
    lowest,
    doneCount: items.length - missing.length,
    pass: items.length > 0 && missing.length === 0 && failing.length === 0,
  };
}
