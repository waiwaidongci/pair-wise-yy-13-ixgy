import { useMemo, useState } from "react";
import type { Grade, ResultKind, SampleSpec, TestEntry, TestVersion } from "../types";
import {
  evaluateVersion,
  gradeLabel,
  GRADE_OPTIONS,
  ITEM_MAP,
  kindLabel,
  requiredMinGrade,
  canReport,
} from "../rules";
import { useArchive, type SampleRow } from "../archive";
import { STATUS_LABEL, type SampleStatus } from "../types";

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const STATUS_CLASS: Record<SampleStatus, string> = {
  draft: "st-draft",
  improve: "st-improve",
  pass: "st-pass",
  reported: "st-reported",
};

export function StatusBadge({ status }: { status: SampleStatus }) {
  return <span className={"badge " + STATUS_CLASS[status]}>{STATUS_LABEL[status]}</span>;
}

function GradePick({
  value,
  onChange,
  disabled,
}: {
  value: Grade | undefined;
  onChange: (g: Grade) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className="grade-pick"
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      <option value="">—</option>
      {GRADE_OPTIONS.map((g) => (
        <option key={g} value={g}>
          {gradeLabel(g)}
        </option>
      ))}
    </select>
  );
}

const DIRECTIONS = ["经向", "纬向", "斜向"];

function emptyEntry(itemKey: string): TestEntry {
  return { itemKey, direction: "", condition: "", gradeA: {}, gradeB: {}, remark: "" };
}

