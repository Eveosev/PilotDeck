# 评审意见 · Rust 重构两条线（2026-10-15）

对照调查报告（2026-10-15），以及后补的 slim 源码：rust-core 的 `Cargo.toml`、`rust-toolchain.toml`、`ports.rs`、`driver.rs`、`lib.rs`、`stdio.rs`、`host_operations.rs`、`PROVENANCE.md`，`turn.rs` 的 `profile_gap` 索引与片段，本仓探针片段。本仓行为代码仍以 `rust_standalone_alpha1` @ `f44b3789` 为准。`turn.rs` 全文、`default_factory.rs`、sidecar 入口二进制不在这批提取里，对应行号只在索引或 ARCHITECTURE 能对上时才写成确认。

判定只用三个词：

- **确认**：本仓代码或附件文档对得上。
- **修正**：大意成立，但范围、数字或「现在还是否如此」需要改。
- **推翻**：结论与能核对的材料相反。

本轮没有用「推翻」否定总判断：两条线互补，不该继续把探针单体长成 53 场景。几处操作建议（直接丢进对拍、19 倍仍是当前缺口、moduleId 仍未处理、26 个 PR）大意过时或和工具行为不符，记为修正，不整段作废。

## 七问

### 1. 核心选型

**建议采用调查 §7 的默认立场：rust-core 四个 crate 做 P2 领域核心，本仓 `pilotdeck-agent-loop` 降为探针。** 这是计划决议（D-CORE），不是已经发生的代码切换。实施挂在对拍门和性能门后面。

依据：

- 探针的生产循环仍是 `run_stub_execute`（`crates/pilotdeck-agent-loop/src/sidecar.rs:594`）。第二轮模型若再带 tool call，直接 `UNEXPECTED_SECOND_TURN_TOOL_CALLS`（同文件 `:676`）。`resume` / `ack` 返回失败（`:209-218`），capabilities 里 `enabled: false`（`:547-548`）。recovery 只有 `tool_execution_failed` 一条（`error_recovery.rs:1-8`）。
- rust-core 的 `HostPort` 只有 `advertised` 和 `call`（`ports.rs:1171-1172`）。`HostCall` 从 `:913` 起有 26 个变体，`method()`（`:1017-1047`）收成 24 个 `(module, operation)`，与注释「24 actual host operations」（`:909`）一致。缺口走 `profile_gap`，报错原文是 `Rust normal-turn candidate has not implemented {profile}.`（片段里的 `fn profile_gap`，索引行号 `turn.rs:3966`）。P3「按模块把宿主调用换成本地实现」落在这个枚举上。
- 继续在探针上补 53 场景，等于重写这份已经拆开的核心。探针已经完成它的工作：stdio/TCP、hello token、两场景对拍、性能数字。

不采纳的做法：在 T-P2-02 / T-P2-03 出结果之前删除探针，或把产品默认 transport 指到一个还没在本仓对拍装置里跑过的二进制。

### 2. 对拍方案与 `profile_gap`

**可以跑，不是零改动直接跑。** 协议版本两边都是 Module 2.0（本仓 `lib.rs:69`，`src/agent/modules/protocol.ts:1`）。stdio 部署档会给子进程追加 sidecar 路径参数。本仓二进制遇到未知参数 exit 2（`lib.rs:50-52`）。rust-core 的 `PROVENANCE.md:106` 写明入口额外接受恰好一个非空、不以 `--` 开头的位置参数并忽略它，非法参数仍 exit 2。

身份门在本仓，不在二进制：

