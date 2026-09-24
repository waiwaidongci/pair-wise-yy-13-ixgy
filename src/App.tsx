import { useMemo, useState } from "react";
import "./styles.css";
import { ArchiveProvider, toRow, useArchive } from "./archive";
import { evaluateVersion, gradeLabel } from "./rules";
import type { SampleStatus } from "./types";
import { OrderModal, SampleModal } from "./components/Modals";
import { SampleDetail, StatusBadge } from "./components/SampleDetail";

const UI_PREFS_KEY = "colorfastness-ui-v1";

const STATUS_FILTERS: { value: SampleStatus | "all"; label: string }[] = [
  { value: "all", label: "全部状态" },
  { value: "draft", label: "进行中" },
  { value: "improve", label: "待改善" },
  { value: "pass", label: "合格" },
  { value: "reported", label: "已出报告" },
];

interface UIPrefs {
  orderId: string;
  status: SampleStatus | "all";
  expanded: string | null;
}

function loadPrefs(): UIPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    if (raw) return { orderId: "all", status: "all", expanded: null, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { orderId: "all", status: "all", expanded: null };
}

function SampleCardSummary({
  row,
  onExpand,
}: {
  row: ReturnType<typeof toRow>;
  onExpand: () => void;
}) {
  const { sample, order, current, status } = row;
  const eval_ = evaluateVersion(current);
  const miss = eval_.blockers.filter((b) => b.kind === "missing").length;
  const below = eval_.blockers.filter((b) => b.kind === "below").length;
  const incomplete = eval_.blockers.filter((b) => b.kind === "incomplete").length;

  return (
    <article className="sample-card" onClick={onExpand}>
      <div className="sc-main">
        <div className="sc-title">
          <b>{sample.code}</b>
          <StatusBadge status={status} />
          <span className="sc-ver">V{current.versionNo}{current.voidReason ? "（旧版作废）" : ""}</span>
        </div>
        <p className="sc-sub">
          {order ? `${order.code} · ${order.customer}` : "订单已删除"} ｜{" "}
          {current.spec.composition || "成分未填"} ｜ {current.spec.finish || "后整理未填"}
        </p>
      </div>
      <div className="sc-side">
        {current.submitted && !current.voidReason ? (
          eval_.pass ? (
            <span className="sc-low ok">
              最低 {eval_.lowest != null ? gradeLabel(eval_.lowest) : "—"} 级 · 合格
            </span>
          ) : (
            <span className="sc-low bad">
              {miss > 0 && <i>缺{miss}项</i>}
              {below > 0 && <i>{below}项不达标</i>}
              {incomplete > 0 && <i>{incomplete}项未填全</i>}
            </span>
          )
        ) : (
          <span className="sc-low dim">{current.entries.length}/{current.requirement.requiredItems.length} 项已录</span>
        )}
        <span className="sc-expand">展开详情 ▾</span>
      </div>
    </article>
  );
}

function Workbench() {
  const { data, dispatch } = useArchive();
  const [prefs, setPrefs] = useState<UIPrefs>(loadPrefs);
  const [showOrder, setShowOrder] = useState(false);
  const [showSample, setShowSample] = useState(false);

  const persist = (patch: Partial<UIPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(UI_PREFS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  const rows = useMemo(
    () =>
      data.samples
        .map((s) => toRow(s, data.orders))
        .filter((r) => (prefs.orderId === "all" ? true : r.sample.orderId === prefs.orderId))
        .filter((r) => (prefs.status === "all" ? true : r.status === prefs.status))
        .sort((a, b) => b.sample.createdAt - a.sample.createdAt),
    [data, prefs.orderId, prefs.status],
  );

  const allRows = useMemo(() => data.samples.map((s) => toRow(s, data.orders)), [data]);
  const metrics = [
    { label: "检测任务", value: allRows.length },
    { label: "待改善（卡住）", value: allRows.filter((r) => r.status === "improve").length },
    { label: "已出报告", value: allRows.filter((r) => r.status === "reported").length },
    {
      label: "合格率",
      value:
        (() => {
          const done = allRows.filter((r) => r.status === "pass" || r.status === "reported");
          return done.length ? `${Math.round((allRows.filter((r) => r.status === "reported").length / done.length) * 100)}%` : "—";
        })(),
    },
  ];

  // 展开行不被当前筛掉时仍可显示
  const expandedRow = prefs.expanded
    ? allRows.find((r) => r.sample.id === prefs.expanded)
    : undefined;

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>色牢度检测台</h1>
          <p>染整实验室 · 耐洗 / 摩擦（干湿）/ 汗渍 · 按客户订单必检与最低评级判定</p>
        </div>
        <div className="top-actions">
          <button onClick={() => setShowOrder(true)}>＋ 新建订单</button>
          <button className="primary" onClick={() => setShowSample(true)}>
            ＋ 按订单建小样任务
          </button>
          <button
            className="ghost"
            title="清空当前数据并恢复内置演示任务"
            onClick={() => {
              if (confirm("恢复演示数据将覆盖当前存档，确定？")) dispatch({ type: "resetSeed" });
            }}
          >
            恢复演示
          </button>
        </div>
      </header>

      <section className="metrics">
        {metrics.map((m) => (
          <article key={m.label}>
            <small>{m.label}</small>
            <strong>{m.value}</strong>
          </article>
        ))}
      </section>

      <section className="filters panel">
        <label>
          <span>客户订单</span>
          <select value={prefs.orderId} onChange={(e) => persist({ orderId: e.target.value })}>
            <option value="all">全部订单</option>
            {data.orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} · {o.customer}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>状态</span>
          <select value={prefs.status} onChange={(e) => persist({ status: e.target.value as UIPrefs["status"] })}>
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <span className="filter-count">共 {rows.length} 个任务</span>
      </section>

      {expandedRow ? (
        <SampleDetail row={expandedRow} onCollapse={() => persist({ expanded: null })} />
      ) : (
        <section className="sample-list">
          {rows.length === 0 && (
            <div className="empty panel">
              当前筛选下没有任务。点击右上角「按订单建小样任务」开始检测。
            </div>
          )}
          {rows.map((row) => (
            <SampleCardSummary key={row.sample.id} row={row} onExpand={() => persist({ expanded: row.sample.id })} />
          ))}
        </section>
      )}

      <footer className="foot-note">
        缺项或任一项低于订单最低评级 → 保存为「待改善」并列出卡住项目，整单报告不可生成；
        面料成分 / 配方 / 后整理一改，旧检测与报告作废、历史版本保留。数据存于本机浏览器，重开页面可继续。
      </footer>

      {showOrder && (
        <OrderModal
          onClose={() => setShowOrder(false)}
          onCreated={() => {
            setShowOrder(false);
          }}
        />
      )}
      {showSample && (
        <SampleModal
          onClose={() => setShowSample(false)}
          onCreated={(s) => {
            setShowSample(false);
            persist({ orderId: "all", status: "all", expanded: s.id });
          }}
        />
      )}
    </main>
  );
}

export default function App() {
  return (
    <ArchiveProvider>
      <Workbench />
    </ArchiveProvider>
  );
}
