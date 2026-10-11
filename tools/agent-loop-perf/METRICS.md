# T-P0a-03 指标口径

本文件与决策包 `METRICS.md` 对齐，并补充 harness 实现细节。产品默认 transport 仍是 **native**。

## 单位（与 D4 对齐）

1. **turn**：一次 agent turn 从 `submit_turn` 发起到 `turn_completed` / terminal 终态。
2. **model 迭代**：一次 model HTTP/请求周期（含流式完成，即 mock stream generator 结束）。
3. **流块**：Gateway 客户端相邻 `assistant_text_delta` 到达间隔。无流或只有一块时 `stream_chunk_ms=[]`。

| 指标 | 定义 | 备注 |
|---|---|---|
| `turn_ms` | 从 turn 开始到 terminal 终态的 wall clock | 三种 transport 都报；**不含** Gateway 进程启动 |
| `model_iter_ms` | 单次 model request→response（含流结束） | 多轮则逐次再汇总 |
| `stream_chunk_ms` | 相邻流块到达间隔 | 无流场景可空数组 |
| `host_overhead_ms`（native） | **不是** module_call；native 无 sidecar | 见下一节 |
| `rss_kb` | `/proc/self/status` 的 adapter/host Node `VmRSS` | 进程级可选备注，不是本关门禁 |

`adapter_wall_ms` 仅作调试：整段 adapter 进程（含 Gateway 启动/拆除）。主表只用 `turn_ms`。

## native「宿主开销」

- native 路径无 sidecar / module_call。
- 本关不发明伪开销；以 `turn_ms(native)` 为内嵌宿主基线。
- P1 相对开销：`candidate_P95 - native_P95`，对照 `max(native_P95×10%, 5ms)`。

## Mock 延迟

- 默认 **关闭** 人为 `delays` / `toolDelays`（全部覆写为 `0`），测基础设施而非注入延迟。
- 无法关闭的场景：`delay_injected=true`，不进入主基线表（`primaryBaseline` / `excludedFromPrimary`）。
- `--keep-delays` 保留场景原值；此时若仍有正延迟，该场景同样标 `delay_injected=true`。

`pure_text` 与 `single_tool` 本身没有 delays，零化后 `delay_injected=false`，进入主基线表。

## 统计

- 每配置 ≥30 次独立跑（每次新的 adapter 进程 / 新 invocation）。
- 报告 P50、P95；保留 raw 毫秒数组。
- 百分位：inclusive-rank，`rank = p/100 * (n-1)`，线性插值；见 `percentile()`。
