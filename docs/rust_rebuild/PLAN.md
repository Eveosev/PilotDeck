# PilotDeck Rust 重构 · 总体计划与进度

> 历史决议：`review/2026-10-09-rust-proposal-v2/TASK_PLAN.md`、同目录 `DECISION.md`（本地证据，未入库；v2.1，基线 OpenBMB/PilotDeck @ `b243fa00`）。D0–D9 仍以那份决议为准。
> **2026-10-15 合流修订以本文为准。** 依据是 `REVIEW-RustReview-2026-10-15.md`（对照 AgentCPM rust-core 调查与本仓代码）。本文不把未合并的 PR 写成已合并，也不把尚未跑过的对拍写成已切换核心。
> 工作分支：Eveosev/PilotDeck `rust_standalone_alpha1`。本稿核对 tip `f44b3789`（2026-10-15，#46 合并）。已合并 PR 见 [PR_LOG.md](PR_LOG.md)。

## 终局目标

- **D0 = G3**（2026-10-10 暂定）：完整可运行的 Rust 核心，约在 **P5** 后达成。G3 终验：除未覆盖 provider 外 module_call≈0；P95 ≤ native+5%；RSS ≤ native+10%（TASK_PLAN T-G3-01）。
- 其他已定：D1 渐进 sidecar；D4 = `max(native 单轮 P95×10%, 5ms)`，体积 ≤ 当前包+20%；D7 TCP 常驻（生产默认前须补认证/UDS）；D9 TS adapter-host。
- **D-CORE（2026-10-15，计划修订，代码未动）**：P2 的领域核心改为 rust-core 的四个 crate（`pilotdeck-protocol` / `tokenizer` / `agent` / `transport`）。本仓 `crates/pilotdeck-agent-loop` 停在探针：保留作 D7、对拍包装和性能参照，**不再往 `sidecar.rs` 上堆 53 场景**。切换实施（T-P2-04）必须先过 T-P2-02 对拍门和 T-P2-03 性能门。门没过就继续用探针，不提前删 crate。

合流取三样东西，不取「整仓替换」：

| 取自 | 什么 | 不取什么 |
|---|---|---|
| rust-core | 六边形 `HostPort` / `HostCall`、policy 壳、显式 `profile_gap`、JS 语义值模型 | 它的 stdio-only 部署、仓外对拍、不含 gateway 的终局 |
| 本仓 | `tools/agent-loop-parity`、`tools/agent-loop-perf`、schema replay、D7 TCP+hello token、PR 门禁 | 把 `run_stub_execute` 长成生产循环 |
| 两边都不自动带来 | TS supervisor、协议同步进 CI、G3 默认切换 | — |

## 阶段

| 阶段 | 内容 | 出口（摘要） | 状态 |
|---|---|---|---|
| Gate-0 | 53 场景 native+stdio 基线与分诊 | 关闸 Reviewer conditional_pass | ✅ 已关 |
| P0a | 契约与基线：parity TCP、schema、comparator、性能基线、打包骨架、协议门禁 | P1 入口 = 00/01/02/03 + D4 暂定 | 入口项已合（#1 #2 #3 #4 #5 #7）；T-P0a-04/06/08 本稿未见合并记录 |
| P0b | 黄金样本、ST 复核、缺口清单、回滚、签名、覆盖率（与 P1/P2 并行） | 见 TASK_PLAN §P0b | 本稿未见合并记录 |
| P1 | 技术探针：Rust loop、harness、parity、流块、对照、go/no-go | 两场景一致 + 流块数据 + 书面决议 | **已关闸，有条件**（见下） |
| **P2** | 见下表。领域循环改走 rust-core；53/53、supervisor、D7 仍是本阶段出口 | 全场景绿 + P2 性能线 + supervisor 拉起 TCP | **已开始**。#46 只合入 T-P2-01 Track A+B。Track C/D、PC1#3、PC2、PC3 仍 open。四 crate 未进本仓 |
| P3 | 按调用频率把宿主模块收回 Rust。缝在 `HostCall`：反向 RPC 换本地实现，顺序仍是 model → tool/MCP → budget → turn → 其余 | 对应 `module_call` 消失；每模块可回滚 | 未开始。T-P2-04 未合入之前不开工 |
| P4 | session 与存储（格式版本、单一写者） | ST 对拍、零丢失 | 未开始 |
| P5 | Rust gateway + adapters。rust-core **不含** gateway / yaml / cli，这三块仍在 P5，不并进 P2 | 黄金样本 100%；desktop 切 Rust gateway | 未开始 |
| P6 | ui/server（仅 D0=G1） | — | 不适用（D0=G3） |
| G3 | 默认切 `module-tcp-v2`，一键回退 native | 原 D0 指标，外加：常驻 TCP 已过 D7 最小认证与 D4，53 场景无未接受的 `profile_gap` | 未开始 |