function SpecFields({
  version,
  frozen,
  sampleId,
}: {
  version: TestVersion;
  frozen: boolean;
  sampleId: string;
}) {
  const { dispatch } = useArchive();
  const fields: { key: keyof SampleSpec; label: string }[] = [
    { key: "composition", label: "面料成分" },
    { key: "recipe", label: "染料配方" },
    { key: "finish", label: "后整理" },
  ];
  return (
    <div className="spec-grid">
      {fields.map(({ key, label }) => (
        <label key={key} className="spec-field">
          <span>{label}</span>
          <input
            value={version.spec[key]}
            disabled={frozen}
            onChange={(e) => dispatch({ type: "updateSpec", sampleId, field: key, value: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}

function EntryCard({
  itemKey,
  entry,
  version,
  sampleId,
}: {
  itemKey: string;
  entry: TestEntry;
  version: TestVersion;
  sampleId: string;
}) {
  const { dispatch } = useArchive();
  const def = ITEM_MAP[itemKey];
  const frozen = !!version.report;

  const update = (patch: Partial<TestEntry>) =>
    dispatch({ type: "updateEntry", sampleId, entry: { ...entry, ...patch } });

  const setGrade = (round: "gradeA" | "gradeB", kind: ResultKind, g: Grade) =>
    update({ [round]: { ...entry[round], [kind]: g } } as Partial<TestEntry>);

  return (
    <article className="entry-card">
      <header>
        <div>
          <b>{def.name}</b>
          <small>{def.standard}</small>
        </div>
        <div className="kind-tags">
          {def.kinds.map((kind) => {
            const need = requiredMinGrade(version.requirement, itemKey, kind);
            const a = entry.gradeA[kind];
            const b = entry.gradeB[kind];
            const eff = a != null && b != null ? Math.min(a, b) : null;
            const ok = eff != null && eff >= need;
            return (
              <span
                key={kind}
                className={"kind-tag " + (eff == null ? "kt-none" : ok ? "kt-ok" : "kt-bad")}
                title={`订单最低 ${gradeLabel(need)} 级`}
              >
                {kindLabel(itemKey, kind)} 最低 {gradeLabel(need)} · 现在{" "}
                {eff == null ? "—" : `${gradeLabel(eff)} 级`}
              </span>
            );
          })}
        </div>
      </header>

      <div className="entry-meta">
        <label>
          <span>试样方向</span>
          <select value={entry.direction} disabled={frozen} onChange={(e) => update({ direction: e.target.value })}>
            <option value="">请选择</option>
            {DIRECTIONS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="grow">
          <span>试验条件</span>
          <input
            value={entry.condition}
            disabled={frozen}
            placeholder="如 40℃×30min 皂片5g/L"
            onChange={(e) => update({ condition: e.target.value })}
          />
        </label>
      </div>

      <table className="grade-table">
        <thead>
          <tr>
            <th>评定项</th>
            <th>订单要求 ≥</th>
            <th>复测一</th>
            <th>复测二</th>
            <th>取低</th>
          </tr>
        </thead>
        <tbody>
          {def.kinds.map((kind) => {
            const need = requiredMinGrade(version.requirement, itemKey, kind);
            const a = entry.gradeA[kind];
            const b = entry.gradeB[kind];
            const eff = a != null && b != null ? Math.min(a, b) : null;
            const ok = eff != null && eff >= need;
            return (
              <tr key={kind}>
                <td>{kindLabel(itemKey, kind)}</td>
                <td className="req-cell">{gradeLabel(need)} 级</td>
                <td>
                  <GradePick value={a} disabled={frozen} onChange={(g) => setGrade("gradeA", kind, g)} />
                </td>
                <td>
                  <GradePick value={b} disabled={frozen} onChange={(g) => setGrade("gradeB", kind, g)} />
                </td>
                <td>
                  {eff == null ? (
                    <span className="g-none">—</span>
                  ) : (
                    <span className={ok ? "g-ok" : "g-bad"}>{gradeLabel(eff)} 级</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <label className="remark">
        <span>备注</span>
        <input
          value={entry.remark}
          disabled={frozen}
          placeholder="如 湿摩沾色明显、贴衬布编号…"
          onChange={(e) => update({ remark: e.target.value })}
        />
      </label>
    </article>
  );
}

function Blockers({ version }: { version: TestVersion }) {
  const eval_ = evaluateVersion(version);
  if (eval_.pass) {
    return (
      <div className="blockers ok">
        <b>✓ 必检项目齐全，全部达到订单最低评级</b>
        <span>当前最低分 {eval_.lowest != null ? `${gradeLabel(eval_.lowest)} 级` : "—"}</span>
      </div>
    );
  }
  const labelMap = { missing: "缺项", incomplete: "资料不全", below: "低于要求" } as const;
  return (
    <div className="blockers">
      <b>卡住的项目（{eval_.blockers.length}）：</b>
      <ul>
        {eval_.blockers.map((b, i) => (
          <li key={i}>
            <span className={"bk-tag bk-" + b.kind}>{labelMap[b.kind]}</span>
            <b>{b.itemName}</b>
            <span>{b.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function History({ row }: { row: SampleRow }) {
  const { sample } = row;
  if (sample.versions.length === 1) {
    return (
      <details className="history">
        <summary>历史版本（无旧版本）</summary>
        <p className="history-empty">首次检测，尚无作废版本。</p>
      </details>
    );
  }
  return (
    <details className="history">
      <summary>
        历史版本（{sample.versions.length} 版，{sample.versions.filter((v) => v.voidReason).length} 版已作废）
      </summary>
      <div className="history-list">
        {[...sample.versions].reverse().map((v) => {
          const eval_ = evaluateVersion(v);
          return (
            <div key={v.id} className={"history-item" + (v.voidReason ? " void" : "")}>
              <div className="hi-head">
                <b>
                  V{v.versionNo}
                  {v.voidReason && <span className="void-stamp">已作废</span>}
                  {v.report && <span className="report-no">报告 {v.report.no}</span>}
                </b>
                <small>{fmtTime(v.createdAt)}</small>
              </div>
              <p className="hi-spec">
                {v.spec.composition || "成分未填"} ｜ {v.spec.recipe || "配方未填"} ｜{" "}
                {v.spec.finish || "后整理未填"}
              </p>
              {v.voidReason && <p className="hi-reason">作废原因：{v.voidReason}</p>}
              {v.report?.voidReason && <p className="hi-reason">报告同步作废：{v.report.voidReason}</p>}
              <p className="hi-grades">
                {v.requirement.requiredItems.map((k) => {
                  const entry = v.entries.find((e) => e.itemKey === k);
                  const grades = entry
                    ? ITEM_MAP[k].kinds
                        .map((kind) => {
                          const a = entry.gradeA[kind];
                          const b = entry.gradeB[kind];
                          return a != null && b != null ? `${kindLabel(k, kind)}${gradeLabel(Math.min(a, b))}` : null;
                        })
                        .filter(Boolean)
                        .join(" / ")
                    : "未录入";
                  return (
                    <span key={k} className="hi-grade">
                      {ITEM_MAP[k].name}：{grades || "评级不全"}
                    </span>
                  );
                })}
              </p>
              {v.submitted && !v.voidReason && (
                <p className="hi-eval">
                  {eval_.pass
                    ? `合格，最低 ${eval_.lowest != null ? gradeLabel(eval_.lowest) : "—"} 级`
                    : `待改善：${eval_.blockers.length} 项卡住`}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function ReportSheet({ row }: { row: SampleRow }) {
  const { current, order } = row;
  if (!current.report || current.voidReason) return null;
  const eval_ = evaluateVersion(current);
  return (
    <div id="report-sheet" className="report-sheet">
      <div className="rs-head">
        <div>
          <h2>色牢度检测报告</h2>
          <p>报告编号：{current.report.no}</p>
        </div>
        <div className="rs-meta">
          <p>客户订单：{order?.code} · {order?.customer}</p>
          <p>小样编号：{row.sample.code}</p>
          <p>签发日期：{fmtTime(current.report.generatedAt)}</p>
        </div>
      </div>
      <div className="rs-section">
        <h4>试样规格</h4>
        <table>
          <tbody>
            <tr><th>面料成分</th><td>{current.spec.composition || "—"}</td><th>染料配方</th><td>{current.spec.recipe || "—"}</td></tr>
            <tr><th>后整理</th><td colSpan={3}>{current.spec.finish || "—"}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="rs-section">
        <h4>检测结果</h4>
        <table className="rs-results">
          <thead>
            <tr>
              <th>检测项目</th>
              <th>标准</th>
              <th>方向</th>
              <th>试验条件</th>
              <th>评定</th>
              <th>复测一</th>
              <th>复测二</th>
              <th>取低</th>
              <th>要求 ≥</th>
              <th>结论</th>
            </tr>
          </thead>
          <tbody>
            {current.requirement.requiredItems.map((k) => {
              const entry = current.entries.find((e) => e.itemKey === k)!;
              const def = ITEM_MAP[k];
              return def.kinds.map((kind, i) => {
                const a = entry.gradeA[kind]!;
                const b = entry.gradeB[kind]!;
                const eff = Math.min(a, b);
                const need = requiredMinGrade(current.requirement, k, kind);
                return (
                  <tr key={k + kind}>
                    {i === 0 && <td rowSpan={def.kinds.length}>{def.name}</td>}
                    {i === 0 && <td rowSpan={def.kinds.length}>{def.standard}</td>}
                    {i === 0 && <td rowSpan={def.kinds.length}>{entry.direction}</td>}
                    {i === 0 && <td rowSpan={def.kinds.length}>{entry.condition}</td>}
                    <td>{kindLabel(k, kind)}</td>
                    <td>{gradeLabel(a)}</td>
                    <td>{gradeLabel(b)}</td>
                    <td>{gradeLabel(eff)}</td>
                    <td>{gradeLabel(need)}</td>
                    <td>{eff >= need ? "合格" : "不合格"}</td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>
      <p className="rs-summary">
        综合评定：全部必检项目达到订单要求，最低评级 {eval_.lowest != null ? gradeLabel(eval_.lowest) : "—"} 级。
        本报告仅对 {current.spec.composition} / {current.spec.recipe} / {current.spec.finish} 对应的样品负责，
        面料成分、配方或后整理变更后本报告自动作废。
      </p>
      <div className="rs-sign">
        <span>检测：__________</span>
        <span>复核：__________</span>
        <span>批准：__________</span>
      </div>
      <div className="rs-actions no-print">
        <button className="primary" onClick={() => window.print()}>
          打印 / 另存 PDF
        </button>
      </div>
    </div>
  );
}

export function SampleDetail({ row, onCollapse }: { row: SampleRow; onCollapse: () => void }) {
  const { dispatch } = useArchive();
  const { sample, current, order, status } = row;
  const [msg, setMsg] = useState("");

  const eval_ = useMemo(() => evaluateVersion(current), [current]);
  const voided = !!current.voidReason;
  const reported = !!current.report;
  const entryMap = useMemo(
    () => Object.fromEntries(current.entries.map((e) => [e.itemKey, e])),
    [current],
  );

  const submit = () => {
    dispatch({ type: "submit", sampleId: sample.id, at: Date.now() });
    setMsg(
      eval_.pass
        ? "已保存：全部项目合格，可生成整单报告。"
        : `已保存为「待改善」：${eval_.blockers.length} 个项目卡住，整单报告暂不能生成。`,
    );
  };

  const report = () => {
    dispatch({ type: "generateReport", sampleId: sample.id, at: Date.now() });
    setMsg("整单报告已生成，可打印或另存 PDF。");
  };

  return (
    <section className="detail">
      <div className="detail-head">
        <div>
          <h3>
            {sample.code} <StatusBadge status={status} />
            {voided && <span className="void-stamp big">当前版本已作废</span>}
          </h3>
          <p>
            订单 {order?.code} · {order?.customer} ｜ V{current.versionNo} ｜ 更新 {fmtTime(current.updatedAt)}
            {current.report && !voided && <> ｜ 报告 <b>{current.report.no}</b></>}
          </p>
        </div>
        <button className="icon-btn" onClick={onCollapse} aria-label="收起">
          ▲
        </button>
      </div>

      <div className="detail-body">
        <div className="block">
          <h4>小样规格{reported ? "" : <small>（提交后修改任一项，将作废旧检测与报告并开新版本）</small>}</h4>
          <SpecFields version={current} frozen={reported} sampleId={sample.id} />
        </div>

        {!voided && (
          <>
            <div className="block">
              <h4>
                检测录入
                <small>
                  必检 {current.requirement.requiredItems.length} 项 ｜ 摩擦分干摩（变色）/ 湿摩（沾色）分别评定，
                  每项记两次复测取低值
                </small>
              </h4>
              <div className="entry-list">
                {current.requirement.requiredItems.map((k) => (
                  <EntryCard
                    key={k}
                    itemKey={k}
                    entry={entryMap[k] ?? emptyEntry(k)}
                    version={current}
                    sampleId={sample.id}
                  />
                ))}
              </div>
            </div>

            <Blockers version={current} />

            <div className="action-row">
              {!reported ? (
                <>
                  <button className="primary" onClick={submit}>
                    保存并判定
                  </button>
                  <button disabled={!canReport(current)} onClick={report} title={canReport(current) ? "" : "缺项或有项目低于订单要求"}>
                    生成整单报告
                  </button>
                  {!canReport(current) && (
                    <span className="action-hint">缺项或任一项低于订单要求时，整单报告不能生成</span>
                  )}
                </>
              ) : (
                <p className="frozen-hint">
                  已出报告，检测数据冻结。如需调整面料成分、配方或后整理，直接在上方修改——旧检测与报告作废，历史版本保留，新版本重新检测。
                </p>
              )}
              {msg && <span className="save-msg">{msg}</span>}
            </div>

            {reported && <ReportSheet row={row} />}
          </>
        )}

        {voided && (
          <div className="void-banner">
            本版本已作废：{current.voidReason}。检测数据仅作历史留存，不可生成报告；请在新版本重新检测。
          </div>
        )}

        <History row={row} />
      </div>
    </section>
  );
}
