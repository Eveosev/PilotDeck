# DIFF_SIGNATURES · T-P2-01-D

Allowlist 没有加宽。修前引用 Formal #55，修后是本分支 `66c2334b` 的 TCP full-53。

## 修前（Formal #55，tip `54633c3e`）

两次 TCP full-53 都是 **50/3/0/0**。`failed` 为 `deadline`、`deadline_during_tool`、`sidecar_budget_limit`。见 `review/2026-10-16-T-P2-05/PARITY_TCP.md` 与 `review/2026-10-16-T-P2-05/raw/full53-summary.txt`。

`deadline_during_tool`（`review/2026-10-16-T-P2-05/raw/deadline_during_tool-pilotdeck.txt`）只有 1 条 semantic：

```text
trace.channel[core/parent][6]
  left: null
  right: {"agentScope":"parent","event":"gateway_submit_failed","kind":"durable.status","statusKind":"error","text":"AgentLoop terminal outcome is result_unknown and host reconciliation found no final result."}
```

`deadline`（`review/2026-10-16-T-P2-05/raw/deadline-pilotdeck.txt`）是 3 条 semantic：上面同一条 `gateway_submit_failed`，外加基线已声明的 `durableStopReason`（`aborted_streaming` vs null）和 `resultType`（`aborted` vs null）。多出来的那条把它从「verified 2 declared」打成 `transport contract mismatch (3 semantic difference(s))`。

`sidecar_budget_limit` 是 native 金额句 vs rust `max_budget_reached`，不在本切片里。

## 根因

`deadline_during_tool` 的 deadline（5000ms）落在 `slow_side_effect` 的 `capability.execute_batch` 还在飞的时候。TCP 暖进程让这个时刻很准。

rust-core 的 waiter 一过 execution deadline 就把这次已发出的调用当成 `AcceptedUnknown`，并且把紧接着到达的 host 取消回复标成 `deadline_rejected` / `Unresolved`。agent 侧其实已经能收成 aborted turn（`finish_aborted_after_tools`），但 advisory `capture_turn` 仍 unresolved，factory 把这个 `Ok(aborted)` 丢掉。server worker 再把任何 `CancelCause::Deadline` 覆写成空 payload 的 `result_unknown` / `DEADLINE_EXCEEDED`。

TS host 的 `reconcileResultUnknown` 在账本里找不到已知终态，抛出 `AgentLoopResultUnknownError`。Gateway 把它记成 durable `gateway_submit_failed`。这就是对拍里多出来的那条事件。

模型场景 `deadline` 没有 tool。流在 deadline 上保持 unresolved，空 `result_unknown` 是既有行为。它必须留下来，`deadline` 才继续是 allowlist 里的那次失败。stdio 上这条竞态有时让 tool 回复先到，所以以前只有其中一个场景带额外事件；TCP 上两个都失败。

## 修后（本分支）

只覆盖已经 dispatch 的 `capability.execute` / `execute_batch`：

1. 原 execution deadline 之后再等最多 1 秒，收下 host 对这次调用的取消回复。模型 `stream` / `stream_next` 不走这个窗口；始终不回答的 tool 在 grace 结束时仍是 `result_unknown`。
2. factory 在 turn 已是 `Ok(aborted)`、且唯一的 `AcceptedUnknown` 是 advisory capture 时，保留该 aborted 终态。未结算的模型或 tool 调用仍先返回错误。
3. worker 保留 `ModuleOutcome::Cancelled` 且 `result.type=aborted` 的终态。deadline 之后的成功，以及空的 unknown，仍覆写成 `result_unknown`。

两次 full-53（`raw/full53-summary.txt`、`raw/full53-rerun-summary.txt`）都是 **51/2/0/0**。

`deadline_during_tool` 两次都是 `PASS: no semantic differences after projection.`（`raw/deadline_during_tool-pilotdeck.txt`、`raw/deadline_during_tool-rerun-pilotdeck.txt`）。那条 `gateway_submit_failed` / `result_unknown` 不再出现。

`deadline` 两次仍是 3 semantic，名单与 Formal 相同：额外 `gateway_submit_failed`，加上 `durableStopReason` null、`resultType` null（`raw/deadline-pilotdeck.txt`、`raw/deadline-rerun-pilotdeck.txt`）。它继续是 contract mismatch，没有变成 verified 2。

`sidecar_budget_limit` 两次仍是金额句 vs `max_budget_reached`。

failed 名只有这两项。没有第三名，也没有把 `deadline_during_tool` 写进 allowlist。