- 包装脚本 `tools/agent-loop-parity/rust-stdio-sidecar.sh` 丢掉多余参数，并把解析后的路径写入 exec proof。
- `trace.py:367-369` 要求该路径以 `pilotdeck-agent-loop` **结尾**。rust-core 的二进制名是 `pilotdeck-agent-loop-sidecar`（README 快速开始），结尾对不上，harness 会把 rust 意图判成 BLOCKED（`trace.py:404-407`）。
- 因此 T-P2-02 的跑法是：把 rust-core 的 release 二进制符号链接成名为 `pilotdeck-agent-loop` 的路径，设 `PILOTDECK_RUST_SIDECAR_BIN`，再用现有 `--pilotdeck-stdio-sidecar-cmd tools/agent-loop-parity/rust-stdio-sidecar.sh`。不要新写协议，也不要改判定规则来凑名字。

工作量落在三处，都不在产品 crate：

1. 上述链接和一次 `pure_text` 冒烟（需要 Node 22 与 `pnpm build`，以及一份仓外编好的 rust-core 二进制；本仓没有那份源码）。
2. `run.py --scenario all --surface gateway --sidecar-transport stdio` 一次。分母 53（`run.py:46-66`）。
3. 读 summary，把失败分成 `profile_gap` / trace diff / BLOCKED。真正费时间的是其后的补缺口，不是这次测量。

**`profile_gap` 有多少处。** 索引文件 32 行。其中 `:453` 是 CORE gate 注释，`:455` 是 `run_admitted_turn` 的签名，这两行没有调用。其余 30 行含 `profile_gap`，里面 `:3966` 是函数定义。调用点是 **29** 处。调查写「约 30 / 计数 30」，把 `fn profile_gap(` 算进去了，差这一处。报错句在定义里，不是 `unimplemented!`。

注释（片段，对应 `turn.rs` 里 `run_admitted_turn` 上方）仍把未实现面概括成四句：recovery 决策表、预算终局文案、progress pump、live seed/model checkpoint。这四句**不是**调用点上的 profile 名字。索引里已经展开的字符串是另一组：工具结果的 open/annotated projection（`:147` `:153` `:1140` `:1789` `:1978`）、输出与上下文 cap（`:160` `:167` `:175`）、压缩预览和请求重建（`:227` `:242` `:253`）、large-file repaired-call 查询（`:1056`）、missing-result pairing（`:1900`）、open context consumer（`:1991` `:1999`）、recovery assistant 收集（`:2743`）、model-error 的非字符串 route / 数字强制 / JSON 序列化（`:3169` `:3316` `:3377`）、非字符串 route 与非数组/非字符串文本（`:4104` `:4377` `:4405`）、canonical request fingerprint（`:7083`）。`:1700` `:2310` `:2456` `:3144` `:4083` `:7237` 六行参数跨行，索引没有带出字符串；`:7237` 只看得出落在 `VisibleLengthExhausted` 这条臂上。

`default_factory.rs` 不在这批提取里。factory 的 `gap()` 行号仍只以 ARCHITECTURE 为准，调查的 `:744-882` 和文档的 `:1075-1079` 对不上。能核对的是 `host_operations.rs`：`:423` 起已经按 `PlanTodo` 序列化，其中包含 `mark_tool_progress`（`:429`）；`:612` 起解析 model metadata。不能把「factory 有缺口」理解成这两条 operation 没有接线。

**预计会撞上的场景（预测，不是实测）。** 对照 `run.py:51-66` 的 53 个 id：

