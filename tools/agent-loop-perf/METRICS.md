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
| `non_model_ms` | `turn_ms − sum(model_iter_ms)` | P1 对照时必须同时看这一项，避免把会话/sidecar 冷启动当成 model 开销 |
| `stream_chunk_ms` | 相邻流块到达间隔 | 无流场景可空数组 |
| `host_overhead_ms`（native） | **不是** module_call；native 无 sidecar | 见下一节 |
| `rss_kb` | `/proc/self/status` 的 adapter/host Node `VmRSS` | 不含 sidecar 进程；macOS 为 `null`；不是本关门禁 |

`adapter_wall_ms` / `gateway_outside_turn_ms` 仅作调试：整段 adapter 进程（含 Gateway 启动/拆除）。主表只用 `turn_ms`。

分段（`segments.*`，R1）：

| 字段 | 窗口 |
|---|---|
| `first_gateway_event_ms` | `submit_turn` → 第一条 Gateway 流事件 |
| `pre_model_ms` | `submit_turn` → 第一次 `model.request` |
| `model_sum_ms` | 各次 `model_iter_ms` 之和 |
| `between_model_ms[]` | 相邻两次 model 之间的间隙（含 tool / module_call） |
| `tool_ms` | mock tool `execute` 本身（`/tools/execute`） |
| `post_model_ms` | 最后一次 model 结束 → `turn_completed` |
| `handshake_ms` / `stream_accepted_ms` | sidecar 仅有；相对 turn start |

## `turn_ms` 窗口（R1，已核对）

计时只包 adapter 里 **`client.stream("submit_turn")` → 收到 `turn_completed`**：

- 起点：`tools/agent-loop-parity/adapters/pilotdeck_gateway_impl.mjs` 约 `perf.markTurnStart()`，紧挨 `client.stream("submit_turn", …)`（单 turn 路径）。
- 终点：同一 `for await` 里 `event.type === "turn_completed"` 时 `perf.markTurnEnd()`。
- **在窗口外**（不算进 `turn_ms`）：`createLocalGateway` / `startPilotDeckServer` / WS connect；流结束后的 `post("/control/state")`、`readSettledTranscript`、写 trace。这些落在 `gateway_outside_turn_ms`。
- **窗口内没有** harness 的 `waitForSubagent*` / 状态轮询。`pure_text` / `single_tool` 不会启动 cancel/steer/close 任务。

因此 Analyst 的拆法成立：`non_model_ms ≈ turn_ms − model_sum`；`adapter_wall − turn` 是 Gateway 启停，不在 `turn_ms` 里。

## 构成说明（代码路径 + 分段）

### 为什么 native `pure_text` 的 ~530ms 不在 model 里

`pure_text` 每次 iteration 都是**新 adapter 进程 + 新 sessionKey**。`submit_turn` 第一次命中 `SessionRouter.getOrCreateActive` 的 create 分支（`src/gateway/SessionRouter.ts` 约 L173–181），在 turn 内做会话物化、AgentLoop 装配、写 user 消息、跑 loop、再持久化 assistant / `turn_completed`。

mock model 本身只有十几毫秒（`MockModelRuntime.stream` → `POST /v1/chat/completions`，`delays.*=0`）。分段后大头是 **`pre_model_ms`**（一次调查样本：native `pure_text` turn 624 / model 15 / non_model 609 / **pre_model 594** / post_model 15 / first_event 88 / `gateway_outside_turn` 815）。也就是 ~97% 的 `turn_ms` 花在第一次 `model.request` **之前** 的冷 session 装配，不是 model HTTP，也不是 harness 的 `post("/control/state")`（该调用在 `markTurnEnd` 之后）。

P1 若只用 `turn_ms(native)` 当 D4 锚，锚的是「冷 session 的宿主 turn」，不是「一次 model HTTP」。相对开销应同时看 `non_model_ms` / `pre_model_ms` 和 `model_iter_ms`。

### 为什么 stdio `single_tool − pure_text` ≈ +500ms（native 同差值只有 ~90ms）

stdio 是 **每 turn 冷 spawn 一个 Node sidecar**（`src/agent/modules/transport/stdioAgentLoopSidecarConnection.ts`：`connect()` → `spawn`；`AgentLoopDeploymentProfile.ts` 写明 “stdio child is per-turn”）。tcp 则在 harness 里 **先起一次 listener，30×2 次复用**（热连接）。

