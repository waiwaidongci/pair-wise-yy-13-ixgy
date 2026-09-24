// 页面操作层：色牢度检测台主页面
// 分层：domain/fastness = 检测规则；data/archive = 批次存档；ui/* = 页面操作
import "./styles.css";
import { useMemo, useState } from "react";
import { buildTaskView, useArchive } from "./data/archive";
import OrderPanel from "./ui/OrderPanel";
import TaskBoard from "./ui/TaskBoard";

function App() {
  const { state, actions } = useArchive();
  const [orderFilter, setOrderFilter] = useState<string | "all">("all");

  const metrics = useMemo(() => {
    const views = state.batches.map((b) => buildTaskView(state, b));
    const active = views.filter((v) => v.batch.status === "active");
    return [
      { label: "客户订单", value: state.orders.length },
      { label: "进行中任务", value: active.length },
      { label: "待改善", value: active.filter((v) => v.status === "improve").length },
      {
        label: "已出报告",
        value: state.reports.filter((r) => r.status === "valid").length,
      },
    ];
  }, [state]);

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62012 · 纺织染整实验室</p>
        <h1>色牢度检测台</h1>
        <span>
          小样按客户订单建检测任务，订单先定必检项目与最低评级；每项记录试样方向、试验条件与两条复测评级（摩擦分干/湿）。
          缺项或任一项低于要求即保存为「待改善」并列出卡住的项目，整单报告不能生成；
          面料成分、配方或后整理一经变更，旧检测与报告作废、历史版本保留。
        </span>
        <div>
          <button
            className="ghost"
            onClick={() => {
              if (window.confirm("确定清空当前存档并恢复演示数据？")) actions.resetAll();
            }}
          >
            重置演示数据
          </button>
        </div>
      </section>

      <section className="metrics">
        {metrics.map((m) => (
          <article key={m.label}>
            <small>{m.label}</small>
            <strong>{m.value}</strong>
          </article>
        ))}
      </section>

      <div className="layout">
        <OrderPanel
          orders={state.orders}
          selectedOrderId={orderFilter}
          onSelectOrder={setOrderFilter}
          onAddOrder={actions.addOrder}
        />
        <TaskBoard
          state={state}
          actions={actions}
          orderFilter={orderFilter}
          onOrderFilter={setOrderFilter}
        />
      </div>
    </main>
  );
}

export default App;
