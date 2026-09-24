// ============ 批次存档层 ============
// 任务、检测版本、报告的状态机与本地持久化；不写任何判定规则（调用 rules），
// 也不涉及任何 DOM 组件（只暴露 Hook）。

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type {
  ArchiveData,
  Order,
  Sample,
  SampleSpec,
  TestEntry,
  TestVersion,
} from "./types";
import { evaluateVersion, orderSnapshot, sampleStatus } from "./rules";

const STORAGE_KEY = "colorfastness-archive-v1";

declare global {
  interface crypto {
    randomUUID?: () => string;
  }
}

export function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---------- 动作 ----------

type Action =
  | { type: "createOrder"; order: Order }
  | { type: "createSample"; sample: Sample }
  | { type: "updateSpec"; sampleId: string; field: keyof SampleSpec; value: string }
  | { type: "updateEntry"; sampleId: string; entry: TestEntry }
  | { type: "submit"; sampleId: string; at: number }
  | { type: "generateReport"; sampleId: string; at: number }
  | { type: "resetSeed" };

const SPEC_FIELD_REASON: Record<keyof SampleSpec, string> = {
  composition: "面料成分",
  recipe: "染料配方",
  finish: "后整理",
};

function currentVersion(sample: Sample): TestVersion {
  return sample.versions[sample.versions.length - 1];
}

function makeVersion(
  sampleCode: string,
  versionNo: number,
  order: Order,
  spec: SampleSpec,
  now: number,
): TestVersion {
  return {
    id: uid(),
    versionNo,
    spec,
    requirement: orderSnapshot(order),
    entries: [],
    createdAt: now,
    updatedAt: now,
    submitted: false,
    voidReason: null,
    report: null,
  };
}

export function reducer(state: ArchiveData, action: Action): ArchiveData {
  switch (action.type) {
    case "createOrder":
      return { ...state, seq: state.seq + 1, orders: [...state.orders, action.order] };

    case "createSample":
      return { ...state, seq: state.seq + 1, samples: [...state.samples, action.sample] };

    case "updateSpec": {
      return {
        ...state,
        samples: state.samples.map((sample) => {
          if (sample.id !== action.sampleId) return sample;
          const order = state.orders.find((o) => o.id === sample.orderId)!;
          const cur = currentVersion(sample);
          const now = Date.now();

          // 草稿：直接改；一旦提交过（含已出报告）：旧版本与报告作废，开新版本
          if (!cur.submitted) {
            const versions = sample.versions.slice(0, -1);
            versions.push({
              ...cur,
              spec: { ...cur.spec, [action.field]: action.value },
              updatedAt: now,
            });
            return { ...sample, versions };
          }

          const reason = `${SPEC_FIELD_REASON[action.field]}调整：${cur.spec[action.field] || "（空）"} → ${action.value || "（空）"}`;
          const voided: TestVersion = {
            ...cur,
            voidReason: reason,
            report: cur.report ? { ...cur.report, voidReason: reason } : null,
          };
          const next = makeVersion(
            sample.code,
            cur.versionNo + 1,
            order,
            { ...cur.spec, [action.field]: action.value },
            now,
          );
          return { ...sample, versions: [...sample.versions.slice(0, -1), voided, next] };
        }),
      };
    }

    case "updateEntry": {
      return {
        ...state,
        samples: state.samples.map((sample) => {
          if (sample.id !== action.sampleId) return sample;
          const cur = currentVersion(sample);
          const now = Date.now();
          const idx = cur.entries.findIndex((e) => e.itemKey === action.entry.itemKey);
          const entries =
            idx >= 0
              ? cur.entries.map((e) => (e.itemKey === action.entry.itemKey ? action.entry : e))
              : [...cur.entries, action.entry];
          const versions = sample.versions.slice(0, -1);
          // 已出报告的版本冻结，不允许改录入
          if (cur.report) return sample;
          versions.push({ ...cur, entries, updatedAt: now });
          return { ...sample, versions };
        }),
      };
    }

    case "submit": {
      return {
        ...state,
        samples: state.samples.map((sample) => {
          if (sample.id !== action.sampleId) return sample;
          const cur = currentVersion(sample);
          if (cur.voidReason || cur.report) return sample;
          const versions = sample.versions.slice(0, -1);
          versions.push({ ...cur, submitted: true, updatedAt: action.at });
          return { ...sample, versions };
        }),
      };
    }

    case "generateReport": {
      return {
        ...state,
        samples: state.samples.map((sample) => {
          if (sample.id !== action.sampleId) return sample;
          const cur = currentVersion(sample);
          if (cur.report || cur.voidReason || !evaluateVersion(cur).pass) return sample;
          const report = {
            no: `BG-${new Date(action.at).getFullYear()}-${String(state.seq).padStart(3, "0")}`,
            seq: state.seq,
            generatedAt: action.at,
            voidReason: null,
          };
          const versions = sample.versions.slice(0, -1);
          versions.push({ ...cur, report });
          return { ...sample, versions };
        }),
      };
    }

    case "resetSeed":
      return seedData();

    default:
      return state;
  }
}