| 可能性 | 场景 | 对上的调用点 |
|---|---|---|
| 高 | `auto_compact`、`sidecar_durable_compaction`、`sidecar_full_request_compaction_budget`、`sidecar_projected_request_compaction_budget` | 期望里有压缩。`:227` `:242` `:253` 是预览和请求重建，不是「完全没有压缩模块」。走进这三条分支就会 gap |
| 中 | `model_retryable_error`、`model_non_retryable_error`、`malformed_model_response`、`stream_interruption`、`tool_retryable_error` | 错误对象的形状和 recovery pairing（`:1900` `:2743` `:3169` `:3316` `:3377`）。mock 若给出普通字符串错误，可能绕开，落到已有 recovery 上变成 trace diff。注释里的决策表仍可能先失败 |
| 中 | `large_tool_result` | 只有走进 `:1056` 的 large-file repaired-call 查询才 gap |
| 中 | `sidecar_budget_limit`、`sidecar_sdk_tool_progress`、`sidecar_seed_read_state`、`checkpoint_resume`、`write_snapshot_resume` | 只在 `:453` 那条注释的上文里被点名，已展开的调用字符串对不上。progress 在 `host_operations.rs:429` 已有 `mark_tool_progress`。这五条可能是 gap，也可能是文案差 |
| 低 | `pure_text`、`single_tool`、其余普通工具 / 权限 / 取消 / deadline / image | 没有同名 gap。工具回包一旦走 open projection（`:147` `:153` `:1140` `:1978`）仍会失败 |
| 不按 gap 预判 | `sidecar_live_steer`、`sidecar_live_model_stream`、两条 elicitation、两个 plan-mode、七个 subagent、三条 `get_metadata` 场景 | `drain_steer`、`stream_next`、`get_metadata`、`plan_todo` 都在 `HostCall::method`。metadata 解析在 `host_operations.rs:612`。子代理工具由宿主执行 |

StaffDeck 专有场景不在这 53 个里。第一次全量跑完，以终态里的 `has not implemented` 为准，替换上表。budget / progress / seed 不能只凭 `:453` 的注释标成高概率。

### 3. 性能，以及 PC2 是不是实现问题

**PC2 是本仓探针的实现开销，不是「用了 Rust」或「用了 TCP」的地板。** 它也还不是「换成 rust-core 就会进 D4」的结论。

`evidence/p1/go-nogo.md`（#37，modelMs 200）里，model 迭代净 P95 相对 native：

| 场景 | Rust-tcp | TS-tcp | D4 |
|---|---:|---:|---:|
| `pure_text` | +21.341 ms，差/D4 = 4.268 | −5.435 ms | 5 ms |
| `single_tool` | +13.546 ms，差/D4 = 2.709 | +5.402 ms | 5 ms |
| live-stream chars=50 | +96.788 ms，差/D4 = 19.358 | +31.980 ms | 5 ms |

同机 TS-tcp 贴着 native，所以多出来的十几到二十几毫秒在探针自己的路径上。整 turn 的 Rust-tcp 仍在 D4 内（pure_text 0.496，single_tool 0.089，同文件 §1）。

10ms 常量解释不了这组数。`STUB_POLL_MS`（`sidecar.rs:16`）用在 `call_host_module` 的 `recv_timeout`（`:1372`）和 stub sleep（`:1535`）。`recv_timeout` 在回复到达时返回，不是每跳固定睡 10ms。stdio 读循环是阻塞 `read_until`（`stdio.rs:29-31`），也没有 10ms 节拍。

19 倍那一格是另一件事，而且已经过时：#37 记录探针只发一次性 `stream`、把多段 delta 合成一段。#40 改为声明了 `stream_next` 就增量拉（`sidecar.rs:1965` 起）。PC1 第 3 项仍 open（1.394 / 1.822），但不应再引用 19.358。#40 和 #46 都没有重采 model 迭代，所以 4.268 / 2.709 仍是当前书面数字。

对照怎么做：

- rust-core 现在不能走 perf 的 TCP。入口在设置 TCP 端口时 exit 2（`ARCHITECTURE.md:362-363`）。
- perf 的 CLI 只有 `--pilotdeck-tcp-sidecar-cmd`（`tools/agent-loop-perf/run.py:646`）。stdio 自定义二进制要靠环境变量 `PARITY_STDIO_SIDECAR_COMMAND`：adapter 会读它（`adapters/pilotdeck_gateway_impl.mjs:727-728`），perf 复制了进程环境。这条能测，但 CLI 没有这个参数，exec proof 也不会自动写上。T-P2-03 应把命令和证明路径显式传进去，避免测到 TS sidecar 还以为是 Rust。
- 第一轮只比 stdio：native、本仓探针、rust-core，同一 `modelMs=200`，n=30，场景与 #37 相同。stdio 含每 turn 进程启动，**不关闭 PC2**。
- 第二轮等 T-P2-05 的常驻 TCP，再和 #37 的 Rust-tcp / TS-tcp 表放在一起。Q2 的 100ms 口径和 D4 的 5ms 地板都继续有效。

