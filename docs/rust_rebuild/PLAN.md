# PilotDeck Rust 重构 · 总体计划与进度

> 计划原文：`review/2026-10-09-rust-proposal-v2/TASK_PLAN.md`（v2.1，基线 OpenBMB/PilotDeck @ `b243fa00`）、`DECISION.md`。本文只做摘要与状态，冲突时以原文为准。
> 工作分支：Eveosev/PilotDeck `rust_standalone_alpha1`（本稿核对 tip `1d7c8068`，2026-10-15）。已合并 PR 见 [PR_LOG.md](PR_LOG.md)。

## 终局目标
- **D0 = G3**（2026-10-10 暂定）：完整可运行的 Rust 核心，约在 **P5** 后达成。G3 终验：除未覆盖 provider 外 module_call≈0；P95 ≤ native+5%；RSS ≤ native+10%（TASK_PLAN T-G3-01）。
- 其他已定：D1 渐进 sidecar；D4 = `max(native 单轮 P95×10%, 5ms)`，体积 ≤ 当前包+20%；D7 TCP 常驻（生产默认前须补认证/UDS）；D9 TS adapter-host（TASK_PLAN TL;DR）。

## 阶段
| 阶段 | 内容 | 出口（摘要） | 状态 |
|---|---|---|---|
| Gate-0 | 53 场景 native+stdio 基线与分诊 | 关闸 Reviewer conditional_pass | ✅ 已关（`REVIEW_RESULT_GATE0_CLOSE_R2.md` conditional_pass） |
| P0a | 契约与基线：T-P0a-00 parity TCP、01 schema、02′ comparator、03 性能基线、05 打包骨架、07 协议门禁 等 | P1 入口 = 00/01/02/03 + D4 暂定 | 入口项已合（#1 #2 #3 #4 #5 #7）；T-P0a-04/06/08 本稿未见合并记录 |
| P0b | 黄金样本、ST 复核、缺口清单、回滚方案、签名、覆盖率门禁（与 P1/P2 并行） | 见 TASK_PLAN §P0b | 本稿未见合并记录（待核） |
| **P1** | 技术探针：T-P1-01 Rust loop、02 harness、03 parity、04 流块、05 对照报告、06 go/no-go | 两场景一致 + 流块数据 + 书面决议 | **进行中**（见下） |
| P2 | Rust loop 全量（53/53）+ TS supervisor + D7 认证 + nightly | 全场景绿 + P2 性能线 | 未开始 |
| P3 | 按调用频率收回宿主模块（model→tool/MCP→budget→turn…），每模块回滚演练 | module_call 消失断言 | 未开始 |
| P4 | session 与存储（格式版本、单一写者） | ST 对拍、零丢失 | 未开始 |
| P5 | Rust gateway + adapters，desktop 切 Rust gateway | 黄金样本 100% | 未开始 |
| P6 | ui/server（仅 D0=G1） | — | 不适用（D0=G3） |
| G3 | 终验与灰度（`module-tcp-v2` 默认切换、一键回退 native） | DECISION D0 指标 | 未开始 |
并行线 A（ui/server 去耦，T-A-03+T-A-05 为 P4/P5 前置）、线 B（打包发布）见 TASK_PLAN。

## 门禁流程（每个 PR）
1. 开发 agent 开 **draft** PR，范围按 TASK_DEF 白名单。
2. **QA Formal**：产物 `review/<date>-<task>/qa-gate-<tip>/SUMMARY.md`；新 tip 需 delta 门。
3. **Reviewer**：独立只读审阅，产物 `REVIEW_RESULT*.md`，逐轮（R1/R2…）；fail / conditional_pass 需修复后复审。
4. QA + Reviewer 均通过 → draft 转 **ready**。
5. **合并只由 Payne 执行**。合并后对主线 SHA 跑桌面 smoke（X11/Wayland），证据放不合并的 draft PR。
6. 合并后同步更新 `PR_LOG.md` 与 `prs/PR-<n>.md`。

## P1 当前进度（截至 2026-10-15）
| 任务 | PR | 状态 |
|---|---|---|
| T-P1-01 Rust agent-loop | #8（PR-A）、#18（PR-B） | 已合 |
| T-P1-02 harness | #20、#21 | 已合 |
| T-P1-03 parity | #24、#26、#28、#30、#32 | 已合 |
| T-P1-04 流块 1/50/500 | #34、#36 | 已合 |
| T-P1-05 对照数据 | #37（`evidence/p1/go-nogo.md`） | 已合 |
| T-P1-06 决议 | — | **已决议（2026-10-15）**，见下 |
| FT-1 Rust sidecar 改用 `stream_next` 增量拉流 | #40 | **open，未合并**（draft，head `d8366d7f`，QA delta 门进行中） |
| FT-2a model 迭代开销调查 | — | 未开，排在 FT-1 后 |

### T-P1-06 决议（2026-10-15）
> 来源：Payne 2026-10-15 决议（经架构师转述）。提案原文 `review/2026-10-15-T-P1-06/TASK_DEF-PROPOSAL.md`（当时 Arch 建议为「有条件 Go」）。**`evidence/p1/go-nogo.md` 在 `1d7c8068` 上尚无「T-P1-06 决议」节与签字行，书面落档待补。**
- **Q1 档位：Go**。
- **Q2 口径**：mock 下单次 model 迭代阈值 `max(native net P95 × 10%, 100ms)`；整 turn 仍 `max(10%, 5ms)`（D4）；P2 之后真模型只要求正常返回。
- **Q3 未跑项**：53 场景 live 留在 P1；真模型 / stdio / D7 TCP 认证移到 P2 入口。
- **Q4 顺序**：先 FT-1，再 FT-2a。
- FT-1 已知未关项：PC1 after-first 指标仍开（#40 REPORT 披露）；53 场景 gate 在 `d8366d7f` 上 23 过/19 failed/11 blocked，正与基线 `1d7c8068` 逐场景对比（QA，`review/2026-10-15-FT-1/qa-gate-40-d8366d7f/`）。

## 维护
- 阶段状态变化、决议、合并后都更新本文件；不写尚未合并的 PR 为「已合并」。
