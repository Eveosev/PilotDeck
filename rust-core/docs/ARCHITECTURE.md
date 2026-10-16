# 架构

> 本文讲**分层、数据流、线程与并发**。wire 字段级契约在 [PROTOCOL.md](PROTOCOL.md)，
> 上手与工作流在 [DEVELOPMENT.md](DEVELOPMENT.md)。

---

## 1. 分层

依赖方向是严格的单向链，**没有反向依赖，没有环**：

```
pilotdeck-transport   ← 进程、线程、IO、宿主调用转发
        │
        ├──▶ pilotdeck-agent      ← 领域策略（纯逻辑 + 端口）
        │           │
        │           ├──▶ pilotdeck-tokenizer   ← o200k 计数
        │           └──▶ pilotdeck-protocol    ← JS 语义值 / 线协议类型
        └──────────────────▶ pilotdeck-protocol
```

| crate | 一句话 | 允许做什么 | 禁止做什么 |
|---|---|---|---|
| `pilotdeck-protocol` | 固定产品的**边界兼容层** | JS/JSON 语义、信封校验、准入判定、值快照 | 任何 IO、transport、进程、账本、宿主权限 |
| `pilotdeck-tokenizer` | o200k 分词计数 | 纯计算 | 任何 IO |
| `pilotdeck-agent` | AgentLoop 领域策略 | 纯决策 + 经端口请求副作用 | 文件系统、provider、权限、Session 归属 |
| `pilotdeck-transport` | Module 2.0 的**进程与 IO 边界** | 线程、通道、超时、帧编解码、宿主传输 | 领域策略、伪造成功的循环 |

三句自述就是设计约束，值得逐字读：

- `pilotdeck-protocol/src/lib.rs:1`
  > Boundary compatibility for the fixed PilotDeck product. No host authority or IO.
- `pilotdeck-agent/src/lib.rs:1`
  > Pure AgentLoop helpers. No filesystem, provider, permission or Session authority.
- `pilotdeck-transport/src/lib.rs:1`
  > Module2.0 transport adapters, distinct from Gateway1.2 and host policy.

---

## 2. 核心设计：端口与效果

`pilotdeck-agent` 里**没有**文件系统句柄、provider 闭包、dispatcher map 或可变 Session。
所有副作用都通过两个办法请求宿主：

```rust
// pilotdeck-agent/src/ports.rs:1170-1173 —— 宿主接口就这两个方法
fn advertised(&self, module: &str, operation: &str) -> bool;
fn call(&mut self, control: &CallControl, call: HostCall) -> PortResult<HostReply>;
```

### 2.1 `HostCall` 是封闭枚举：24 个变体

`HostCall`（`ports.rs:909-992`）穷举了 sidecar 能向宿主提的全部请求，共 **24 个**
`(module, operation)` 组合，按 module 分组：

| module | operation |
|---|---|
| `model` | `get_metadata` · `prepare` · `materialize_prepared_request` · `stream_next` · `close_stream` · `stream` |
| `budget` | `estimate_request_input` · `evaluate_request_budget` · `estimate_usage_cost` |
| `turn` | `drain_steer` · `drain_or_close_steer` · `persist_compaction` |
| `capability` | `list_tools` · `execute_batch` · `execute` · `plan_todo` |
| `permission` | `decide` |
| `context` | `prepare_for_model` · `apply_tool_results` · `recover_from_model_error` · `capture_turn` · `try_auto_compact` |
| `lifecycle` | `dispatch` |
| `event` | `emit` |

关键契约（`ports.rs:909-911`）：

> Serialization is confined to the transport adapter; one owning worker consumes typed replies.
> Each reply must correspond to its call variant; `InvalidResponse` is not a missing-capability fallback.

也就是说：**「宿主没这个能力」是正常路径，不是异常兜底**。缺能力要在
`advertised()` 阶段就知道，绝不能拿 `InvalidResponse` 当能力缺失处理。

### 2.2 每个调用都带效果等级

`HostCall::effect()`（`ports.rs:993-1004`）给每个调用标 `CallEffect`：

| 效果 | 含义 | 未知接收时的处置 |
|---|---|---|
| `ReadOnly` | 只读查询 | 可以重试/重放 |
| `Advance` | 推进状态（如 stream_next） | 必须经账本对账，**不能盲目重发** |
| `SideEffect` | 有副作用（如 execute_batch） | 未知即终态，必须对账 |