### 4. 部署形态

rust-core 只有 per-turn stdio。本仓 D7 已在探针上有最小面，没有产品 supervisor。

补齐顺序：

1. **TCP 常驻**，做在 `pilotdeck-transport`，不重写 agent。行为对齐本仓：`--listen` 只接受 loopback（`lib.rs:58-64`），stderr 打印 `listening HOST:PORT`（`tcp.rs:16-17`），每连接一个 sidecar（`tcp.rs:18-24`）。
2. **hello token**。环境变量 `PILOTDECK_AGENT_LOOP_TCP_TOKEN`。只比较 hello 的 `payload.token`，常量时间，失败码 `UNAUTHENTICATED`，不回显（`sidecar.rs:482-509`）。未设置则保持开放 loopback。stdio 不校验；部署档从子进程环境删除该变量（`AgentLoopDeploymentProfile.ts` 在 stdio 分支的 `delete`）。宿主侧 #46 已经会把 token 放进 hello，rust-core 补的是监听端。
3. **supervisor** 仍是本仓的 TS 任务（T-P2-06）。两边产品代码都没有负责拉起 Rust sidecar 的组件；parity README 写明 TCP 模式下宿主只连接、不 spawn。
4. UDS / mTLS 保持 D7 原文里的「生产默认之前」，不塞进 P2 出口。

不要把 rust-core 的「每 turn 一个子进程」改成最终部署。那和已经定下的 D7 相反。stdio 留下，给对拍和开发用。

### 5. 工具链与 CI

两边不要折中到 1.83。

| | 本仓 | rust-core（附件） |
|---|---|---|
| edition / MSRV | 本仓 crate：edition 2021，`rust-version = "1.83"` | workspace `Cargo.toml:7` `resolver = "3"`，`:17-18` `edition = "2024"`、`rust-version = "1.93"`。`rust-toolchain.toml` 的 channel 是 `1.99` |
| 依赖 | 只有 `serde_json`，`preserve_order` | `Cargo.toml:25-28` 精确 `=` 版本；`:32` `unsafe_code = "forbid"`；`:35` clippy `all = "warn"`，CI 再加 `-D warnings` |
| CI | `.github/workflows/rust-hello.yml`：toolchain 1.83.0，`cargo build --release`，hello 握手。仓库工作流里没有 `cargo test`、parity、schema replay | DEVELOPMENT §2、§8：fmt、clippy、`cargo test`，然后 `--version` 冒烟。对拍不在它的 CI。`PROVENANCE.md:62-66` 记录抽取后这三条在 rustc 1.99.0 上全绿，696 项 |

edition 2024 与 resolver 3 已经在 workspace 清单里，不再当成未核实。T-P2-04 引进时跟这份清单，不折中到 1.83。

CI 进法见 PLAN 的 G-CI：replay 跟着协议触发路径；parity 快速子集跟着 sidecar 行为 PR；全量 53 不假装已经在每个 PR 上跑。hello 工作流留着，因为 desktop 仍只打包 hello。

### 6. 基线

**对拍以本仓树为准：`b243fa00` 加上已经合入的 3 处 TS 改动。** 不把工作分支 rebase 到 `cc7c4e65`。

核对（本机另取的 OpenBMB `standalone_alpha1`，tip 就是 `cc7c4e653b15c8b2cec7bcf2d15d41d69396ae85`）：