并行线 A（ui/server 去耦）、线 B（打包发布）仍见 TASK_PLAN。打包线目前只覆盖 hello 探针（#4），真正的 sidecar 二进制未入包。

## P2 任务

`review/2026-10-15-P2-01/NOTES.md` 只命名了 Track A+B，并把三条留在 PR 外。本文把那三条里的后两条记为仍 open 的 Track C / Track D，避免以后把「P2 已合入」理解成 53 场景或性能条件已关闭。

| 任务 | 内容 | 状态 |
|---|---|---|
| T-P2-01 A+B | 真 host `prepare` 请求、thinking signature、stdio 与 TCP 的 G5/B4、TCP hello token（`PILOTDECK_AGENT_LOOP_TCP_TOKEN`，未设置仍是开放 loopback；stdio 子进程环境删除该变量） | **已合** #46 `f44b3789` |
| T-P2-01 C | 53 场景分诊，以及 tools 缺口 m2/m4/m5/m6/E1/n1/n3。输入改为 T-P2-02 的 rust-core 结果，不在 `sidecar.rs` 上补场景 | open |
| T-P2-01 D | 关闭 PC1#3 与 PC3（同一套 `--model-ms 200`、n=30）。探针 TCP 的旧数字在核心切换前仍然有效；T-P2-04 合入后这组数字作废，必须重采 | open |
| T-P2-02 | 用本仓 `tools/agent-loop-parity` 的 **stdio** 跑 rust-core 二进制。身份、命令和预计会撞上 `profile_gap` 的场景见评审意见第 2 问 | open。P2 第一道门 |
| T-P2-03 | 用 `tools/agent-loop-perf` 做同场景对照，回答 PC2。stdio 先比「每 turn 拉起」；关掉 PC2 必须等 T-P2-05 的常驻 TCP 重采 | open。P2 第二道门 |
| T-P2-04 | 两道门通过后，把四个 crate 引进本 workspace。探针 crate 与 hello crate 保留。不过门则本任务不做 | open。计划已选定方向，**未实施** |
| T-P2-05 | 在 `pilotdeck-transport` 补 D7：`--listen` 只绑 loopback、hello `payload.token` 常量时间比较、错误码 `UNAUTHENTICATED`、不回显 token、stdio 不校验。对齐本仓 `tcp.rs` 与 #46，不把探针的 10ms 轮询带过去。2026-10-12 DECISION 里的 T-P2-05/06 指的是探针上的 TCP 认证；#46 只完成了探针上的最小面 | open（rust-core 侧）。探针侧最小面已在 #46 |
| T-P2-06 | TS supervisor：产品进程拉起并在崩溃后续上 TCP listener。现在只有 harness 和包装脚本会拉起 sidecar | open |
| T-P2-07 | 2026-10-12 的原意是「另建 pilotdeck-rs workspace」。合流后改为：**不**新建那份 7 crate workspace；P2 只引进 rust-core 已有的 4 个 crate。gateway / yaml / cli 留在 P5 | 决议已改，未实施 |
| T-P2-08 | CI：引进后的 workspace 跑 fmt、`clippy -D warnings`、`cargo test`；协议同步从文档门禁升为 schema replay；parity 至少跑 `pure_text` 与 `single_tool`。现有 `rust-hello.yml` 在 hello 探针仍被 desktop 引用时保留 | open |
| T-P2-09 | 基线差：本仓 `AgentLoop.ts` 的 status 事件带 `kind` / `text`（#2）。对拍期望以本仓 TS 为准。rust-core 若少这两个字段，补事件投影，不把 TS 改回去 | open，附在 T-P2-02 的 diff 分类里 |
| FT-2a | 模型迭代开销归因。2026-10-15 18:01 取消为「接上真模型后若仍超 Q2 再开」。T-P2-03 先回答探针 PC2 是不是实现问题；真模型延迟不在这道门里 | 条件触发，未开 |

## 门禁

沿用每个 PR 的 draft → QA Formal → Reviewer → Payne 合并。下面是合流新增的阶段门。没过不进下一任务。

1. **G-P2-PARITY（T-P2-02）**
   - 快速门：`pure_text`、`single_tool`，stdio，same-version，各 30 次 0 diff。身份必须是 exec proof，不能只看 `--version`。
   - 全量门：`run.py --scenario all` 的分母仍是 **53**。不采用 rust-core 上游「53 减去原版不稳定场景、低于 45 就停」来降低本仓门槛；那条只作为读结果时的参考。
   - 每个失败场景分成三类再决定修不修：`profile_gap`（显式未实现）、trace diff（实现了但文案/顺序不同）、BLOCKED（没跑起来，含身份证明失败）。
