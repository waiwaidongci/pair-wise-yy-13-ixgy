// 页面操作层：检测任务卡片（录入、判定展示、工艺变更、整单报告、历史）
import { useMemo, useState } from "react";
import {
  DIRECTIONS,
  ITEM_STATE_LABEL,
  RATING_STEPS,
  TEST_CATALOG,
  evaluateBatch,
  ratingLabel,
  type Direction,
  type TestKey,
} from "../domain/fastness";
import {
  TASK_STATUS_LABEL,
  buildTaskView,
  recordsOf,
  reportsOfBatches,
  versionHistory,
  type ArchiveState,
  type ArchiveActions,
  type Batch,
  type RecordDraft,
  type Report,
} from "../data/archive";
import { fmtDate, fmtTime } from "./format";

interface Props {
  state: ArchiveState;
  batch: Batch;
  expanded: boolean;
  onToggle: () => void;
  actions: ArchiveActions;
}

type Drafts = Partial<Record<TestKey, RecordDraft>>;

export default function TaskCard({ state, batch, expanded, onToggle, actions }: Props) {
  const view = buildTaskView(state, batch);
  const { order, evaluation: ev, status } = view;
  const readOnly = batch.status !== "active";

  const summary = (
    <>
      成分 {batch.composition} · 配方 {batch.recipe} · 后整理 {batch.finishing}
    </>
  );

  return (
    <article className={`task-card status-${status}`}>
      <button className="task-head" onClick={onToggle}>
        <div className="task-title">
          <strong>{batch.sampleCode}</strong>
          <span className="version">v{batch.version}</span>
          <span className={`badge badge-${status}`}>{TASK_STATUS_LABEL[status]}</span>
        </div>
        <p className="task-sub">
          {order ? `${order.customer} / ${order.code}` : "订单缺失"} · {summary}
        </p>
        <p className="task-progress">
          {readOnly ? (
            <>已作废 · 检测与报告转入历史</>
          ) : (
            <>
              必检 {ev.items.length} 项 · 完成 {ev.doneCount} 项
              {ev.lowest && (
                <>
                  {" "}
                  · 最低分 {ratingLabel(ev.lowest.final)} 级（{ev.lowest.def.short}）
                </>
              )}
            </>
          )}
          <span className="expand-hint">{expanded ? "收起 ▴" : "展开 ▾"}</span>
        </p>
      </button>

      {expanded && (
        <div className="task-body">
          {readOnly ? (
            <ReadonlyBody state={state} batch={batch} />
          ) : (
            <ActiveBody state={state} batch={batch} actions={actions} />
          )}
          <History state={state} batch={batch} />
        </div>
      )}
    </article>
  );
}

// ---------- 当前版本：录入 + 卡点 + 报告 ----------

