// 页面操作层：检测任务看板（筛选、新建任务、任务列表）
import { useMemo, useState } from "react";
import {
  TASK_STATUS_LABEL,
  buildTaskView,
  type ArchiveActions,
  type ArchiveState,
  type TaskStatus,
} from "../data/archive";
import TaskCard from "./TaskCard";

interface Props {
  state: ArchiveState;
  actions: ArchiveActions;
  orderFilter: string | "all";
  onOrderFilter: (id: string | "all") => void;
}

export default function TaskBoard({ state, actions, orderFilter, onOrderFilter }: Props) {
  const [statusFilter, setStatusFilter] = useState<"all" | TaskStatus>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const views = useMemo(
    () =>
      state.batches
        .map((b) => buildTaskView(state, b))
        .filter((v) => orderFilter === "all" || v.batch.orderId === orderFilter)
        .filter((v) => statusFilter === "all" || v.status === statusFilter)
        .sort((a, b) => {
          // 当前版本在前，作废版本在后；同类按创建时间倒序
          if ((a.batch.status === "active") !== (b.batch.status === "active"))
            return a.batch.status === "active" ? -1 : 1;
          return b.batch.createdAt - a.batch.createdAt;
        }),
    [state, orderFilter, statusFilter]
  );

  return (
    <section className="panel task-board">
      <div className="heading">
        <div>
          <p>检测任务</p>
          <h2>小样色牢度检测台</h2>
        </div>
        <button className="primary" onClick={() => setCreating((v) => !v)}>
          {creating ? "收起" : "新建检测任务"}
        </button>
      </div>

      {creating && (
        <NewTaskForm
          state={state}
          defaultOrderId={orderFilter === "all" ? "" : orderFilter}
          onSubmit={(input) => {
            const err = actions.addBatch(input);
            if (!err) setCreating(false);
            return err;
          }}
        />
      )}

      <div className="filters">
        <label>
          <span>按订单</span>
          <select
            value={orderFilter}
            onChange={(e) => onOrderFilter(e.target.value as string | "all")}
          >
            <option value="all">全部订单</option>
            {state.orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} · {o.customer}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>按状态</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | TaskStatus)}
          >
            <option value="all">全部状态</option>
            {(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <span className="muted filter-count">{views.length} 个任务</span>
      </div>

      <div className="task-list">
        {views.length === 0 && <p className="muted empty">没有符合筛选条件的检测任务。</p>}
        {views.map((v) => (
          <TaskCard
            key={v.batch.id}
            state={state}
            batch={v.batch}
            expanded={openId === v.batch.id}
            onToggle={() => setOpenId(openId === v.batch.id ? null : v.batch.id)}
            actions={actions}
          />
        ))}
      </div>
    </section>
  );
}

// ---------- 新建检测任务 ----------

function NewTaskForm({
  state,
  defaultOrderId,
  onSubmit,
}: {
  state: ArchiveState;
  defaultOrderId: string;
  onSubmit: (input: {
    orderId: string;
    sampleCode: string;
    composition: string;
    recipe: string;
    finishing: string;
  }) => string | null;
}) {
  const [orderId, setOrderId] = useState(defaultOrderId);
  const [sampleCode, setSampleCode] = useState("");
  const [composition, setComposition] = useState("");
  const [recipe, setRecipe] = useState("");
  const [finishing, setFinishing] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="sub-form">
      <div className="field-grid">
        <label>
          <span>客户订单（决定必检项目与最低评级）</span>
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">请选择订单</option>
            {state.orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} · {o.customer}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>小样编号</span>
          <input
            value={sampleCode}
            onChange={(e) => setSampleCode(e.target.value)}
            placeholder="如 LAB-103"
          />
        </label>
        <label>
          <span>面料成分</span>
          <input
            value={composition}
            onChange={(e) => setComposition(e.target.value)}
            placeholder="如 棉100% 府绸 120g/m²"
          />
        </label>
        <label>
          <span>染料配方</span>
          <input
            value={recipe}
            onChange={(e) => setRecipe(e.target.value)}
            placeholder="如 活性红3B 2.2% / 元明粉 45g/L"
          />
        </label>
        <label>
          <span>后整理方式</span>
          <input
            value={finishing}
            onChange={(e) => setFinishing(e.target.value)}
            placeholder="如 柔软整理 2%"
          />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <button
        className="primary"
        onClick={() => {
          const err = onSubmit({ orderId, sampleCode, composition, recipe, finishing });
          setError(err);
        }}
      >
        建立任务（v1）
      </button>
    </div>
  );
}