2. **G-P2-PERF（T-P2-03）**
   - 同一套 `--model-ms 200`，场景至少 `pure_text`、`single_tool`、`sidecar_live_model_stream_chars_50`，n=30。
   - stdio 轮只和 native、以及同样是「每 turn 拉起」的路径比。这轮数字**不能**关闭 PC2，也不能拿去对 #37 的 Rust-tcp 表。
   - TCP 轮在 T-P2-05 之后重采。整 turn 仍用 D4；mock 阶段单次 model 迭代仍用 Q2 的 `max(native 净 P95 的 10%, 100ms)`。PC1#3（流块 after-first 净 P95 差/D4 ≤ 1）和 PC3（n=30、`baseSha` 正确）继续挂在 T-P2-01 D，不因换核心讨论而消失。
3. **G-P2-D7（T-P2-05 + T-P2-06）**
   - 未设置 token：行为与现在的开放 loopback 相同。
   - 设置 token：错误或缺失 hello 为 `UNAUTHENTICATED`，后续方法在认证前同样拒绝，响应不带回 token。stdio 部署档继续从子进程环境删掉该变量。
   - supervisor 能拉起 listener，并在进程退出后续上。UDS / mTLS 仍按 D7 原文留到生产默认之前，不作为 P2 出口。
4. **G-P2-ADOPT（T-P2-04）**
   - 只在 1 和 2 的快速门都过之后引进 crate。全量 53 的红场景进 T-P2-01 C，不阻塞「把源码放进仓库」，但阻塞「把产品默认路径指过去」。
   - 引进时工具链跟 rust-core 的 workspace 清单：`resolver = "3"`，`edition = "2024"`，`rust-version = "1.93"`，CI 钉 `rust-toolchain.toml` 的 1.99；`unsafe_code = "forbid"`；依赖精确 `=` 版本；clippy `-D warnings`。不降到本仓探针的 2021 / 1.83。
5. **G-CI（T-P2-08）**
   - 触及 `evidence/protocol-sync-gate.md` 所列路径的 PR，CI 跑 schema replay（检查清单 1–3 的可脚本化部分）。
   - sidecar 行为 PR 至少跑 parity 快速门。全量 53 仍可以 nightly，不在每个 PR 的路径过滤里假装已经在跑。

## P1 当前进度（截至 tip `f44b3789`）

| 任务 | PR | 状态 |
|---|---|---|
| T-P1-01 Rust agent-loop | #8（PR-A）、#18（PR-B） | 已合 |
| T-P1-02 harness | #20、#21 | 已合 |
| T-P1-03 parity | #24、#26、#28、#30、#32 | 已合 |
| T-P1-04 流块 1/50/500 | #34、#36 | 已合 |
| T-P1-05 对照数据 | #37（[evidence/p1/go-nogo.md](../../evidence/p1/go-nogo.md)） | 已合 |
| T-P1-06 决议 | #44 把 Q1 写成有条件 Go | **已决议**，条件未关 |
| FT-1 `stream_next` | #40 | **已合** `019a527a` |
| T-P2-01 A+B | #46 | **已合** `f44b3789` |
| FT-2a | — | 已取消为条件触发，见上表 |

## T-P1-06 决议（2026-10-15，Payne）

本决议记在 `docs/rust_rebuild/`。`evidence/p1/go-nogo.md` 在 `1d7c8068` 仍只给对照数据，没有本节。

- **Q1**：有条件 Go。出处：真人 Payne 1:1 2026-10-15 19:27 (UTC+8)。条件按 `.review/2026-10-15-FT-1-r1/review-40-27556745/TASK_DEF-FT1.md`（Mac 本地证据）的 PC1–PC3：
  - **PC1**：`stream_next` 已合入（#40）。重采后 Rust-tcp `firstDeltaBeforeProviderCompletion=true`（chars 1/50/500）、`perf_n_chunks` = harness n_chunks、流块 after-first 净 P95 差/D4 ≤ 1。第 3 项仍 **open**（实测 1.394 / 1.822，移交 PC3 的 n=30）。#40 修的是「流块退化成 1」；`go-nogo.md` 里 live-stream model 差/D4 = 19.358 是修之前的数，不能再当成当前缺口。
  - **PC2**：model 迭代开销归因；修复后（或 Payne 书面接受的新口径下）pure_text / single_tool 差/D4 ≤ 1。FT-2a 于 18:01 取消，转入 P2。T-P2-03 负责回答这是不是探针实现问题。**未关闭。**
  - **PC3**：同一套 `--model-ms 200`、n=30，QA Formal 复核，`baseSha` 正确。**尚无完成记录。**
