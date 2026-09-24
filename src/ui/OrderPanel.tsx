// 页面操作层：客户订单与必检项目设置
import { useState } from "react";
import { RATING_STEPS, TEST_CATALOG, ratingLabel, type TestKey } from "../domain/fastness";
import type { Order } from "../data/archive";

interface Props {
  orders: Order[];
  selectedOrderId: string | "all";
  onSelectOrder: (id: string | "all") => void;
  onAddOrder: (input: {
    code: string;
    customer: string;
    requirements: Partial<Record<TestKey, number>>;
  }) => string | null;
}

const DEFAULT_REQS: Partial<Record<TestKey, number>> = {
  wash: 4,
  rub_dry: 4,
  rub_wet: 3.5,
  persp: 4,
};

export default function OrderPanel({ orders, selectedOrderId, onSelectOrder, onAddOrder }: Props) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [customer, setCustomer] = useState("");
  const [reqs, setReqs] = useState<Partial<Record<TestKey, number>>>({ ...DEFAULT_REQS });
  const [error, setError] = useState<string | null>(null);

  const toggleItem = (key: TestKey) => {
    setReqs((r) => {
      const next = { ...r };
      if (next[key] != null) delete next[key];
      else next[key] = 4;
      return next;
    });
  };

  const submit = () => {
    const err = onAddOrder({ code, customer, requirements: reqs });
    setError(err);
    if (!err) {
      setCode("");
      setCustomer("");
      setReqs({ ...DEFAULT_REQS });
      setOpen(false);
    }
  };

  return (
    <aside className="panel order-panel">
      <div className="heading">
        <div>
          <p>客户订单</p>
          <h2>必检项目与最低评级</h2>
        </div>
        <button onClick={() => setOpen((v) => !v)}>{open ? "收起" : "新建订单"}</button>
      </div>

      {open && (
        <div className="sub-form">
          <label>
            <span>订单号</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="如 PO-2609-C" />
          </label>
          <label>
            <span>客户名称</span>
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="如 华纺服饰" />
          </label>
          <div className="req-picker">
            <span>必检项目（勾选并设最低评级）</span>
            {TEST_CATALOG.map((def) => {
              const checked = reqs[def.key] != null;
              return (
                <div className={`req-row ${checked ? "on" : ""}`} key={def.key}>
                  <label className="req-check">
                    <input type="checkbox" checked={checked} onChange={() => toggleItem(def.key)} />
                    {def.name}
                  </label>
                  {checked && (
                    <select
                      value={reqs[def.key]}
                      onChange={(e) =>
                        setReqs((r) => ({ ...r, [def.key]: Number(e.target.value) }))
                      }
                    >
                      {RATING_STEPS.map((s) => (
                        <option key={s} value={s}>
                          ≥ {ratingLabel(s)} 级
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
          {error && <p className="form-error">{error}</p>}
          <button className="primary" onClick={submit}>
            保存订单
          </button>
        </div>
      )}

      <div className="order-list">
        <button
          className={`order-card ${selectedOrderId === "all" ? "selected" : ""}`}
          onClick={() => onSelectOrder("all")}
        >
          <div className="order-card-head">
            <strong>全部订单</strong>
            <span className="count">{orders.length} 单</span>
          </div>
          <p>查看全部检测任务</p>
        </button>
        {orders.map((o) => (
          <button
            key={o.id}
            className={`order-card ${selectedOrderId === o.id ? "selected" : ""}`}
            onClick={() => onSelectOrder(o.id)}
          >
            <div className="order-card-head">
              <strong>{o.code}</strong>
              <span className="count">{o.customer}</span>
            </div>
            <div className="req-chips">
              {TEST_CATALOG.filter((d) => o.requirements[d.key] != null).map((d) => (
                <span key={d.key} className="req-chip">
                  {d.short}≥{ratingLabel(o.requirements[d.key]!)}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}