这条区分贯穿全栈：`host_operations.rs:2118-2124` 的准入错误处理就是

```rust
let admission_error = |error| {
    if call.effect() == CallEffect::ReadOnly { error } else { unresolved() }
};
```

**只读调用保留原始错误，有副作用的调用一律升级为 `AcceptedUnknown`。**

### 2.3 `AcceptedUnknown` 是整个恢复体系的安全底座

已派发但没拿到确认的效果，**永不被改写、永不换新身份重派、永不重放**
（`ports.rs:325-330`、`turn.rs:765-766`、`turn.rs:1993-1994`）。
工具批次里也是：所有 durable ack 消费完之后才允许应用修复决策
（`turn.rs:2026-2030`）——顺序本身就是契约。

### 2.4 双重视图：规范化 + `BoundaryOnly`

每个准入值同时保留两个视图：

1. **规范化领域视图**（canonical model 类型）；
2. **精确原始边界**（`JsValue` 快照，保住 `own undefined`、WTF-16、键序）。

归一化不了的时候用 `BoundaryOnly(Vec<ProjectionGap>)`——`ports.rs:27-31` 的原话：

> Keep and forward it; never invent an empty view.

`ProjectedMessage` / `MessageProjection`（`lib.rs:353-365`）同理：
`Never a fabricated empty Message, deleted block or new runtime failure.`

---

## 3. 一次 turn 的生命周期

真正的状态机是 `turn.rs` 的 `run_admitted_turn`（`turn.rs:455-2257`），
一个 `loop { }` 里跑完所有阶段。逐阶段（括号内为 `turn.rs` 行号）：

```
 1  入口守卫            control.check()；取消则 finish_pre_model_abort            (501-513)
 2  steer 排空          TurnDrain → annotate + push + SteerApplied              (514-534)
 3  pre-route 压缩      读 pre_route 限额 → AutoCompact → install               (535-591)
 4  请求装配与路由      prepare → ModelPrepare → 观察 metadata → routed 压缩     (592-729)
                        → cap_prepared_request → ContextBudget 事件
 5  输入估算与模型调用  BudgetEstimate → run_source_model_invocation            (734-764)
                        （live 事件边走边发）
 6  disposition 分派    PortFailure / AcceptedUnknown 保留原身份                (765-825)
                        （流被取消要区分 StreamThrew / StreamCompleted）
 7  结算与预算          final_message + charge usage → 预算策略 → budget 终局    (925-957)
 8  early stream 恢复    select → Retry（补部分文本+合成提示）/ Exhausted        (958-1004)
 9  output 恢复 / LFR    select → NeedsLargeFileRepair → apply_pre_emission      (1036-1078)
10  assistant 发布      annotate → final_message → push → AssistantMessage      (1079-1089)
11  assembled error 链  reasoning 重试 → 缺失 tool result 投影+ack → JSON 自纠   (1097-1467)
                        → 普通错误探针 → compact_and_retry → decisions 重试
                        → image strip → 残余 max-output Phase A/B/C
12  无工具/停止路径      Stop lifecycle → stop_block / content_filter → Completed(1581-1700)
13  工具批次            ToolCallsDetected → 执行泵 → 逐结果事件                (1709-2255)
                        → project + tool context → durable ack（之后绝不重放）
                        → 修复决策 → LFR 无效输入 → 熔断 → max_turns
```

三条必须记住的顺序不变量：

- **`Source` 先构造 result，再发布 `stop_failure`，最后求值延迟状态**
  （`turn.rs:2968-2969`）。
- **状态转换可能在更早的公开 partial 之后真的抛错**（`turn.rs:2893-2894`）——
  这不是 bug，是复刻源行为。
- **可见长度恢复发生在 durable assistant 发布之后**（`turn.rs:1468-1469`）。

### 3.1 事件

`TurnEvent`（`turn.rs:312-382`）是领域侧事件词表：`ContextBudget`、`RecoveryCap`、
`TokenCapAdjusted`、`ModelRequestStarted`、`Model`、`AssistantMessage`、
`ToolCallsDetected`、`ToolResult`、`ToolResultsProjected`、`ModeChangeRequested`、
`SteerApplied`、`Continued`、`StopRequested`、`StopFailure`、`AgentStatus`、
`Failed`、`Completed`。