// ---------- 选择器 ----------

export interface SampleRow {
  sample: Sample;
  order: Order | undefined;
  current: TestVersion;
  status: ReturnType<typeof sampleStatus>;
}

export function toRow(sample: Sample, orders: Order[]): SampleRow {
  const current = sample.versions[sample.versions.length - 1];
  return {
    sample,
    order: orders.find((o) => o.id === sample.orderId),
    current,
    status: sampleStatus(current),
  };
}

// ---------- 种子数据 ----------

export function seedData(): ArchiveData {
  const now = Date.now();
  const day = 86400000;

  const order1: Order = {
    id: uid(),
    code: "NK-2409-018",
    customer: "南棉服饰",
    createdAt: now - 6 * day,
    requiredItems: ["washing", "rubbing", "perspiration"],
    minGrades: {
      washing: { change: 3.5, stain: 3.5 },
      rubbing: { change: 3, stain: 2.5 },
      perspiration: { change: 3.5, stain: 3.5 },
    },
  };
  const order2: Order = {
    id: uid(),
    code: "DL-2409-031",
    customer: "涤纶世家",
    createdAt: now - 3 * day,
    requiredItems: ["washing", "rubbing", "perspiration", "light"],
    minGrades: {
      washing: { change: 4, stain: 3.5 },
      rubbing: { change: 3, stain: 3 },
      perspiration: { change: 3.5, stain: 3 },
      light: { change: 4, stain: 4 },
    },
  };

  // 小样 A：旧版已出报告，因后整理调整作废；新版检测中、卡在缺项和湿摩低分
  const v1Spec = { composition: "棉100% 府绸", recipe: "活性红3BS 1.8% / 元明粉40g/L", finish: "预缩" };
  const v1: TestVersion = {
    id: uid(),
    versionNo: 1,
    spec: v1Spec,
    requirement: orderSnapshot(order1),
    entries: [
      { itemKey: "washing", direction: "经向", condition: "40℃ × 30min，皂片5g/L", gradeA: { change: 4, stain: 4 }, gradeB: { change: 4, stain: 3.5 }, remark: "" },
      { itemKey: "rubbing", direction: "经向", condition: "摩擦头压力9N，10次", gradeA: { change: 3.5, stain: 3 }, gradeB: { change: 3.5, stain: 3 }, remark: "" },
      { itemKey: "perspiration", direction: "经向", condition: "碱性汗液，37℃ × 4h", gradeA: { change: 4, stain: 3.5 }, gradeB: { change: 3.5, stain: 3.5 }, remark: "" },
    ],
    createdAt: now - 5 * day,
    updatedAt: now - 4 * day,
    submitted: true,
    voidReason: "后整理调整：预缩 → 柔软整理2%",
    report: {
      no: "BG-2026-001",
      seq: 1,
      generatedAt: now - 4 * day,
      voidReason: "后整理调整：预缩 → 柔软整理2%",
    },
  };
  const v2: TestVersion = {
    id: uid(),
    versionNo: 2,
    spec: { ...v1Spec, finish: "柔软整理2%" },
    requirement: orderSnapshot(order1),
    entries: [
      { itemKey: "rubbing", direction: "经向", condition: "摩擦头压力9N，10次", gradeA: { change: 3.5, stain: 2.5 }, gradeB: { change: 3, stain: 2 }, remark: "湿摩明显沾色" },
    ],
    createdAt: now - 2 * day,
    updatedAt: now - day,
    submitted: true,
    voidReason: null,
    report: null,
  };
  const sampleA: Sample = {
    id: uid(),
    code: "LAB-0918-A",
    orderId: order1.id,
    createdAt: now - 5 * day,
    versions: [v1, v2],
  };

  // 小样 B：已合格出报告
  const vB: TestVersion = {
    id: uid(),
    versionNo: 1,
    spec: { composition: "棉100% 针织", recipe: "活性黄3RS 1.2%", finish: "预缩" },
    requirement: orderSnapshot(order1),
    entries: [
      { itemKey: "washing", direction: "纬向", condition: "40℃ × 30min，皂片5g/L", gradeA: { change: 4, stain: 4 }, gradeB: { change: 4, stain: 4 }, remark: "" },
      { itemKey: "rubbing", direction: "纬向", condition: "摩擦头压力9N，10次", gradeA: { change: 4, stain: 3 }, gradeB: { change: 3.5, stain: 3 }, remark: "" },
      { itemKey: "perspiration", direction: "纬向", condition: "酸性汗液，37℃ × 4h", gradeA: { change: 4, stain: 4 }, gradeB: { change: 4, stain: 3.5 }, remark: "" },
    ],
    createdAt: now - 3 * day,
    updatedAt: now - 2 * day,
    submitted: true,
    voidReason: null,
    report: { no: "BG-2026-002", seq: 2, generatedAt: now - 2 * day, voidReason: null },
  };
  const sampleB: Sample = { id: uid(), code: "LAB-0918-B", orderId: order1.id, createdAt: now - 3 * day, versions: [vB] };

  // 小样 C：刚建任务的草稿
  const sampleC: Sample = {
    id: uid(),
    code: "LAB-0931-A",
    orderId: order2.id,
    createdAt: now,
    versions: [
      {
        id: uid(),
        versionNo: 1,
        spec: { composition: "涤纶100% 机织", recipe: "分散蓝HBG 2.5%，130℃×30min", finish: "定型170℃" },
        requirement: orderSnapshot(order2),
        entries: [],
        createdAt: now,
        updatedAt: now,
        submitted: false,
        voidReason: null,
        report: null,
      },
    ],
  };

  return { seq: 3, orders: [order1, order2], samples: [sampleA, sampleB, sampleC] };
}

function load(): ArchiveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ArchiveData;
  } catch {
    /* 存档损坏则重建 */
  }
  return seedData();
}

// ---------- Context ----------

interface ArchiveContextValue {
  data: ArchiveData;
  dispatch: React.Dispatch<Action>;
}

const ArchiveContext = createContext<ArchiveContextValue | null>(null);

export function ArchiveProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* 存储空间不足时忽略 */
    }
  }, [data]);

  const value = useMemo(() => ({ data, dispatch }), [data]);
  return <ArchiveContext.Provider value={value}>{children}</ArchiveContext.Provider>;
}

export function useArchive(): ArchiveContextValue {
  const ctx = useContext(ArchiveContext);
  if (!ctx) throw new Error("useArchive 必须在 ArchiveProvider 内使用");
  return ctx;
}
