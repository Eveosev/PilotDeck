# TASK_DEF · T-P2-09 · status 事件 `kind` / `text` 投影（对拍以本仓 TS 为准）

> 状态：**草案待 Arch 冻结**（2026-10-18 ~07:25 CST）；箱本地 `review/2026-10-18-T-P2-09/`。
> `unlocked=true`（见 `UNLOCK.md`，standing「其余全做」2026-10-17 ~12:10 CST）。
> 基线：`rust_standalone_alpha1@da96f0546bb6cf3f9123c70a348477c65ab07038`（#62 merge，T-P2-01-D2；tip `f71bd5a7`）。
> 对照（均 @da96f054）：`docs/rust_rebuild/PLAN.md:56`（T-P2-09 open）、`:130`（R7）、`:46`（D2 仍写「进行中，未合」——本 PR D0 收口）、`src/agent/loop/AgentLoop.ts:139-142,383-389`、`src/agent/protocol/events.ts:72-80`、`rust-core/pilotdeck-agent/src/turn_wire.rs:221-232`、`turn.rs:367-375,3649-3654`、`review/2026-10-16-T-P2-02/FULL_53_CLASSIFICATION.md` §T-P2-09。
> **允许** draft PR；**ready/merge 仍等真 Payne**。禁止 force-push / rebase / amend，仅普通追加 commit。

## 0. 前置

1. #62 已合 tip `f71bd5a7` → merge `da96f054`：Track D 余项（tools m2/m4/m5/m6/E1/n1/n3 + 53 triage）已入主线。#62 **第一个 commit** `e5501237` 已把 PLAN 里 T-P2-08 标为已合 #60 `fbcfa7a9`（tip `31a462e6`），并把 T-P2-01 D 指向 D2（当时仍「进行中」）。
2. PLAN @da96f054 仍写 tip `fbcfa7a9`、D2「进行中，未合」、T-P2-09 **open**——本切片 D0 收口 D2，并把 T-P2-09 标为本 PR 进行中。
3. **缺口（证据）**：
   - 本仓 TS（#2）`toAgentStatusEvent` **总是**透传 `kind` + `text`（`AgentLoop.ts:388-389`）；协议允许可选字段（`events.ts:77-78`）。
   - rust-core `turn_wire.rs`：`AgentStatus` 只写 `event`+`detail`（`:221-223`，**无 kind/text**）；`AgentStatusText` 只写 `event`+`text`+`detail`（`:225-232`，**无 kind**）。
   - budget 终端故意省略 text，注释仍写「AgentLoop omits text」（`turn.rs:3649-3654`）——对本仓树已过时；`budget_terminal_policy.rs` 已生成 Gateway 金额句（`:237`），但未进 status wire，对拍 durable 退化为 `text=max_budget_reached`（FULL_53 `sidecar_budget_limit`）。
4. **G-GHA**：仓库 Actions 自 2026-10-15 02:40 CST 起 0 run。真 Payne 裁定：G-GHA = **WAIVER-PENDING + 本地等效证据**（`raw/*`），不得写成 PASS。
5. PC1#3 / PC3 / PC2 / Track C / CI m2·m4 债务实施 / 桌面真 sidecar 打包 / 默认 transport 翻转 **不在本切片**。`deadline` 额外 `gateway_submit_failed` 事件与终态字段 **不要求本切片消掉**（属 Track D triage 余债，非缺 kind/text）。

## 1. 交付物（按顺序）

### D0（第一个 commit）· PLAN 收口 #62 / D2，打开 T-P2-09
- `docs/rust_rebuild/PLAN.md`：
  - `:5` 头注 tip → `da96f054`（#62 合并，含 T-P2-01-D2；tip `f71bd5a7`；G-GHA 由真 Payne 豁免，本地等效证据）。
  - `:29` P2 状态行：记 #62 / D2 已合，T-P2-09 进行中（本 PR，未合）。
  - `:46` T-P2-01 D / Track D rest → **已合 #62 `da96f054`（tip `f71bd5a7`；G-GHA 由真 Payne 豁免，本地等效证据）**。`deadline` / `sidecar_budget_limit` 仍可作余债脚注（非本切片强制修绿）。
  - `:56` T-P2-09 → **进行中**（本 PR，draft，未合）；一句指向 wire 投影补齐，不改 TS。
  - R7（`:130`）可保留「对拍以本仓树为准（T-P2-09）」；合入后由后续 tip 再改为已合。
- **不**冒充本 PR 已合；**不**关 PC*。

### D1 · rust-core 事件投影：agent_status 必带 `kind` + `text`
目标：wire / 对拍路径上的 `agent_status` 与本仓 `AgentLoop.toAgentStatusEvent` 对齐——**有** `kind: "status"|"error"` 与非空语义 `text`；**禁止**把 TS 改回去。