`turn_wire.rs:118-143` 把它投影成线上 `type`（`turn_continued` / `turn_failed` /
`turn_completed` …）；`Continued.reason` → `next_turn | user_steer | auto_compact | model_error`
（`turn_wire.rs:274-285`）。所有事件先经 `annotate_message` / `emit_event` /
`emit_accepted_event`（`turn.rs:4115-4150`）打上 timeline 坐标。

### 3.2 终结函数族

终局是**一族**函数，不是一个：`finish_pre_model_abort`(2602)、
`finish_aborted_after_tools`(2691)、`finish_early_stream_exhausted`(2846)、
`finish_emergency_compaction`(2939)、`finish_plain_model_stream_throw`(3022)、
`finish_ordinary_model_error`(3350)、`finish_budget_terminal`(3596)、
`finish_failed_tool_terminal`(3715)、`finish_tool_terminal`(3747)、
`finish_aborted_stream`(4176)、`finish_output_plan_terminal`(7944)。

每个终局函数负责的事件序列不同（例如预算终局是：安全 assistant → `StopFailure` →
状态 → `Failed` → capture → `Completed`）。**不要试图把它们合并成一个**——
差异就是行为。

---

## 4. `X.rs` / `X_policy.rs` 成对约定

`lib.rs:7-42` 里每个恢复模块都成对声明：

```rust
pub mod output_recovery;
mod output_recovery_policy;      // 私有
```

| 文件 | 角色 | 依赖 |
|---|---|---|
| `X_policy.rs`（私有） | **纯决策内核**：不可变输入 → `Plan`/`Decision` | 无端口、无时钟、无锁 |
| `X.rs`（公开） | **门面**：输入/计划/动作类型 + `Original*Policy` 单元结构 | 一行转发到 policy |

好处是 policy 可以被集成测试用 `#[path]` 直接引进来单测，例如
`tests/budget_terminal.rs:13-14`、`tests/request_assembly.rs:22`、
`tests/source_model_reducer.rs:5`、`tests/tool_context.rs:14`。

**唯一例外**是 `tool_context_policy::apply`，它接收 `host: &mut dyn HostPort`
（`tool_context_policy.rs:269-272`）——因为「把已执行结果应用到上下文」本身就是宿主往返。
它的边界改成 `No tool execution, filesystem, permissions or transcript authority lives here`。

> 实践含义：**改行为改 `_policy.rs`，改接线改 `X.rs`**。绝大多数单测打在 policy 层。

---

## 5. 请求装配

`request.rs:1`：`Per-request context assembly state, separate from routing and turn policy.`

- `RequestPreparationState`（`request.rs:11-17`）持有 tools / metadata / todo addendum /
  elicitation / token caps。
- `RouteTokenCaps` 是**只读冻结投影**：`Assembly reads it; only the owning turn recovery
  machine may replace cap state`（`request.rs:96-106`）。

请求体在 `request_assembly.rs:1051-1096` 构造，字段：
`provider` · `model` · `messages` · `systemPrompt` · `tools` · `toolChoice` ·
`maxOutputTokens` · `speed` · `thinking` · `stream:true` · `metadata` ·
`cacheBreakpoints` · `cachePlan`。

组装顺序（顺序即契约）：`ListTools`(964-970) → 路由覆盖 → `context_preparation` →
宿主 `PrepareContext` 或 `no_context` → 观察 `instructions_loaded` → Plan 模式追加
synthetic reminder → `build_cache_plan` → `systemPrompt` 缺失回退 config →
`output_cap` → thinking 覆盖优先于 model_override。

两个易错点：

- `stable_serialize` 是 `CachePlan.stableSerialize`，**不等于**普通请求 JSON 身份
  （`request_assembly.rs:70,73`）。
- `InstructionsLoaded` 用 **prepared** prompt 的真值，而不是最终 config 回退
  （`request_assembly.rs:996-1002`）。

---

## 6. 恢复策略族速查