因此：

| 不对称 | 机制 |
|---|---|
| stdio 冷 | 每个 turn 都 `spawn(node, sidecar.js)` + hello/capabilities handshake |
| tcp 热 | `start_tcp_sidecar` 一次，之后只 `connect()` |
| native | 无 sidecar / 无 handshake |

committed 30 次分段（P50）把 stdio `single_tool − pure_text` 钉死了：

| | turn P50 | handshake | pre_model | between | tool | post_model |
|---|---|---|---|---|---|---|
| native `pure_text` | 582 | — | **552** | — | — | 14 |
| native `single_tool` | 675 | — | 546 | 78 | 2 | 14 |
| stdio `pure_text` | 1076 | **508** | 1029 | — | — | 27 |
| stdio `single_tool` | 1570 | **508** | 1007 | 92 | 2 | **428** |
| tcp `pure_text` | 620 | 81 | 587 | — | — | 15 |
| tcp `single_tool` | 799 | 85 | 619 | 101 | 3 | 15 |

结论：

1. **不是**每个 model/tool 再 spawn。handshake P50 在两个 stdio 场景都是 508ms，对应一次 `spawn(node, sidecar.js)` + hello/capabilities。
2. mock tool 本身只有 ~2ms。`between_model_ms` 三 transport 都在 ~80–100ms。
3. stdio 多出来的 ~494ms（1570−1076）**几乎全在 `post_model_ms`**（P50 428 / P95 433，非常紧）：最后一次 model 结束后，要等到 sidecar `execute` 收尾并打出 `turn_completed`。这与 `AgentLoopSidecarRunner.run` 里 `Promise.race(next, sleep(500))` 的心跳窗口同量级（`agentLoopSidecarClient.ts` 约 L383–390）。native/tcp 的 post_model 仍是 ~14–15ms。
4. tcp 热连接 handshake ~81ms，形态 native ≈ tcp ≪ stdio，印证「冷 stdio vs 热 tcp」。

`non_model_ms` 已写入每条 sample 和 `primaryBaseline`，给 P1 D4 当诚实锚点。

### sidecar 500ms pump 的位置

`src/agent/modules/transport/agentLoopSidecarClient.ts`（`AgentLoopSidecarRunner.run`）：`Promise.race([iterator.next(), sleep(500)])`。仅 sidecar 路径；native 没有。用途是把 host 事件/heartbeat 泵出来，不是固定加时。

## native「宿主开销」

- native 路径无 sidecar / module_call。
- 本关不发明伪开销；以 `turn_ms(native)` 为内嵌宿主基线（冷 session）。
- P1 相对开销：`candidate_P95 - native_P95`，对照 `max(native_P95×10%, 5ms)`。
- **同机、同一次 run** 里同时跑 native / 候选 / tcp。committed JSON 只作形态和量级参考，**不作跨机门禁数**（QA/Arch 的 P50 可到 1.6×）。比较 `non_model_ms` 时同样遵守。

## Mock 延迟

- 默认 **关闭** 人为 `delays` / `toolDelays`（全部覆写为 `0`），测基础设施而非注入延迟。
- 无法关闭的场景：`delay_injected=true`，不进入主基线表（`primaryBaseline` / `excludedFromPrimary`）。
- `--keep-delays` 保留场景原值；此时若仍有正延迟，该场景同样标 `delay_injected=true`。

`pure_text` 与 `single_tool` 本身没有 delays，零化后 `delay_injected=false`，进入主基线表。

## 统计

- 每配置 ≥30 次独立跑（每次新的 adapter 进程 / 新 invocation）。
- 报告 P50、P95；保留 raw 毫秒数组。
- 百分位：inclusive-rank，`rank = p/100 * (n-1)`，线性插值；见 `percentile()`。

## 已知局限（R4–R6）

- **跨机**：committed 绝对值不能当另一台机器上的 Rust 门禁。P1 必须同机同跑。
- **collector 单槽**：`openModel` / `openTool` / `turnStart` 各一个。并发 model（subagent）会互相覆盖；多 turn 分支只留最后一轮。当前 `pure_text` / `single_tool` 是单 turn、串行 model，不受影响。
- **RSS**：只统计 adapter/host Node；stdio/tcp 的 sidecar 内存不计；非 Linux（无 `/proc`）为 `null`。三 transport 的 RSS 不能直接比。
