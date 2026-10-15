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
| `stream_chunk_ms` | 相邻流块到达间隔 | 无流或只有一块时为空数组。**first-chunk `stream_chunk_ms[0]`（prefix → 第一块 body）包含 mock 的完整 model 延迟**（live-stream 场景 `modelMs: 200`）；T-P1-05 归因时应排除 interval[0]，后续间隔才是 harness → Gateway → sidecar 转发开销。 |
| `n_chunks` | 流块次数（两个来源，不可混用） | **harness `n_chunks`**：adapter 产出的 `text_delta` 次数（`model.stream state=chunks`；planned 产物按 char 切片）。**perf `n_chunks` / `perf_n_chunks`**：Gateway 客户端观测到的 `assistant_text_delta` 次数（`collector.mjs` `markStreamChunk`）。若 Gateway/sidecar 合并 delta，两者会不同。T-P1-04 写入 snapshot，供 T-P1-05 归因；无流为 0 |
| `host_overhead_ms`（native） | native 无 sidecar；D4 锚仍是 `turn_ms(native)` | 含冷进程首次 in-process `try_auto_compact`；见构成说明 |
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

每次 iteration 都是**新 adapter 进程 + 新 sessionKey**，所以本基线测的是**冷进程首 turn**，不是长寿 Gateway 上的稳态 turn。

mock model 本身只有十几毫秒（`MockModelRuntime.stream` → `POST /v1/chat/completions`，`delays.*=0`）。分段后大头是 **`pre_model_ms`**（committed P50：native `pure_text` pre 536 / turn 563，约占 95%）。这不是 model HTTP，也不是 harness 的 `post("/control/state")`（该调用在 `markTurnEnd` 之后）。

**主体不是 `SessionRouter` 冷 session 创建。** 窗口里可以出现 `SessionRouter.getOrCreateActive` 的 create 分支，但 sidecar marks 显示 `pre_model` 的大头是进程内**第一次** host `context.try_auto_compact` module_call（tcp 约 430–470ms，stdio 约 404ms）；同一 turn 第二次调用只要约 36ms。这是冷进程首次调用的 lazy init（tokenizer / 编码器一类），是 per-process 成本。native 的 536 与 tcp 扣掉 handshake 后的约 511 同量级，大概率是同一笔。

P1 若只用 `turn_ms(native)` 当 D4 锚，锚的是「冷进程首 turn」，不是「一次 model HTTP」，也不是长寿进程上的稳态 turn（后者可能只有约 100–150ms，本关未测）。相对开销应同时看 `non_model_ms` / `pre_model_ms` 和 `model_iter_ms`。P1 可另加「同进程第 2 turn（热）」当稳态锚（本关不实现）。

### 为什么 stdio `single_tool − pure_text` ≈ +500ms（native 同差值只有 ~90ms）

stdio 是 **每 turn 冷 spawn 一个 Node sidecar**（`src/agent/modules/transport/stdioAgentLoopSidecarConnection.ts`：`connect()` → `spawn`；`AgentLoopDeploymentProfile.ts` 写明 “stdio child is per-turn”）。tcp 则在 harness 里 **先起一次 listener，30×2 次复用**（热连接）。

因此：

| 不对称 | 机制 |
|---|---|
| stdio 冷 | 每个 turn 都 `spawn(node, sidecar.js)` + hello/capabilities handshake |
| tcp 热 | `start_tcp_sidecar` 一次，之后只 `connect()` |
| native | 无 sidecar / 无 handshake |

干净树 30 次分段（P50，`gitSha=collectSha=248d7fbb`，`gitDirty=false`）把 stdio `single_tool − pure_text` 钉死了：

| | turn P50 | handshake | pre_model | between | tool | post_model |
|---|---|---|---|---|---|---|
| native `pure_text` | 563 | — | **536** | — | — | 14 |
| native `single_tool` | 658 | — | 522 | 76 | 2 | 13 |
| stdio `pure_text` | 1035 | **495** | 971 | — | — | 43 |
| stdio `single_tool` | 1561 | **502** | 997 | 89 | 2 | **431** |
| tcp `pure_text` | 627 | 80 | 591 | — | — | 15 |
| tcp `single_tool` | 699 | 77 | 555 | 89 | 2 | 14 |

结论：

