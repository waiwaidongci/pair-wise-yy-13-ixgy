// ============================================================
// 批次存档层：订单、检测批次、检测记录与整单报告的存放，
// 负责版本作废、历史保留和 localStorage 持久化。
// 判定规则全部委托给 domain/fastness。
// ============================================================

import { useEffect, useState } from "react";
import {
  Direction,
  TestKey,
  evaluateBatch,
  itemDef,
  type BatchEvaluation,
} from "../domain/fastness";

// ---------- 实体 ----------

export interface Order {
  id: string;
  code: string; // 客户订单号
  customer: string;
  createdAt: number;
  requirements: Partial<Record<TestKey, number>>; // 必检项目 → 最低评级
}

export interface Batch {
  id: string;
  orderId: string;
  sampleCode: string; // 小样编号
  version: number; // 工艺版本，从 1 开始
  composition: string; // 面料成分
  recipe: string; // 染料配方
  finishing: string; // 后整理方式
  status: "active" | "superseded"; // 工艺一变，旧版本作废
  createdAt: number;
  supersededAt?: number;
  changeNote?: string; // 作废原因（哪项工艺变了）
}

export interface TestRecord {
  id: string;
  batchId: string;
  itemKey: TestKey;
  direction: Direction;
  condition: string; // 试验条件
  rating1: number | null; // 复测一
  rating2: number | null; // 复测二
  updatedAt: number;
}

export interface ReportItemSnapshot {
  itemKey: TestKey;
  name: string;
  direction: Direction;
  condition: string;
  rating1: number | null;
  rating2: number | null;
  final: number;
  required: number;
}

export interface Report {
  id: string;
  code: string; // 报告编号
  orderId: string;
  batchId: string;
  version: number; // 出具时的批次版本
  issuedAt: number;
  status: "valid" | "void"; // 批次作废后报告随之作废，但保留在历史里
  snapshot: {
    orderCode: string;
    customer: string;
    sampleCode: string;
    composition: string;
    recipe: string;
    finishing: string;
    conclusion: "合格";
    items: ReportItemSnapshot[];
  };
}

export interface ArchiveState {
  orders: Order[];
  batches: Batch[];
  records: TestRecord[];
  reports: Report[];
}

// ---------- 持久化 ----------

const STORAGE_KEY = "hxyfront-62012.fastness-archive.v1";

export function loadArchive(): ArchiveState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ArchiveState>;
      if (parsed && Array.isArray(parsed.orders) && Array.isArray(parsed.batches)) {
        return {
          orders: parsed.orders,
          batches: parsed.batches,
          records: parsed.records ?? [],
          reports: parsed.reports ?? [],
        };
      }
    }
  } catch {
    // 存档损坏时回到演示数据
  }
  return seedArchive();
}

export function saveArchive(state: ArchiveState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时静默失败，页面内数据仍在
  }
}

export function resetArchive(): ArchiveState {
  const fresh = seedArchive();
  saveArchive(fresh);
  return fresh;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- 查询 / 视图 ----------

export type TaskStatus = "improve" | "pass" | "reported" | "void";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  improve: "待改善",
  pass: "合格待出报告",
  reported: "已出报告",
  void: "已作废",
};

export interface TaskView {
  batch: Batch;
  order: Order | null;
  evaluation: BatchEvaluation;
  validReport: Report | null;
  status: TaskStatus;
}

export function recordsOf(state: ArchiveState, batchId: string): TestRecord[] {
  return state.records.filter((r) => r.batchId === batchId);
}

export function buildTaskView(state: ArchiveState, batch: Batch): TaskView {
  const order = state.orders.find((o) => o.id === batch.orderId) ?? null;
  const evaluation = evaluateBatch(order?.requirements ?? {}, recordsOf(state, batch.id));
  const validReport =
    state.reports.find((r) => r.batchId === batch.id && r.status === "valid") ?? null;
  let status: TaskStatus;
  if (batch.status === "superseded") status = "void";
  else if (validReport) status = "reported";
  else if (evaluation.pass) status = "pass";
  else status = "improve";
  return { batch, order, evaluation, validReport, status };
}