| 模块 | 何时触发 | 做什么 |
|---|---|---|
| `early_stream_recovery` | `streamInterruption` 且计数 <2，或 `finishReason=="unknown"` 且计数 <2 | `Retry{clear_final_message, retain_partial_text}`，超限 `Exhausted` |
| `ordinary_error_recovery` | assistant 已 durable 发布、reasoning 一次性重试已被拒之后 | 为每个已组装 call 造 `createMissingToolResult`；JSON 自纠 ≤3 次（严格 code 相等） |
| `output_recovery` | ① 有 repaired tool call；② 可见文本为空 | repaired → `NeedsLargeFileRepair` 令牌（先 name-only 查询）；empty → 首次重试 / `consecutive_empty<3 && count<50` / `EmptyExhausted`；cap 双倍且不超模型上限 |
| `tool_error_recovery` | 已准入的首方工具错误 | 生成 message + advice（evidence/summary/classify/actions/avoid） |
| `tool_failures` | FIFO 配对后、LFR 之前 | 重复失败注解；同指纹 ≥3 → 用掉一次 grace 提示 → 再重复则 `Stop{repeated_failures}` |
| `large_file_repair` | pending 期间收到 invalid tool input / 未写文件 / 出现 write 名截断 | `pre_draft`/`post_draft`/重试/截断恢复（上限 5/5/10）；**从不自己写文件** |
| `usage_fallback` | provider usage 缺失或不全 | 用真实分词器对 text/thinking/tool_call.input 计数，合成 usage |
| `budget_terminal` | 命中预算 | 用 ledger 复算并**校验**调用方传入的 stop 一致 |
| `compaction_terminal` | 紧急压缩 | error + 延迟 status detail |
| `compaction_persistence` | 压缩替换落盘 | replacement 与 commit 两相位分离 |

`driver.rs` 里的 `RetryGuards`（`driver.rs:179-285`）持有各重试预算：
`retry_stream_interruption(2)` · `retry_unknown_finish(2)` · `retry_json(3)` ·
`continue_output(50)`。

`large_file_repair.rs:10-12` 的三个上限：`PRE_LIMIT=5`、`POST_LIMIT=5`、
`TRUNCATION_LIMIT=10`。

---

## 7. 线程与并发模型

**同步实现，没有 async runtime。** 一条连接 = 3 条线程 + 可选事件线程 + N 个 timer 线程。

```
                     ┌──────────── 主线程（serve）────────────┐
                     │ 起 reader / writer / worker，等 done   │
                     │ retire() → grace 内 5ms 轮询 join       │
                     └───────────────────────────────────────┘
   stdin ──▶ reader 线程 ──▶ 解析 NDJSON ──▶ 派发/控制（改状态）
   stdout ◀── writer 线程 ◀── control 队列 > data 队列
                     worker 线程 ──▶ 执行 turn ──▶ 端口调用宿主
```

- `serve()`（`server.rs:743-819`）起 reader / writer / worker，三者各向 `mpsc` 送一次 done；
  主线程收一次即 `retire()`，然后在 grace 内以 **5 ms** 轮询 `is_finished()`，
  **只 join 已结束的线程**，返回 `ShutdownReport`。
- worker 每轮 `catch_unwind`（`server.rs:595-598`），panic → 转成
  `"Execution worker panicked."` 的 failed terminal，避免操作永挂。
- `Cancellation` 是引擎级共享信号（对应 TS `AbortSignal`），原因有
  `Requested(reason)` / `Deadline` / `OwnerRetired` / `TransportClosed`，
  并区分普通取消与 `hard_stop_cause()`。

### 7.1 背压：满了就退休连接，而不是阻塞 reader

所有队列都有界（`stdio.rs:175-176` 的原话）：

> Reader never waits for output capacity. Controls change cancellation/state first;
> output overload retires the connection instead of freezing input.

- `ConnectionOwner` 的 `control` / `data` 两条 `VecDeque`，容量 = `queue_capacity`。
  `send_control` / `send_cached_stream` 满则 `self.close()` 并返 `WouldBlock`
  （`stdio.rs:183-190, 207-214`）。
- writer 优先级 `control` > `data`（`stdio.rs:334`）。
  缓存的终局**不能**进 priority 队列，否则会超车自己的前缀（`stdio.rs:199-200`）。
- worker 侧 `publish()` 是唯一**会等待**的路径，被「取消 / EOF / 输出推进」三者之一唤醒
  （`stdio.rs:225-247`），且不持 state 锁。

### 7.2 取消与对账

`PendingExchange::wait`（`stdio.rs:588-753`）是设计核心：已派发（非 `Queued`）的调用
遇取消**不能**直接报错，而是取**单调**的 `reconciliation_deadline`
（5 s grace 与 `control.deadline` 取 min）：