1. **不是**每个 model/tool 再 spawn。handshake P50 在两个 stdio 场景都是 ~495–502ms，对应一次 `spawn(node, sidecar.js)` + hello/capabilities。
2. mock tool 本身只有 ~2ms。`between_model_ms` 三 transport 都在 ~80–90ms。
3. stdio 多出来的 ~526ms（1561−1035）**几乎全在 `post_model_ms`**（P50 431 / P95 435）。**不是** host 端 `Promise.race(next, sleep(500))` 自己加的时：那段循环在长寿 host 里，事件一到 `next` 就赢（`agentLoopSidecarClient.ts` 约 L382–414）。更可能的是 stdio 路径在 turn 窗内包含**子进程退出等待**（`close → closeChild → waitForExit`，`stdioAgentLoopSidecarConnection.ts`），退出时机被一个约 500ms 的定时器量化（相位依赖，跨机可能双峰；具体是哪个定时器 TBD）。native/tcp 的 post_model 仍是 ~13–15ms。
4. tcp 热连接 handshake ~77–80ms，形态 native ≈ tcp ≪ stdio，印证「冷 stdio vs 热 tcp」。

`non_model_ms` 已写入每条 sample 和 `primaryBaseline`，给 P1 D4 当诚实锚点。

### sidecar host pump 与 stdio 退出量化

host `AgentLoopSidecarRunner.run` 里的 `Promise.race([iterator.next(), sleep(500)])`（`agentLoopSidecarClient.ts`）在长寿 host 进程里泵事件；`next` 先到就走 event 分支，**解释不了** stdio `post_model` 的 ~431ms。stdio 窗内独有的是 child exit wait；committed stdio `pure_text` 有 28/30 条 `turn_end − stream_accepted` 落在 533±5ms，说明完成时刻被约 500ms 定时器量化。定时器身份 TBD。

## native「宿主开销」

- native 路径无 sidecar。`turn_ms(native)` 仍包含进程内首次 `context.try_auto_compact`（见上）。
- 本关不发明伪开销；以 `turn_ms(native)` 为内嵌宿主基线（**冷进程首 turn**）。
- P1 相对开销：`candidate_P95 - native_P95`，对照 `max(native_P95×10%, 5ms)`。
- **同机、同一次 run** 里同时跑 native / 候选 / tcp。committed JSON 只作形态和量级参考，**不作跨机门禁数**（QA/Arch 的 P50 可到 1.6×）。比较 `non_model_ms` 时同样遵守。

## Mock 延迟

- 默认 **关闭** 人为 `delays` / `toolDelays`（全部覆写为 `0`），测基础设施而非注入延迟。
- 无法关闭的场景：`delay_injected=true`，不进入主基线表（`primaryBaseline` / `excludedFromPrimary`）。
- `--keep-delays` 保留场景原值；此时若仍有正延迟，该场景同样标 `delay_injected=true`。
- **T-P1-05** 用 `--model-ms 200`：三条路径（native / TS-tcp / Rust-tcp）同一套 mock，`delays.modelMs=200`。对照写 **raw** 与 **net-of-delay**（`total − configuredModelMs × 该样本 model 次数`；流块只从 interval[0] 扣）。D4 = `max(native 净 P95×10%, 5ms)`，**只看净数**。delay-0 的 `evidence/perf-baseline/tcp.json` 只作形态参考，不直接比。`--model-ms` 场景 `delay_injected=true`，不进 T-P0a-03 `primaryBaseline`；对照读 `comparisonBaseline`。

`pure_text` 与 `single_tool` 本身没有 delays，零化后 `delay_injected=false`，进入主基线表。

## 统计

- 每配置 ≥30 次独立跑（每次新的 adapter 进程 / 新 invocation）。
- 报告 P50、P95；保留 raw 毫秒数组。
- 百分位：inclusive-rank，`rank = p/100 * (n-1)`，线性插值；见 `percentile()`。

## Provenance

- `gitSha` / `collectSha`：采集时的 `HEAD`，二者必须相同。
- `gitDirty`：默认必须为 `false`。脏树直接拒绝，除非 `--allow-dirty`。
- 本目录 evidence 采于干净树 `248d7fbbc639fc461baa503b3d3d41a17c6ad6b5`（`gitDirty=false`）。`812b8da3` 是加 JSON 的 evidence commit（当时 `HEAD^ == collectSha`）。
- 此后 tip 上可以只有文档 commit（例如 R8 归因更正），此时 **`HEAD^ == collectSha` 不必再成立**。核对 JSON 时看 `gitSha == collectSha == 248d7fbb` 且 `gitDirty=false`，不要用后来的 tip。
- `evidenceCommit`（加 JSON 的那次 commit）不能写进 JSON：该 SHA 依赖文件内容，无法在采集时预知。

## 已知局限（R4–R6）

- **跨机**：committed 绝对值不能当另一台机器上的 Rust 门禁。P1 必须同机同跑。
- **collector 单槽**：`openModel` / `openTool` / `turnStart` 各一个。并发 model（subagent）会互相覆盖；多 turn 分支只留最后一轮。当前 `pure_text` / `single_tool` 是单 turn、串行 model，不受影响。
- **RSS**：只统计 adapter/host Node；stdio/tcp 的 sidecar 内存不计；非 Linux（无 `/proc`）为 `null`。三 transport 的 RSS 不能直接比。