/** 同一订单同一小样的全部工艺版本，按版本号升序（历史链） */
export function versionHistory(state: ArchiveState, batch: Batch): Batch[] {
  return state.batches
    .filter((b) => b.orderId === batch.orderId && b.sampleCode === batch.sampleCode)
    .sort((a, b) => a.version - b.version);
}

export function reportsOfBatches(state: ArchiveState, batchIds: string[]): Report[] {
  return state.reports
    .filter((r) => batchIds.includes(r.batchId))
    .sort((a, b) => b.issuedAt - a.issuedAt);
}

// ---------- 页面可调用的存档动作 ----------

export interface RecordDraft {
  direction: Direction;
  condition: string;
  rating1: number | null;
  rating2: number | null;
}

export interface ArchiveActions {
  addOrder: (input: {
    code: string;
    customer: string;
    requirements: Partial<Record<TestKey, number>>;
  }) => string | null;
  addBatch: (input: {
    orderId: string;
    sampleCode: string;
    composition: string;
    recipe: string;
    finishing: string;
  }) => string | null;
  saveRecords: (batchId: string, drafts: Partial<Record<TestKey, RecordDraft>>) => void;
  reviseProcess: (
    batchId: string,
    process: { composition: string; recipe: string; finishing: string; note: string }
  ) => string | null;
  issueReport: (batchId: string) => string | null;
  resetAll: () => void;
}