> The bound is monotonic and never extended by duplicate wakes.（`stdio.rs:699-708`）

期间允许迟到的合法 ACK 结算；超期才落 `Unresolved` 并返 `AcceptedUnknown`。
未派发的直接撤销记录**并**从 `data` 剔除对应 packet，防「writer 已出队但未 mark dispatched」的竞态。

### 7.3 容量与超时的确切数字

| 数字 | 位置 | 含义 |
|---|---|---|
| **64** | `bin/pilotdeck-agent-loop-sidecar.rs:58` | control 队列 + data 队列各自上限；**也是并发在途 module call 的上限** |
| **64** | `notifications.rs:44` | advisory event `sync_channel` 容量 |
| **64** | `notifications.rs:218` | advisory lifecycle pending 上限 |
| **32** | 同上 `:58` | 待执行 operation 队列上限；超过 → `EXECUTION_QUEUE_FULL` |
| **5 s** | `server.rs:149,671`、`notifications.rs:141,245`、`stdio.rs:700` | 各 cleanup 路径统一预算 |
| **5 s** | `bin:62` | 进程级收尾 grace |
| **5 ms** | `server.rs` retire 轮询间隔 | join 检查粒度 |
| **2 147 483 647 ms** | `server.rs:501-507` | 每操作 deadline 相对 now 的 clamp 上界（对齐 Node timer） |
| **8 640 000 000 000 000** | `system_clock.rs:34` | V8 `TimeClip` |
| **9 007 199 254 740 991** | `host_operations.rs:1690` | `MAX_SAFE_INTEGER` 上界 |

---

## 8. 测什么，怎么测

三段式，**没有 golden/snapshot 目录**（`pilotdeck-agent/tests/` 是扁平目录）：

1. **`src/` 内 `#[cfg(test)]` 模块**：`ports.rs:1175-1229`；`turn.rs` 有 10 个测试模块
   （位置 4464/4589/4637/4830/5390/6668/7994/8087/8440/8576），共 77 项。
2. **集成测试用 `#[path = "../src/X_policy.rs"]` 直引私有纯策略**，
   绕过公开面单测 policy。
3. **期望值由 pinned Source 手工推导**（`AgentLoop.ts` / `TurnTimeline.ts` /
   `toolPairIntegrity.ts` / `errorRecovery.ts` / `events.ts`）；
   测试头注释普遍**自陈不是可执行 parity**（`tests/timeline.rs:1-2`、
   `tests/pure_helpers.rs:3-4`）——真正的对拍在外部做（见 [DEVELOPMENT.md](DEVELOPMENT.md) §7）。

transport 侧另有几类值得注意的测试：

- `tests/host_contract.rs`（52 项）——24 个 tag 的 effect/reply 配对全覆盖。
- `tests/bounded_capture.rs`（18 项）——真实 `run_admitted_turn` + 并发 `ConnectionOwner`，
  参数化 pending/deadline/cancel 矩阵。
- `tests/deadline_terminal.rs`（4 项）——用 **Unix socket pair** 跑生产 factory + turn + server，
  host 回复是唯一 fixture，不碰 TCP、不碰 provider。
- `tests/system_clock.rs`（35 项）——`include_str!` 冻结的真 Node 22.22.0 观测。
- `tests/launch_arguments.rs`（1 项）——用 `CARGO_BIN_EXE_*` 起真二进制验退出码。

---

## 9. 已知未实现的部分（显式失败，不是静默降级）

这个 crate 是**部分移植**。缺口一律**可见失败**：

- `turn.rs:450-453`：
  > The recovery decision table, budget terminal wording, progress pump and live
  > seed/model checkpoints are still explicit unimplemented profiles.
  > They fail visibly before further effects.
  触发点是 `profile_gap()`（`turn.rs:3966`）。
- `default_factory.rs:1075-1079`：遇到领域 profile 缺口返回
  `"Rust factory candidate has not implemented {profile}."`，**不伪造成功的循环**。
- 部署 profile：`PILOTDECK_AGENT_LOOP_FACTORY` 与 `PILOTDECK_AGENT_LOOP_TCP_PORT`
  非空即拒绝（exit 2）——只有 stdio profile 实现了。

> 看到 gap 的含义是「这条路径还没做完」，**不是**「可以静默降级」的许可。