- `b243fa00` 是它的祖先。中间只有 `4cc6c016`（per-project agent 绑定）和 `cc7c4e65`（merge）。
- `git diff b243fa00 cc7c4e65 -- src/agent/loop src/agent/modules` 为空。
- 同范围的 `src/cli` 只有 `createLocalGateway.ts`、`pilotdeck.ts`。这两处是 gateway 接线，D9 保留在 TS，不进 Rust 移植。
- 本 fork 的 `origin/standalone_alpha1` 仍停在 `b243fa00`。调查写的 `origin/standalone_alpha1` 指的是上游 tip，不是本 fork 的那个 ref。

本仓相对 `b243fa00` 的 `src/` 改动是 3 个文件、26 行插入、1 行删除：

| 文件 | 作用 | 合流时 |
|---|---|---|
| `src/agent/loop/AgentLoop.ts:388-389` | status 事件补 `kind`、`text` | 对拍期望的一部分。rust-core 按 `cc7c4e6` 移植，没有这两字段。差出来就算基线差，补到 Rust 投影 |
| `src/cli/AgentLoopDeploymentProfile.ts` | TCP `authToken`；stdio 子进程删除 token | 保留。D7 宿主侧已经在用 |
| `src/agent/modules/transport/agentLoopSidecarClient.ts` | hello `payload.token` | 保留。监听端补齐后才能形成闭环 |

### 7. 怎样写进计划

已写入 `PLAN.md`：D-CORE、P2 任务表（T-P2-01 的 A+B 已合，C/D 与 PC1#3、PC2、PC3 仍 open）、P3 改到 `HostCall` 缝上、P5 明确不含 rust-core 的 gateway、G3 增加「无未接受的 profile_gap」和常驻 TCP。门禁是 G-P2-PARITY / PERF / D7 / ADOPT / CI。风险 R1–R9 对上上面六问。`PR_LOG.md` 补了 #44 与 #46。#45、#47 是证据 draft，不入表。

## 报告论断对照

### 总判与范围

| 论断 | 判定 | 证据 |
|---|---|---|
| 两条线换的是同一个 TS sidecar，协议都是 Module 2.0，默认 transport 都是 native | 确认 | `protocol.ts:1`；`lib.rs:68-71`；`AgentLoopDeploymentProfile.ts:13,52-53`；rust-core README 开篇 |
| rust-core 先做深核心，本仓先做门禁和探针，两者互补 | 确认 | 探针循环 `sidecar.rs:594-711`；ARCHITECTURE §2、§9 |
| 用 rust-core 做核心、用本仓 parity/perf 做门禁 | 确认，并加门 | 见七问 1。未跑对拍之前不删探针 |
| 「可直接把 rust-core 二进制丢进 parity stdio」 | 修正 | 协议和 argv 兼容，身份检查不兼容。`trace.py:369` |
| tip `f44b3789` 含 #46 | 确认 | `git log --first-parent`：`f44b3789` 的 subject 是 Merge pull request #46 |
| 领先 `b243fa00` 220 个提交 | 确认 | `git rev-list --count b243fa00..f44b3789` = 220 |
| 已合并 26 个 PR | 修正 | first-parent 合并到 `f44b3789` 是 28 个。26 是 #41 写入 PR_LOG 时的数字，当时 tip 还是 `8cffa40d` |
| rust-core 是单个 orphan 提交 | 修正 | 附件 README 没有这句话。本工作区没有那份 git，不能证实也不能推翻「历史是不是 orphan」 |
| based-pd tip `1915fcbd`，且 moduleId 不匹配仍是开放问题 | 修正 | 评审 README 写明之后有 `98dcf0dd`。附件 based-pd README「已知限制」第 2 条：shim 在命令行外把 `pilotdeck-agent-loop` 改写成 `pilotdeck.chat`，不动 rust-core、也不动 TS。本仓产品没有这个 shim |
| 两基线对 agent loop 等价，cli 只动 gateway 接线 | 确认 | 见七问 6。上游 tip 就是 `cc7c4e65` |

### rust-core（附件文档能核对的部分）

