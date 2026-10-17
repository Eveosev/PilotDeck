# TRIAGE_53 · T-P2-01-D2

分母仍是 **53**。allowlist 不放宽。本切片不改 `crates/**`，也不改 `rust-core/**`。修后的期望仍是 **51 pass / 2 trace_diff / 0 profile_gap / 0 BLOCKED**。失败名只有 `deadline` 与 `sidecar_budget_limit`。

签名来自已合的 T-P2-01-D（TCP full-53 两次，`review/2026-10-17-T-P2-01-D/DIFF_SIGNATURES.md`）以及本分支对拍复现（`raw/deadline-pilotdeck.txt`、`raw/sidecar_budget_limit-pilotdeck.txt`）。两边名单相同。

## deadline

- 分类：trace_diff（实现了，终态投影不同）。不是 profile_gap，不是 BLOCKED，不是计时抖动。T-P2-01-D 两次 TCP 都是同一组 3 条 semantic；模型路径没有 tool，grace 窗口用不上。
- 签名（3 semantic）：
  1. `trace.channel[core/parent][1]`：native `null`，rust 多一条 `durable.status` / `gateway_submit_failed`，文案 `AgentLoop terminal outcome is result_unknown and host reconciliation found no final result.`
  2. `trace.channel[core/parent][3]~[4].durableStopReason`：native `aborted_streaming`，rust `null`
  3. `trace.channel[core/parent][3]~[4].resultType`：native `aborted`，rust `null`
- 根因：rust-core 实现。`deadline` 的 deadline 落在模型流上，没有已 dispatch 的 `capability.execute` / `execute_batch`。T-P2-01-D 的 grace 只覆盖那两类 tool 调用（`deadline_during_tool` 因此已绿）。模型流保持 unresolved，worker 把 `CancelCause::Deadline` 覆写成空的 `result_unknown`。TS host 的 `reconcileResultUnknown` 在账本里找不到终态，记成 `gateway_submit_failed`。`durableStopReason` / `resultType` 因此不是 `aborted_streaming` / `aborted`。
- Owner：后续 rust-core 模型 deadline 切片（`pilotdeck-transport` 的 deadline 终态，必要时 `pilotdeck-agent`）。不是本 PR。不改期望、不改 53 分母。

## sidecar_budget_limit

- 分类：trace_diff（预算终态已实现，status `text` 投影不同）。不是计时，不是缺事件。
- 签名（1 semantic）：
  - `trace.channel[core/parent][0]~[0].text`
  - native：`Reached Gateway-owned maxBudgetUsd ($0.500000) after spending $1.000000.`
  - rust：`max_budget_reached`
- 根因：rust-core 事件投影。`pilotdeck-agent/src/budget_terminal_policy.rs` 把金额句放进 error `message`，status 事件名是 `max_budget_reached`。`pilotdeck-agent/src/turn.rs` 的 budget status 注释写明 sidecar 在省略 text 时回退到事件名，诊断留在 StopFailure / errors。native 的 durable status `text` 是金额句。对拍以本仓 TS 为准。
- Owner：T-P2-09（status `kind` / `text` 投影）。该任务不在本切片。本 PR 不改投影，也不把这条 diff 写进 allowlist。
