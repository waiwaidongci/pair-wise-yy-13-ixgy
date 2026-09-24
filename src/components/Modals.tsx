import { useState } from "react";
import type { Grade, ItemDef, Order, ResultKind, Sample, SampleSpec } from "../types";
import { GRADE_OPTIONS, gradeLabel, ITEM_DEFS, orderSnapshot } from "../rules";
import { uid, useArchive } from "../archive";

function GradeSelect({
  value,
  onChange,
}: {
  value: Grade | "";
  onChange: (g: Grade) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {value === "" && <option value="">未设</option>}
      {GRADE_OPTIONS.map((g) => (
        <option key={g} value={g}>
          {gradeLabel(g)} 级
        </option>
      ))}
    </select>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 新建客户订单：设必检项目与各项最低评级 */
export function OrderModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (order: Order) => void;
}) {
  const { dispatch } = useArchive();
  const [code, setCode] = useState("");
  const [customer, setCustomer] = useState("");
  const [picked, setPicked] = useState<string[]>(["washing", "rubbing", "perspiration"]);
  const [mins, setMins] = useState<Record<string, Partial<Record<ResultKind, Grade>>>>(
    () => Object.fromEntries(ITEM_DEFS.map((d) => [d.key, { ...d.defaultMin }])),
  );
  const [error, setError] = useState("");

  const toggle = (key: string) => {
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  };

  const setMin = (key: string, kind: ResultKind, g: Grade) =>
    setMins((m) => ({ ...m, [key]: { ...m[key], [kind]: g } }));

  const save = () => {
    if (!code.trim() || !customer.trim()) {
      setError("请填写订单号与客户名称");
      return;
    }
    if (picked.length === 0) {
      setError("至少勾选一个必检项目");
      return;
    }
    const order: Order = {
      id: uid(),
      code: code.trim(),
      customer: customer.trim(),
      createdAt: Date.now(),
      requiredItems: picked,
      minGrades: Object.fromEntries(picked.map((k) => [k, mins[k]])),
    };
    dispatch({ type: "createOrder", order });
    onCreated(order);
  };

  return (
    <Modal title="新建客户订单" onClose={onClose}>
      <div className="form-row">
        <label>
          <span>订单号</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="如 NK-2409-018" />
        </label>
        <label>
          <span>客户</span>
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="客户名称" />
        </label>
      </div>

      <p className="form-hint">勾选必检项目，并设定每项最低评级（已预填标准默认值）：</p>
      <div className="item-pick-list">
        {ITEM_DEFS.map((def: ItemDef) => {
          const on = picked.includes(def.key);
          return (
            <div key={def.key} className={"item-pick" + (on ? " on" : "")}>
              <label className="pick-head">
                <input type="checkbox" checked={on} onChange={() => toggle(def.key)} />
                <div>
                  <b>{def.name}</b>
                  <small>{def.standard}</small>
                </div>
              </label>
              {on && (
                <div className="pick-mins">
                  {def.kinds.map((kind) => (
                    <label key={kind} className="mini">
                      {kind === "change" ? "变色" : "沾色"} ≥
                      <GradeSelect
                        value={mins[def.key]?.[kind] ?? ""}
                        onChange={(g) => setMin(def.key, kind, g)}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="form-error">{error}</p>}
      <div className="modal-foot">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={save}>
          保存订单
        </button>
      </div>
    </Modal>
  );
}

/** 新建小样检测任务 */
export function SampleModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (sample: Sample) => void;
}) {
  const { data, dispatch } = useArchive();
  const [orderId, setOrderId] = useState(data.orders[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [spec, setSpec] = useState<SampleSpec>({ composition: "", recipe: "", finish: "" });
  const [error, setError] = useState("");

  const order = data.orders.find((o) => o.id === orderId);

  const set = (field: keyof SampleSpec, value: string) =>
    setSpec((s) => ({ ...s, [field]: value }));

  const save = () => {
    if (!order) {
      setError("请先选择客户订单（无订单时先新建订单）");
      return;
    }
    if (!code.trim()) {
      setError("请填写小样编号");
      return;
    }
    const now = Date.now();
    const sample: Sample = {
      id: uid(),
      code: code.trim(),
      orderId: order.id,
      createdAt: now,
      versions: [
        {
          id: uid(),
          versionNo: 1,
          spec,
          requirement: orderSnapshot(order),
          entries: [],
          createdAt: now,
          updatedAt: now,
          submitted: false,
          voidReason: null,
          report: null,
        },
      ],
    };
    dispatch({ type: "createSample", sample });
    onCreated(sample);
  };

  return (
    <Modal title="按订单建小样任务" onClose={onClose}>
      <label className="block-field">
        <span>客户订单</span>
        <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          {data.orders.length === 0 && <option value="">（暂无订单，请先新建）</option>}
          {data.orders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.code} · {o.customer}（{o.requiredItems.length} 项必检）
            </option>
          ))}
        </select>
      </label>
      <label className="block-field">
        <span>小样编号</span>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="如 LAB-0924-A" />
      </label>
      <label className="block-field">
        <span>面料成分</span>
        <input value={spec.composition} onChange={(e) => set("composition", e.target.value)} placeholder="如 棉100% 府绸 120g" />
      </label>
      <label className="block-field">
        <span>染料配方</span>
        <input value={spec.recipe} onChange={(e) => set("recipe", e.target.value)} placeholder="如 活性红3BS 1.8% / 元明粉40g/L" />
      </label>
      <label className="block-field">
        <span>后整理</span>
        <input value={spec.finish} onChange={(e) => set("finish", e.target.value)} placeholder="如 柔软整理2%" />
      </label>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-foot">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={save}>
          建立任务
        </button>
      </div>
    </Modal>
  );
}