| 论断 | 判定 | 证据 |
|---|---|---|
| 四个 crate，单向依赖，交付 stdio 二进制 `pilotdeck-agent-loop-sidecar`；gateway/yaml/cli 排除 | 确认 | README「为什么单独一个仓」、仓库结构 |
| `HostPort` 仅 `advertised` + `call`；宿主操作 24 个 | 确认，变体数要分开 | `ports.rs:909` 注释与 `:1171-1172`。枚举从 `:913` 起是 26 个变体；`BudgetCostSnapshot` 与 `BudgetCost`、`RecoverModelErrorBoundary` 与 `RecoverModelError` 共用 operation，`method()` `:1017-1047` 收成 24 个 |
| `CallEffect` 把未知副作用收成 `AcceptedUnknown` | 确认 | `ARCHITECTURE.md:75-93` |
| policy/shell 成对；唯一带 `HostPort` 的 policy 是 tool context | 确认 | `ARCHITECTURE.md:182-204` |
| 终局是一族函数，文档要求不要合并 | 确认 | `ARCHITECTURE.md:167-178` |
| 同步三线程，队列 64/32，满则断开；retire 用 5ms 轮询 | 确认 | `ARCHITECTURE.md:260-319`。5ms 是 join 粒度，不是请求路径 |
| 696 项测试（479/174/27/16），测试自承不是可执行 parity | 确认 | README「本仓当前状态」；`ARCHITECTURE.md:326-337`；DEVELOPMENT §8 |
| 对拍在仓外，k=5，分母 53，CI 不跑对拍 | 确认 | `DEVELOPMENT.md:267-287` |
| 工具链 1.99 与 MSRV 1.93「两种说法并存」、像是笔误 | 修正 | `DEVELOPMENT.md:60-61` 写明 1.93 是 `rust-version` 下限，1.99 是 CI/本地钉扎 |
| edition 2024、resolver 3 | 确认 | workspace `Cargo.toml:7,17`。`PROVENANCE.md:45-47` 写明抽取时保留这两项和 `rust-version = "1.93"` |
| 约 30 处 `profile_gap(`，定义在 `turn.rs:3966` | 修正 | 定义在索引 `:3966`，注释在 `:453`，`run_admitted_turn` 在 `:455`。token 出现 30 次，其中 1 次是定义，调用 29 处。调查的「计数 30」把定义算了进去。索引文件一共 32 行，多出来的两行是注释和函数签名 |
| `default_factory.rs:744-882` 的 `gap()` | 修正 | 该文件不在这批提取里。ARCHITECTURE 把失败返回写在 `:1075-1079`。`host_operations.rs:423` 与 `:612` 已经处理 PlanTodo 和 model metadata，所以这个 gap 不是「这两条 operation 不存在」 |
| `PROTOCOL.md` §4.1 把 hello/execute 写进 `kind`，与四种 kind 不符 | 确认（文档）；代码未复读 | 附件 `PROTOCOL.md:160-165` 的 kind 列表含 hello、execute、module_call。本仓 `protocol.ts:132` 的 kind 只有 request / response / event / error。`module.rs` 不在本工作区 |
| 真实 deepseek 跑通 chat / 工具 / 取消 / Web UI，并用 sha256 证明拉起的是 Rust 二进制 | 确认 | based-pd README「已验证」各表。那是拼装仓的证据，不是本仓 CI |
| 集成分支冒烟不能当对拍 | 确认 | based-pd 自己把验收限制在三条链路加 UI；DEVELOPMENT 把对拍放在仓外 |
| o200k 词表嵌两次 | 确认 | `PROVENANCE.md:116-117`：`RANKS` 与 vendor 的 `o200k_base()` / `o200k_harmony()` 各嵌约 3.6 MB；未用的 tiktoken 资源约 5 MB，登记为后续裁剪，本轮不改 |
| 入口忽略宿主追加的那一个位置参数 | 确认 | `PROVENANCE.md:106`。非法参数仍 exit 2。这只说明 stdio 拉得起来，不说明 parity 的 exec proof 认这个二进制名 |
| src 约 33.8k 行、tests 约 19.6k 行 | 修正 | 未复计。附件没有这组行数 |