function ActiveBody({
  state,
  batch,
  actions,
}: {
  state: ArchiveState;
  batch: Batch;
  actions: ArchiveActions;
}) {
  const view = buildTaskView(state, batch);
  const { order, evaluation: ev, validReport } = view;
  const records = recordsOf(state, batch.id);

  const initDrafts = (): Drafts => {
    const d: Drafts = {};
    for (const def of TEST_CATALOG) {
      if (order?.requirements[def.key] == null) continue;
      const rec = records.find((r) => r.itemKey === def.key);
      d[def.key] = rec
        ? {
            direction: rec.direction,
            condition: rec.condition,
            rating1: rec.rating1,
            rating2: rec.rating2,
          }
        : { direction: "经向", condition: def.defaultCondition, rating1: null, rating2: null };
    }
    return d;
  };

  const [drafts, setDrafts] = useState<Drafts>(initDrafts);
  const [notice, setNotice] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const [revising, setRevising] = useState(false);

  const patch = (key: TestKey, p: Partial<RecordDraft>) =>
    setDrafts((d) => ({ ...d, [key]: { ...d[key]!, ...p } }));

  const save = () => {
    actions.saveRecords(batch.id, drafts);
    // 用草稿即时判定，给出保存反馈
    const after = evaluateBatch(
      order?.requirements ?? {},
      (Object.keys(drafts) as TestKey[])
        .filter((k) => {
          const dr = drafts[k]!;
          const rec = records.find((r) => r.itemKey === k);
          const untouched =
            !rec &&
            dr.rating1 == null &&
            dr.rating2 == null &&
            dr.direction === "经向" &&
            dr.condition === TEST_CATALOG.find((c) => c.key === k)!.defaultCondition;
          return !untouched;
        })
        .map((k) => ({ itemKey: k, rating1: drafts[k]!.rating1, rating2: drafts[k]!.rating2 }))
    );
    if (after.pass) {
      setNotice({ kind: "ok", text: "已保存：全部必检项达标，可以生成整单报告。" });
    } else {
      const parts: string[] = [];
      if (after.missing.length)
        parts.push(`缺项 ${after.missing.map((i) => i.def.short).join("、")}`);
      if (after.failing.length)
        parts.push(
          `低于要求 ${after.failing
            .map((i) => `${i.def.short} ${ratingLabel(i.final)}<${ratingLabel(i.required)}`)
            .join("、")}`
        );
      setNotice({ kind: "warn", text: `已保存为「待改善」，卡住的项目：${parts.join("；")}` });
    }
  };

  const issue = () => {
    const err = actions.issueReport(batch.id);
    setNotice(
      err ? { kind: "warn", text: err } : { kind: "ok", text: "整单报告已出具，结论：合格。" }
    );
  };

  return (
    <>
      {/* 卡住的项目 */}
      {!ev.pass && (
        <div className="blockers">
          <strong>待改善 · 卡住的项目：</strong>
          {ev.missing.length > 0 && (
            <span className="blocker-chip miss">
              缺项：{ev.missing.map((i) => `${i.def.short}（${ITEM_STATE_LABEL[i.state]}）`).join("、")}
            </span>
          )}
          {ev.failing.length > 0 && (
            <span className="blocker-chip fail">
              低于要求：
              {ev.failing
                .map((i) => `${i.def.short} ${ratingLabel(i.final)}级 < 要求${ratingLabel(i.required)}级`)
                .join("、")}
            </span>
          )}
          <span className="blocker-note">整单报告不能生成</span>
        </div>
      )}

      {/* 检测录入 */}
      <table className="entry-table">
        <thead>
          <tr>
            <th>必检项目</th>
            <th>试样方向</th>
            <th>试验条件</th>
            <th>复测一</th>
            <th>复测二</th>
            <th>最终</th>
            <th>要求</th>
            <th>判定</th>
          </tr>
        </thead>
        <tbody>
          {ev.items.map((item) => {
            const d = drafts[item.def.key]!;
            const final =
              d.rating1 != null && d.rating2 != null ? Math.min(d.rating1, d.rating2) : null;
            const rowState =
              final == null
                ? item.state === "missing"
                  ? "missing"
                  : "incomplete"
                : final < item.required
                  ? "fail"
                  : "pass";
            return (
              <tr key={item.def.key} className={`row-${rowState}`}>
                <td>{item.def.name}</td>
                <td>
                  <select
                    value={d.direction}
                    onChange={(e) => patch(item.def.key, { direction: e.target.value as Direction })}
                  >
                    {DIRECTIONS.map((dir) => (
                      <option key={dir}>{dir}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={d.condition}
                    onChange={(e) => patch(item.def.key, { condition: e.target.value })}
                  />
                </td>
                {[1, 2].map((n) => (
                  <td key={n}>
                    <select
                      value={n === 1 ? (d.rating1 ?? "") : (d.rating2 ?? "")}
                      onChange={(e) =>
                        patch(item.def.key, {
                          [n === 1 ? "rating1" : "rating2"]: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                    >
                      <option value="">未测</option>
                      {RATING_STEPS.map((s) => (
                        <option key={s} value={s}>
                          {ratingLabel(s)}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
                <td className="final-cell">{ratingLabel(final)}</td>
                <td>≥{ratingLabel(item.required)}</td>
                <td>
                  <span className={`mini-badge st-${rowState}`}>{ITEM_STATE_LABEL[rowState]}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="action-row">
        <button className="primary" onClick={save}>
          保存检测数据
        </button>
        {!validReport && (
          <button onClick={issue} disabled={!ev.pass} title={ev.pass ? "" : "有缺项或低于要求项"}>
            生成整单报告
          </button>
        )}
        <button onClick={() => setRevising((v) => !v)}>
          {revising ? "取消变更" : "变更工艺（成分/配方/后整理）"}
        </button>
      </div>
      {notice && <p className={`notice ${notice.kind}`}>{notice.text}</p>}

      {revising && (
        <ReviseForm
          batch={batch}
          onSubmit={(p) => {
            const err = actions.reviseProcess(batch.id, p);
            setNotice(
              err
                ? { kind: "warn", text: err }
                : { kind: "ok", text: `已作废 v${batch.version} 并新建 v${batch.version + 1}，旧检测与报告转入历史。` }
            );
            if (!err) setRevising(false);
          }}
        />
      )}

      {validReport && <ReportView report={validReport} />}
    </>
  );
}

// ---------- 工艺变更：一改即作废当前版本 ----------

function ReviseForm({
  batch,
  onSubmit,
}: {
  batch: Batch;
  onSubmit: (p: { composition: string; recipe: string; finishing: string; note: string }) => void;
}) {
  const [composition, setComposition] = useState(batch.composition);
  const [recipe, setRecipe] = useState(batch.recipe);
  const [finishing, setFinishing] = useState(batch.finishing);
  const [note, setNote] = useState("");
  return (
    <div className="sub-form revise-form">
      <p className="revise-warn">
        面料成分、配方或后整理任意一项变更，当前版本（v{batch.version}）的检测与报告即作废，自动生成 v
        {batch.version + 1} 重新检测，历史版本保留可查。
      </p>
      <div className="field-grid">
        <label>
          <span>面料成分</span>
          <input value={composition} onChange={(e) => setComposition(e.target.value)} />
        </label>
        <label>
          <span>染料配方</span>
          <input value={recipe} onChange={(e) => setRecipe(e.target.value)} />
        </label>
        <label>
          <span>后整理方式</span>
          <input value={finishing} onChange={(e) => setFinishing(e.target.value)} />
        </label>
        <label>
          <span>变更说明（可留空自动生成）</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：客户要求加深，配方 2.2%→2.6%" />
        </label>
      </div>
      <button
        className="danger"
        onClick={() => onSubmit({ composition, recipe, finishing, note })}
      >
        确认变更并作废 v{batch.version}
      </button>
    </div>
  );
}

// ---------- 已作废版本：只读 ----------

function ReadonlyBody({ state, batch }: { state: ArchiveState; batch: Batch }) {
  const records = recordsOf(state, batch.id);
  return (
    <div className="readonly-body">
      <p className="void-note">
        此版本已于 {fmtTime(batch.supersededAt ?? batch.createdAt)} 作废。
        {batch.changeNote ? ` ${batch.changeNote}` : ""} 以下检测数据为历史留档，不可修改。
      </p>
      {records.length > 0 ? (
        <table className="entry-table readonly">
          <thead>
            <tr>
              <th>项目</th>
              <th>试样方向</th>
              <th>试验条件</th>
              <th>复测一</th>
              <th>复测二</th>
              <th>最终</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td>{TEST_CATALOG.find((d) => d.key === r.itemKey)?.name}</td>
                <td>{r.direction}</td>
                <td>{r.condition}</td>
                <td>{ratingLabel(r.rating1)}</td>
                <td>{ratingLabel(r.rating2)}</td>
                <td>{ratingLabel(r.rating1 != null && r.rating2 != null ? Math.min(r.rating1, r.rating2) : null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">该版本未留下检测记录。</p>
      )}
    </div>
  );
}

// ---------- 整单报告 ----------

function ReportView({ report }: { report: Report }) {
  const s = report.snapshot;
  return (
    <div className={`report-block ${report.status}`}>
      <div className="report-head">
        <strong>整单检测报告 {report.code}</strong>
        <span className={`badge ${report.status === "valid" ? "badge-reported" : "badge-void"}`}>
          {report.status === "valid" ? "有效" : "已作废"}
        </span>
      </div>
      <p className="report-meta">
        {s.customer} / {s.orderCode} · 小样 {s.sampleCode} v{report.version} · 出具于{" "}
        {fmtTime(report.issuedAt)} · 成分 {s.composition} · 配方 {s.recipe} · 后整理 {s.finishing}
      </p>
      <table className="entry-table readonly">
        <thead>
          <tr>
            <th>项目</th>
            <th>方向</th>
            <th>试验条件</th>
            <th>复测一</th>
            <th>复测二</th>
            <th>最终</th>
            <th>要求</th>
          </tr>
        </thead>
        <tbody>
          {s.items.map((it) => (
            <tr key={it.itemKey}>
              <td>{it.name}</td>
              <td>{it.direction}</td>
              <td>{it.condition}</td>
              <td>{ratingLabel(it.rating1)}</td>
              <td>{ratingLabel(it.rating2)}</td>
              <td>{ratingLabel(it.final)}</td>
              <td>≥{ratingLabel(it.required)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="report-conclusion">结论：全部必检项目合格 —— {s.conclusion}</p>
    </div>
  );
}

// ---------- 历史：版本链 + 报告 ----------

function History({ state, batch }: { state: ArchiveState; batch: Batch }) {
  const versions = versionHistory(state, batch);
  const reports = reportsOfBatches(
    state,
    versions.map((v) => v.id)
  );
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const openReport = useMemo(
    () => reports.find((r) => r.id === openReportId) ?? null,
    [reports, openReportId]
  );
  if (versions.length <= 1 && reports.length === 0) return null;
  return (
    <div className="history">
      <h3>历史版本</h3>
      <ul>
        {versions.map((v) => (
          <li key={v.id} className={v.status === "active" ? "current" : "voided"}>
            <span className="version">v{v.version}</span>
            <span>
              {v.composition} · {v.recipe} · {v.finishing}
            </span>
            <span className="muted">
              {v.status === "active"
                ? `当前版本 · 建于 ${fmtDate(v.createdAt)}`
                : `已作废 · ${fmtDate(v.supersededAt ?? v.createdAt)}${v.changeNote ? ` · ${v.changeNote}` : ""}`}
            </span>
          </li>
        ))}
      </ul>
      {reports.length > 0 && (
        <>
          <h3>报告存档</h3>
          <ul>
            {reports.map((r) => (
              <li key={r.id}>
                <button
                  className="link"
                  onClick={() => setOpenReportId(openReportId === r.id ? null : r.id)}
                >
                  {r.code}
                </button>
                <span className={`badge ${r.status === "valid" ? "badge-reported" : "badge-void"}`}>
                  {r.status === "valid" ? "有效" : "已作废"}
                </span>
                <span className="muted">{fmtTime(r.issuedAt)}</span>
              </li>
            ))}
          </ul>
          {openReport && <ReportView report={openReport} />}
        </>
      )}
    </div>
  );
}
