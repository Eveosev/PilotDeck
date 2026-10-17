# WIRE_KIND_TEXT · T-P2-09

对照本仓 `AgentLoop.toAgentStatusEvent`（`src/agent/loop/AgentLoop.ts`）。协议字段仍可选（`src/agent/protocol/events.ts`）。本切片只补 rust-core 投影，不删 TS 的 `kind` / `text`。

## 投影

| 变体 | 改前 wire | 改后 wire |
|---|---|---|
| `TurnEvent::AgentStatus` | `event` + `detail` | `event` + `kind` + `text` + `detail` |
| `TurnEvent::AgentStatusText` | `event` + `text` + `detail` | `event` + `kind` + `text` + `detail` |

字段顺序与 TS 工厂一致：`type`、`sessionId`、`turnId`、`event`、`kind`、`text`、`detail`。

## kind

以 AgentLoop 工厂为准，不按 sidecar 兜底集合改写。`detail.severity == "warning"` 不把工厂错误降成 `status`。

| event | kind |
|---|---|
| `turn_aborted` | `status` |
| `structured_output_completed` | `status` |
| `max_budget_reached` / `task_budget_reached` | `error` |
| `content_filter_stop` | `error` |
| `unknown_finish_reason` | `error` |
| `model_request_failed` | `error` |
| `tool_call_recovery_exhausted` | `error` |
| `tool_error_loop` | `error` |
| `lifecycle_blocked` | `error` |
| `model_empty_response_exhausted` | `error` |
| `max_turns_reached` | `error` |
| `max_output_recovery_exhausted` | `error` |

未命名事件才看显式 `kind`，再看 `detail.severity == "error"`，否则 `status`。

## text

优先用工厂已经放进 status 的 `text`，否则用 `detail.message`（非空字符串）。budget 终端的 `status_detail` 没有 `message`；`text` 取 Gateway 金额句，与 `budget_terminal_policy` / `AgentLoop.ts` 同形：

`Reached Gateway-owned {maxBudgetUsd|taskBudget.total} ($limit) after spending $spent.`

`turn.rs` 里「AgentLoop omits text」的过时注释已改写。sidecar 不再需要用事件名填充 budget text。

## 与「缺字段」分开的余差

`deadline` 的终态 `durableStopReason` / `resultType` 仍可能和 native 不同。这不是缺 `kind` / `text`。`turn_timeout` 两侧都已有 `statusKind=error` 与超时句。多出来的 `gateway_submit_failed` 不在本切片的必修范围内；对拍里若未出现，记在 `PROVENANCE.md`，不把它写成字段修复。