### 本仓探针、门禁、打包

| 论断 | 判定 | 证据 |
|---|---|---|
| PLAN / PR_LOG 停在 tip `8cffa40d`，缺 #44、#46，P2 写成未开始 | 确认 | 修订前的 `PLAN.md` 第 4 行、第 17 行；`PR_LOG.md` 表止于 #41。本 PR 修正这处滞后 |
| P1 有条件 Go，PC1#3、PC2、PC3 未关 | 确认 | 修订前 PLAN 的 T-P1-06 节；#46 正文「Out of this PR」写明不关闭 PC1#3 / PC3 |
| `src/` 仅 3 文件、约 27 行 | 确认 | `git diff --stat b243fa00..f44b3789 -- src/`：3 files，26 insertions，1 deletion。`AgentLoop.ts` 的新增在 `:388-389` |
| sidecar.rs 6313 行，约 2550 行起是测试 | 确认 | 文件 6313 行；`#[cfg(test)]` 在 `:2550`；其后 3764 行 |
| 唯一依赖 `serde_json`，edition 2021，rust-version 1.83 | 确认 | `crates/pilotdeck-agent-loop/Cargo.toml` |
| 并发是 thread + mpsc + Mutex，外加 10ms 轮询 | 确认，范围需收窄 | `sidecar.rs:4-8,16,1372`。10ms 是取消检查的 `recv_timeout` 上限和 stub sleep 切片，不是整个服务器的节拍 |
| 硬编码两轮；无压缩、无 steer、无 resume/ack；工具串行 | 确认 | `sidecar.rs:594-711`、`:209-218`。压缩与 steer 的宿主 operation 不在这个函数里 |
| 只用到 capability / budget / context / model | 确认 | 生产路径上的 operation：`prepare_for_model`（`:1826`）、`evaluate_request_budget`（`:1216`）、`prepare`/`stream`/`stream_next`/`close_stream`（`:1897` 起）、`capability` `execute`（`:983`）。没有 `permission.decide`、`checkpoint`、`lifecycle`、`skills`、`knowledge` 的调用 |
| schema 是手写映射 + replay，不是类型推导；协议门禁只是文档 | 确认 | `evidence/protocol-sync-gate.md:1-10`。工作流目录无 replay / parity |
| 对拍 53 场景、五类跨通道交错；已证明的 live 只有 pure_text 与 single_tool | 确认 | `run.py:46-66`；`trace.py` 的通道规则；#26 的 PR 记录与 evidence 索引。本 PR 不重跑 |
| TCP 身份有误标风险 | 确认 | parity README「TCP rust-label risk」；`trace.py:396-398` |
| 模型迭代超 D4 2.7–4.3 倍，live-stream 达 19 倍 | 修正 | 2.7 与 4.3 仍是 #37 的当前书面数。19 倍是 #40 之前的流块塌缩，见七问 3 |
| 真模型只用 fixture | 确认 | `review/2026-10-15-P2-01/NOTES.md`「无 key」；`evidence/p1/t-p2-01-real-model.json` 被 #46 加入。没有 live 延迟 |
| desktop 只打包 hello，默认 pack 不调 cargo | 确认 | `apps/desktop/scripts/rust-hello.mjs` 的 opt-in；`rust-hello.yml` 只做握手 |
| CI 不跑 `cargo test` | 确认 | `rust-hello.yml:41-47` 只有 `cargo build --release` 和 hello 校验 |
| 本仓 src 约 7.9k 行、tests 目录约 2.0k 行 | 确认 | `find crates -path '*/src/*.rs'` = 7897 行；`*/tests/*.rs` = 2040 行 |

## 没有做的事

本意见不跑 53 场景，不编译 rust-core，不改 `crates/` 与 `src/`。预测表在第一次 stdio 对拍之后应整表替换，而不是继续沿用。