- **Q2**：mock 阶段，单次 model 迭代开销阈值 `max(native 净 P95 的 10%, 100ms)`；整 turn 仍为 `max(10%, 5ms)`。P2 接上真模型之后，只要求正常返回。
- **Q3**：53 场景 live 门禁留在 P2（原写法是留在 P1；#46 没有跑这 53 个）。真模型 fixture 路径、stdio 对齐、D7 hello token 已随 #46 进入探针。真模型延迟、supervisor、53/53 仍未做。
- **Q4**：先 FT-1（已合并 `019a527a`），再 FT-2a；FT-2a 已于 18:01 取消。
- **2026-10-15 18:01（UTC+8）**：Payne 取消 FT-2a，直接进入 P2。出处：真人 Payne 1:1，原话「直接做P2，把这个记录就可以」。

## 风险

| # | 风险 | 处置 |
|---|---|---|
| R1 | 继续在 `run_stub_execute` 上补场景，会把 rust-core 已经拆开的 turn / recovery / compaction 重写一遍 | D-CORE：探针冻结功能面。新行为只进四 crate |
| R2 | `turn.rs` 有 29 处 `profile_gap` 调用（索引里 token 30 次，含 `:3966` 的定义）。已展开的字符串集中在 open projection、压缩预览、model-error 形状。注释里的预算文案 / progress / live seed 没有同名调用点。哪些 53 场景会撞上，见评审意见第 2 问，那是预测 | T-P2-02 先分类。禁止用「单测 696 项」代替这 53 个 |
| R3 | 对拍身份检查要求解析后的路径以 `pilotdeck-agent-loop` 结尾。rust-core 二进制名是 `pilotdeck-agent-loop-sidecar`，直接填命令会被判 BLOCKED | T-P2-02 用现有包装脚本加一个同名符号链接。不改产品协议 |
| R4 | rust-core 设了 TCP 端口或 factory 就 exit 2。`agent-loop-perf` 的 TCP 开关因此跑不了它；stdio 数字含每 turn 进程启动，和 #37 的常驻 TCP 不是同一形态 | 性能分两轮，写在 G-P2-PERF |
| R5 | 探针 PC2（model 净 P95 比 native 多 13–21ms）相对同机 TS-tcp 是实现开销，但 10ms 轮询不是充分解释：`recv_timeout` 在回复到达时立刻返回。#40 之后没有重采 model 迭代 | T-P2-03 实测。在那之前不把 PC2 写成「换 rust-core 就会过」 |
| R6 | 工具链：本仓 edition 2021 / MSRV 1.83 / CI 1.83，只编 hello 握手；rust-core 下限 1.93、CI 钉 1.99，且禁止 unsafe。混在一个 workspace 里，现有 CI 会编不过或完全不跑测试 | T-P2-08 跟 rust-core 的下限和钉扎。hello 工作流单独留到探针还在包里 |
| R7 | 行为基线：OpenBMB `cc7c4e65` 与本仓 `b243fa00` 对 `src/agent/loop`、`src/agent/modules` 零差异，但本仓另有 3 处 TS 改动。其中 status 的 `kind`/`text` 会让 rust-core 的事件投影和本仓期望不一致 | 对拍以本仓树为准（T-P2-09）。不把 StaffDeck 那两个 gateway 接线提交并进 Rust 线 |
| R8 | 产品没有 supervisor。desktop 只打包 `pilotdeck-agent-loop-hello`。历史回放的 moduleId（sidecar 报 `pilotdeck-agent-loop`，前端认 `pilotdeck.chat`）在本仓仍在；拼装仓的 shim 没有进产品 | T-P2-06 管进程。moduleId 兼容若要做，单独开任务，不塞进核心引进 |
| R9 | `turn.rs` 仍然会很大。协议文档把 `hello`/`execute` 写进 `kind`，与 TS 的四种 `kind` 不一致 | 引进时不要求先拆文件。协议描述以 `protocol.ts` 和本仓 schema 为准，修正 rust-core `PROTOCOL.md` 时另开文档 PR |

## 维护

- 阶段状态、决议、合并后都更新本文件。
- 不写尚未合并的 PR 为「已合并」。证据类 draft（#45、#47 等）不入 [PR_LOG.md](PR_LOG.md)。
- 代码切换发生之前，本文里的「改为 rust-core」都是计划，不是现状。