export function useArchive(): { state: ArchiveState; actions: ArchiveActions } {
  const [state, setState] = useState<ArchiveState>(loadArchive);

  // 任何变动立即落盘，重开页面可接着做
  useEffect(() => {
    saveArchive(state);
  }, [state]);

  const actions: ArchiveActions = {
    addOrder({ code, customer, requirements }) {
      const trimmed = code.trim();
      if (!trimmed) return "请填写订单号";
      if (!customer.trim()) return "请填写客户名称";
      if (Object.keys(requirements).length === 0) return "请至少勾选一项必检项目";
      if (state.orders.some((o) => o.code === trimmed)) return `订单 ${trimmed} 已存在`;
      setState((s) => ({
        ...s,
        orders: [
          ...s.orders,
          { id: uid("O"), code: trimmed, customer: customer.trim(), createdAt: Date.now(), requirements },
        ],
      }));
      return null;
    },

    addBatch({ orderId, sampleCode, composition, recipe, finishing }) {
      const code = sampleCode.trim();
      if (!orderId) return "请选择客户订单";
      if (!code) return "请填写小样编号";
      if (!composition.trim()) return "请填写面料成分";
      if (
        state.batches.some((b) => b.orderId === orderId && b.sampleCode === code)
      )
        return `该订单下小样 ${code} 已存在，如需变更工艺请在任务里「变更工艺」`;
      setState((s) => ({
        ...s,
        batches: [
          ...s.batches,
          {
            id: uid("B"),
            orderId,
            sampleCode: code,
            version: 1,
            composition: composition.trim(),
            recipe: recipe.trim() || "—",
            finishing: finishing.trim() || "—",
            status: "active",
            createdAt: Date.now(),
          },
        ],
      }));
      return null;
    },

    saveRecords(batchId, drafts) {
      setState((s) => {
        const records = s.records.slice();
        (Object.keys(drafts) as TestKey[]).forEach((key) => {
          const draft = drafts[key];
          if (!draft) return;
          const existing = records.find((r) => r.batchId === batchId && r.itemKey === key);
          const untouched =
            !existing &&
            draft.rating1 == null &&
            draft.rating2 == null &&
            draft.direction === "经向" &&
            draft.condition === itemDef(key).defaultCondition;
          if (untouched) return; // 完全未动的行不建档，保持“未录入”
          if (existing) {
            const idx = records.indexOf(existing);
            records[idx] = { ...existing, ...draft, updatedAt: Date.now() };
          } else {
            records.push({
              id: uid("R"),
              batchId,
              itemKey: key,
              ...draft,
              updatedAt: Date.now(),
            });
          }
        });
        return { ...s, records };
      });
    },

    reviseProcess(batchId, process) {
      const batch = state.batches.find((b) => b.id === batchId);
      if (!batch) return "批次不存在";
      if (batch.status !== "active") return "已作废的版本不能再变更";
      const composition = process.composition.trim();
      const recipe = process.recipe.trim() || "—";
      const finishing = process.finishing.trim() || "—";
      if (!composition) return "请填写面料成分";
      if (
        composition === batch.composition &&
        recipe === batch.recipe &&
        finishing === batch.finishing
      )
        return "成分、配方、后整理均未变化，无需作废重建";
      const note =
        process.note.trim() ||
        `工艺变更：成分 ${batch.composition}→${composition}，配方 ${batch.recipe}→${recipe}，后整理 ${batch.finishing}→${finishing}`;
      const now = Date.now();
      setState((s) => ({
        ...s,
        batches: [
          // 旧版本作废，检测记录留在原批次上成为历史
          ...s.batches.map((b) =>
            b.id === batchId
              ? { ...b, status: "superseded" as const, supersededAt: now, changeNote: note }
              : b
          ),
          {
            id: uid("B"),
            orderId: batch.orderId,
            sampleCode: batch.sampleCode,
            version: batch.version + 1,
            composition,
            recipe,
            finishing,
            status: "active",
            createdAt: now,
          },
        ],
        // 旧版本已出具的报告一并作废，但保留在存档里
        reports: s.reports.map((r) =>
          r.batchId === batchId && r.status === "valid" ? { ...r, status: "void" as const } : r
        ),
      }));
      return null;
    },

    issueReport(batchId) {
      const view = (() => {
        const batch = state.batches.find((b) => b.id === batchId);
        return batch ? buildTaskView(state, batch) : null;
      })();
      if (!view) return "批次不存在";
      if (view.batch.status !== "active") return "已作废的版本不能出报告";
      if (view.validReport) return "该版本已出具过报告";
      if (!view.evaluation.pass) {
        const parts: string[] = [];
        if (view.evaluation.missing.length)
          parts.push(`缺项：${view.evaluation.missing.map((i) => i.def.short).join("、")}`);
        if (view.evaluation.failing.length)
          parts.push(`低于要求：${view.evaluation.failing.map((i) => i.def.short).join("、")}`);
        return `整单报告不能生成（${parts.join("；")}）`;
      }
      const { batch, order, evaluation } = view;
      const records = recordsOf(state, batchId);
      const report: Report = {
        id: uid("RP"),
        code: `CFR-${order!.code}-${batch.sampleCode}-V${batch.version}`,
        orderId: batch.orderId,
        batchId,
        version: batch.version,
        issuedAt: Date.now(),
        status: "valid",
        snapshot: {
          orderCode: order!.code,
          customer: order!.customer,
          sampleCode: batch.sampleCode,
          composition: batch.composition,
          recipe: batch.recipe,
          finishing: batch.finishing,
          conclusion: "合格",
          items: evaluation.items.map((i) => {
            const rec = records.find((r) => r.itemKey === i.def.key)!;
            return {
              itemKey: i.def.key,
              name: i.def.name,
              direction: rec.direction,
              condition: rec.condition,
              rating1: rec.rating1,
              rating2: rec.rating2,
              final: i.final!,
              required: i.required,
            };
          }),
        },
      };
      setState((s) => ({ ...s, reports: [...s.reports, report] }));
      return null;
    },

    resetAll() {
      setState(resetArchive());
    },
  };

  return { state, actions };
}

// ---------- 演示数据 ----------