| 项 | 要求 |
|---|---|
| 投影 | `turn_wire.rs` 两臂均写出 `kind` 与 `text`（今日 `:221-232` 缺口）。`AgentStatusText` 补 `kind`；`AgentStatus` 补 `kind`+`text`。 |
| 模型 | 优先把 `TurnEvent::AgentStatus` 扩成带 `kind`+`text`（或与 `AgentStatusText` 合并为单一变体）；所有 `TurnEvent::AgentStatus { … }` / `AgentStatusText { … }` 发射点（`turn.rs` 等）同步。 |
| kind 口径 | 与本仓工厂一致：错误类为 `"error"`，信息类（如 `turn_aborted`、`structured_output_completed`）为 `"status"`。可参考 `agentLoopSidecarClient.ts:1770-1782` 的失败 event 集合 + `detail.severity==="error"`，但 **以 AgentLoop 工厂为准**（例如 `content_filter_stop` kind=`error`，`turn_aborted` kind=`status`）。 |
| text 口径 | 与本仓工厂 / `error.message` / `detail.message` 一致。**budget**：必须投影 Gateway 金额句（与 `budget_terminal_policy.rs:237` / `AgentLoop.ts:990-1024` 同形），不得再依赖 sidecar fallback 用 event 名当 text。删除或改写 `turn.rs:3649`「AgentLoop omits text」过时注释。 |
| 其它发射点 | `lifecycle_blocked` / `content_filter_stop` / `tool_error_loop` / `max_turns` / abort 等凡走 `AgentStatus` 者，均带齐 kind+text（可从既有 detail/message 提升，文案对齐 TS 工厂）。 |
| 测试 | rust-core：至少覆盖（a）wire/`turn_wire::event` 对 `AgentStatus` 与 `AgentStatusText` 均含 `kind`+`text`；（b）budget 终端 status 的 text 匹配 `Reached Gateway-owned …` 形。既有 `cargo test` 全绿。 |

### D2 · 对拍与证据
- 重建 rust-core release sidecar（`cd rust-core && cargo +1.99.1 build --locked --release --bin pilotdeck-agent-loop-sidecar`），exec-proof 身份沿用现有 wrapper/symlink。
- stdio 快速门：`pure_text`、`single_tool` 语义 0 diff。
- full-53：分母仍 53；记录 pass/trace_diff/profile_gap/BLOCKED。期望：**不回退**相对 #62 后主线的 51/2/0/0；若 `sidecar_budget_limit` 因 text 对齐变绿，记两次复现。`deadline` 多事件 / 终态差 **允许仍为 trace_diff**（注明非缺 kind/text）。
- 证据：`review/2026-10-18-T-P2-09/**` → `PROVENANCE.md`、`raw/*`（fmt/clippy/test、build、quick、full-53 摘要）、可选 `WIRE_KIND_TEXT.md`（前后字段对照表）。

### D3 · PR
- 标题建议：`T-P2-09: project agent_status kind+text to match AgentLoop`
- **draft**；普通追加 commit（D0 必须为相对 `da96f054` 的第一个）。

## 2. 白名单

| 允许 | 禁止 |
|---|---|
| `docs/rust_rebuild/PLAN.md` | `apps/**` `ui/**` `packages/**` |
| `rust-core/pilotdeck-agent/**`（投影 + 发射 + 单测） | 改 `src/agent/loop/AgentLoop.ts` 去掉 kind/text；改协议 schema 删字段 |
| 必要时 `rust-core/pilotdeck-transport/**`（仅若 status 封装测试需要，最小） | `crates/**` 探针上补场景；根 `Cargo.toml` 降 MSRV |
| `review/2026-10-18-T-P2-09/**` | `.github/workflows/**`；翻转默认 transport；改 supervisor 语义 |
| | 关 PC1#3/PC3/PC2；实施 CI m2/m4 债务 |

## 3. Out
- 把 TS `kind`/`text` 改回 undefined；Gateway projector 下游扩字段；desktop 打包 hello→真 sidecar；默认 transport≠native；Track D `deadline` 终态修绿（可另开）；PC* 重采。

## 4. 验收（Formal 钉）

| # | 判据 | 命令 / 证据 |
|---|---|---|
| P1 | D0 PLAN：#62/D2 已合 @da96f054（tip f71bd5a7，G-GHA 真 Payne 豁免）；T-P2-09 标进行中/本 PR；未冒充已合 | `git diff da96f054 -- docs/rust_rebuild/PLAN.md`；`git log --reverse da96f054..HEAD` 首 commit = D0 |
| P2 | 白名单 | `git diff --name-only da96f054...HEAD` ⊆ §2；无 `apps/**`、无删 TS kind/text |
| P3 | wire 投影 | `turn_wire`（或等价）对 AgentStatus/AgentStatusText 输出均含 `kind` 与 `text`；单测锁定 |
| P4 | budget text | budget 终端 agent_status.text 为 Gateway 金额句（非裸 `max_budget_reached`）；过时「omits text」注释已处理 |
| P5 | rust-core 门 | `cd rust-core && cargo +1.99.1 fmt --check`、`clippy --locked -- -D warnings`、`test --locked` 绿；`raw/*` |
| P6 | 对拍不回退 | release sidecar + exec-proof；stdio `pure_text`/`single_tool` 0 semantic diff；full-53 分母 53，不差于 51/2/0/0（更优须两次复现） |
| P7 | T-P2-09 备注 | PROVENANCE / FULL 摘要写明：缺字段已补；若仍有 status text **文案**差，与「缺字段」分开记 |
| P8 | G-GHA | **WAIVER-PENDING** + P5–P6 `raw/*` 本地等效；不得写 PASS |
| P9 | 提交纪律 | 仅普通追加；PR **draft**；默认 transport 仍 native |

## 5. 流程
- draft → **QA Formal**（`qa-gate-<pr>-<tip>/SUMMARY.md`）→ **Reviewer**（parent 在 Payne 1:1 拉 Mac；Arch 不在群催）→ ready/merge **仅真 Payne**。
- 合并后 Desktop chrome smoke（证据 PR，勿合、无 Reviewer）。
