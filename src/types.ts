// ============ 数据模型：色牢度检测台 ============

/** 灰卡评级：1 ~ 5，步进 0.5（3.5 即纺织行业常说的 "3-4" 级） */
export type Grade = number;

/** 检测结果的评定类别 */
export type ResultKind = "change" | "stain";

export const RESULT_KIND_LABEL: Record<ResultKind, string> = {
  change: "变色",
  stain: "沾色",
};

/** 检测项目定义（检测规则层的静态目录） */
export interface ItemDef {
  key: string;
  name: string;
  standard: string;
  /** 该项目需要评定的结果类别 */
  kinds: ResultKind[];
  /** 订单未单独设置时的默认最低评级 */
  defaultMin: Record<ResultKind, Grade>;
}

/** 订单：客户 + 必检项目 + 各项最低评级 */
export interface Order {
  id: string;
  code: string;
  customer: string;
  createdAt: number;
  /** 必检项目 key 列表 */
  requiredItems: string[];
  /** 每个必检项目、每个结果类别的最低评级 */
  minGrades: Record<string, Partial<Record<ResultKind, Grade>>>;
}

/** 订单要求快照（随检测版本保存，改订单要求不影响历史版本） */
export interface RequirementSnapshot {
  requiredItems: string[];
  minGrades: Record<string, Partial<Record<ResultKind, Grade>>>;
}

/** 单个检测项目的录入 */
export interface TestEntry {
  itemKey: string;
  /** 试样方向 */
  direction: string;
  /** 试验条件（自由文本） */
  condition: string;
  /** 复测一 / 复测二 的评级（按结果类别） */
  gradeA: Partial<Record<ResultKind, Grade>>;
  gradeB: Partial<Record<ResultKind, Grade>>;
  remark: string;
}

/** 小样规格：成分 / 配方 / 后整理，任一改动即作废旧检测 */
export interface SampleSpec {
  composition: string;
  recipe: string;
  finish: string;
}

/** 检测报告 */
export interface Report {
  no: string;
  seq: number;
  generatedAt: number;
  /** 报告作废原因；null 表示有效 */
  voidReason: string | null;
}

/** 检测版本：一条小样在某一规格下的完整检测记录 */
export interface TestVersion {
  id: string;
  versionNo: number;
  spec: SampleSpec;
  requirement: RequirementSnapshot;
  entries: TestEntry[];
  createdAt: number;
  updatedAt: number;
  /** 是否已提交判定（未提交=草稿，不计入状态） */
  submitted: boolean;
  /** 作废原因；null 表示当前有效版本 */
  voidReason: string | null;
  report: Report | null;
}

/** 小样（检测任务） */
export interface Sample {
  id: string;
  code: string;
  orderId: string;
  createdAt: number;
  versions: TestVersion[];
}

/** 整个存档 */
export interface ArchiveData {
  seq: number;
  orders: Order[];
  samples: Sample[];
}

// ============ 派生结果（检测规则层输出） ============

export type BlockerKind = "missing" | "incomplete" | "below";

export interface Blocker {
  kind: BlockerKind;
  itemKey: string;
  itemName: string;
  detail: string;
}

export interface VersionEval {
  blockers: Blocker[];
  /** 每个必检项目当前有效评级（两次复测取低）；未录入为 null */
  minGrades: Record<string, Partial<Record<ResultKind, Grade | null>>>;
  /** 所有有效评级中的最低分 */
  lowest: Grade | null;
  pass: boolean;
}

export type SampleStatus = "draft" | "improve" | "pass" | "reported";

export const STATUS_LABEL: Record<SampleStatus, string> = {
  draft: "进行中",
  improve: "待改善",
  pass: "合格",
  reported: "已出报告",
};