function seedArchive(): ArchiveState {
  const t = Date.now();
  const day = 24 * 3600 * 1000;
  const orders: Order[] = [
    {
      id: "O-seed-1",
      code: "PO-2609-A",
      customer: "华纺服饰",
      createdAt: t - 9 * day,
      requirements: { wash: 4, rub_dry: 4, rub_wet: 3.5, persp: 4 },
    },
    {
      id: "O-seed-2",
      code: "PO-2609-B",
      customer: "晨曦家纺",
      createdAt: t - 6 * day,
      requirements: { wash: 4, rub_dry: 4, rub_wet: 3, persp: 3.5, water: 4 },
    },
  ];
  const batches: Batch[] = [
    {
      id: "B-seed-1",
      orderId: "O-seed-1",
      sampleCode: "LAB-101",
      version: 1,
      composition: "棉100% 府绸 120g/m²",
      recipe: "活性红3B 1.8% / 元明粉 40g/L",
      finishing: "常规定型",
      status: "superseded",
      createdAt: t - 8 * day,
      supersededAt: t - 3 * day,
      changeNote: "配方变更：活性红3B 1.8%→2.2%，追加柔软整理",
    },
    {
      id: "B-seed-2",
      orderId: "O-seed-1",
      sampleCode: "LAB-101",
      version: 2,
      composition: "棉100% 府绸 120g/m²",
      recipe: "活性红3B 2.2% / 元明粉 45g/L",
      finishing: "柔软整理 2%",
      status: "active",
      createdAt: t - 3 * day,
    },
    {
      id: "B-seed-3",
      orderId: "O-seed-1",
      sampleCode: "LAB-102",
      version: 1,
      composition: "涤棉 65/35 斜纹",
      recipe: "分散蓝2BLN 1.2% + 活性翠蓝 0.6%",
      finishing: "—",
      status: "active",
      createdAt: t - 2 * day,
    },
    {
      id: "B-seed-4",
      orderId: "O-seed-2",
      sampleCode: "LAB-201",
      version: 1,
      composition: "全棉针织 180g/m²",
      recipe: "活性黑KN-B 3.0%",
      finishing: "预缩整理",
      status: "active",
      createdAt: t - 5 * day,
    },
  ];
  const rec = (
    id: string,
    batchId: string,
    itemKey: TestKey,
    direction: Direction,
    condition: string,
    rating1: number,
    rating2: number,
    updatedAt: number
  ): TestRecord => ({ id, batchId, itemKey, direction, condition, rating1, rating2, updatedAt });
  const records: TestRecord[] = [
    // LAB-101 v1（已作废版本的历史检测）
    rec("R-s1", "B-seed-1", "wash", "经纬向", "GB/T 3921 A(1) 40℃×30min", 4, 4.5, t - 7 * day),
    rec("R-s2", "B-seed-1", "rub_dry", "经向", "GB/T 3920 干摩 往复10次", 4, 4, t - 7 * day),
    rec("R-s3", "B-seed-1", "rub_wet", "经向", "GB/T 3920 湿摩 含水率95%", 3.5, 4, t - 7 * day),
    rec("R-s4", "B-seed-1", "persp", "经纬向", "GB/T 3922 酸+碱 37℃×4h", 4, 4, t - 7 * day),
    // LAB-101 v2（当前版本：湿摩擦不达标 + 汗渍缺项 → 待改善）
    rec("R-s5", "B-seed-2", "wash", "经纬向", "GB/T 3921 A(1) 40℃×30min", 4, 4.5, t - 2 * day),
    rec("R-s6", "B-seed-2", "rub_dry", "经向", "GB/T 3920 干摩 往复10次", 4, 4, t - 2 * day),
    rec("R-s7", "B-seed-2", "rub_wet", "经向", "GB/T 3920 湿摩 含水率95%", 3, 3, t - 2 * day),
    // LAB-102（只录了耐洗，其余缺项）
    rec("R-s8", "B-seed-3", "wash", "经纬向", "GB/T 3921 A(1) 40℃×30min", 4, 4, t - 1 * day),
    // LAB-201（全部合格，已出报告）
    rec("R-s9", "B-seed-4", "wash", "经纬向", "GB/T 3921 A(1) 40℃×30min", 4.5, 4.5, t - 4 * day),
    rec("R-s10", "B-seed-4", "rub_dry", "经纬向", "GB/T 3920 干摩 往复10次", 4, 4.5, t - 4 * day),
    rec("R-s11", "B-seed-4", "rub_wet", "经纬向", "GB/T 3920 湿摩 含水率95%", 3.5, 4, t - 4 * day),
    rec("R-s12", "B-seed-4", "persp", "经纬向", "GB/T 3922 酸+碱 37℃×4h", 4, 4, t - 4 * day),
    rec("R-s13", "B-seed-4", "water", "经纬向", "GB/T 5713 浸渍 37℃×4h", 4.5, 4, t - 4 * day),
  ];
  const reports: Report[] = [
    {
      id: "RP-seed-1",
      code: "CFR-PO-2609-A-LAB-101-V1",
      orderId: "O-seed-1",
      batchId: "B-seed-1",
      version: 1,
      issuedAt: t - 7 * day,
      status: "void", // 配方变更后作废，历史保留
      snapshot: {
        orderCode: "PO-2609-A",
        customer: "华纺服饰",
        sampleCode: "LAB-101",
        composition: "棉100% 府绸 120g/m²",
        recipe: "活性红3B 1.8% / 元明粉 40g/L",
        finishing: "常规定型",
        conclusion: "合格",
        items: [
          { itemKey: "wash", name: "耐洗色牢度", direction: "经纬向", condition: "GB/T 3921 A(1) 40℃×30min", rating1: 4, rating2: 4.5, final: 4, required: 4 },
          { itemKey: "rub_dry", name: "耐摩擦色牢度（干）", direction: "经向", condition: "GB/T 3920 干摩 往复10次", rating1: 4, rating2: 4, final: 4, required: 4 },
          { itemKey: "rub_wet", name: "耐摩擦色牢度（湿）", direction: "经向", condition: "GB/T 3920 湿摩 含水率95%", rating1: 3.5, rating2: 4, final: 3.5, required: 3.5 },
          { itemKey: "persp", name: "耐汗渍色牢度", direction: "经纬向", condition: "GB/T 3922 酸+碱 37℃×4h", rating1: 4, rating2: 4, final: 4, required: 4 },
        ],
      },
    },
    {
      id: "RP-seed-2",
      code: "CFR-PO-2609-B-LAB-201-V1",
      orderId: "O-seed-2",
      batchId: "B-seed-4",
      version: 1,
      issuedAt: t - 4 * day,
      status: "valid",
      snapshot: {
        orderCode: "PO-2609-B",
        customer: "晨曦家纺",
        sampleCode: "LAB-201",
        composition: "全棉针织 180g/m²",
        recipe: "活性黑KN-B 3.0%",
        finishing: "预缩整理",
        conclusion: "合格",
        items: [
          { itemKey: "wash", name: "耐洗色牢度", direction: "经纬向", condition: "GB/T 3921 A(1) 40℃×30min", rating1: 4.5, rating2: 4.5, final: 4.5, required: 4 },
          { itemKey: "rub_dry", name: "耐摩擦色牢度（干）", direction: "经纬向", condition: "GB/T 3920 干摩 往复10次", rating1: 4, rating2: 4.5, final: 4, required: 4 },
          { itemKey: "rub_wet", name: "耐摩擦色牢度（湿）", direction: "经纬向", condition: "GB/T 3920 湿摩 含水率95%", rating1: 3.5, rating2: 4, final: 3.5, required: 3 },
          { itemKey: "persp", name: "耐汗渍色牢度", direction: "经纬向", condition: "GB/T 3922 酸+碱 37℃×4h", rating1: 4, rating2: 4, final: 4, required: 3.5 },
          { itemKey: "water", name: "耐水色牢度", direction: "经纬向", condition: "GB/T 5713 浸渍 37℃×4h", rating1: 4.5, rating2: 4, final: 4, required: 4 },
        ],
      },
    },
  ];
  return { orders, batches, records, reports };
}
