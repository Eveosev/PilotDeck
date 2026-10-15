# FULL_53_CLASSIFICATION · T-P2-02

分母 **53**。比较：`same-version`，surface `gateway`，transport `stdio`，身份 `exec-proof`。
分类互斥：`pass` | `profile_gap` | `trace_diff` | `BLOCKED`。
`profile_gap` 的判定串是 sidecar 轨迹里的 `Rust normal-turn candidate has not implemented`。53 份 sidecar jsonl 里该串出现 **0** 次。
`BLOCKED` 为 0（summary.blocked 空，无超时、无身份失败）。

| # | 场景 | 分类 | 依据 |
|---|---|---|---|
| 1 | `pure_text` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 2 | `single_tool` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 3 | `multiple_tool` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 4 | `tool_error` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 5 | `permission_denial` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 6 | `max_turns` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 7 | `deadline` | trace_diff | 跑通但 extension 合同未过（3 处语义差）。rust 多一条 durable.status event=gateway_submit_failed，kind/statusKind/text 都在（T-P2-09：不是缺 kind/text）。另 durableStopReason/resultType 为 null，native 为 aborted_streaming/aborted。无 profile_gap。 |
| 8 | `cancel` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 9 | `image` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 10 | `checkpoint_resume` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 11 | `permission_allow` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 12 | `permission_ask_approve` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 13 | `permission_ask_deny` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 14 | `can_prompt_false` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 15 | `multi_tool_ordered` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 16 | `multi_tool_mixed_permission` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 17 | `multi_tool_mixed_error` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 18 | `large_tool_result` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 19 | `tool_retryable_error` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 20 | `tool_non_retryable_error` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 21 | `model_retryable_error` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 22 | `model_non_retryable_error` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 23 | `malformed_model_response` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 24 | `stream_interruption` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 25 | `cancel_during_tool` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 26 | `deadline_during_tool` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 27 | `multimodal_image_and_text` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 28 | `allowed_read_files` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 29 | `denied_read_files` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 30 | `write_snapshot_resume` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 31 | `auto_compact` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 32 | `plan_mode_host_policy` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 33 | `plan_mode_bypass_host_policy` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 34 | `sidecar_budget_limit` | trace_diff | 跑通。durable.status event=max_budget_reached 的 text：native 为 Gateway 金额句，rust 为 max_budget_reached。kind 与 statusKind=error 两侧相同（T-P2-09：text 文案差，不是缺 kind）。无 profile_gap。 |
| 35 | `sidecar_elicitation` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 36 | `sidecar_elicitation_execution` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 37 | `sidecar_sdk_tool_progress` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 38 | `sidecar_live_steer` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 39 | `sidecar_durable_compaction` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 40 | `sidecar_full_request_compaction_budget` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 41 | `sidecar_projected_request_compaction_budget` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 42 | `sidecar_seed_read_state` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 43 | `sidecar_live_model_stream` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 44 | `sidecar_model_metadata` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 45 | `sidecar_empty_system_prompt` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 46 | `sidecar_additional_working_directories` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 47 | `sidecar_continuable_followup_live` | pass | CONTRACT PASS continuable_actor_v1；无未声明语义差；exec-proof。 |
| 48 | `sidecar_continuable_followup_cold` | pass | CONTRACT PASS continuable_actor_v1；无未声明语义差；exec-proof。 |
| 49 | `sidecar_parent_close_after_admission` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 50 | `sidecar_one_shot_subagent_success` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 51 | `sidecar_one_shot_subagent_failure` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 52 | `sidecar_one_shot_parent_abort_after_admission` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |
| 53 | `sidecar_one_shot_parent_close_after_admission` | pass | 语义 0 diff；exec-proof；sidecar 轨迹无 “has not implemented”。 |

合计：pass 51，profile_gap 0，trace_diff 2，BLOCKED 0。分母 53。

## T-P2-09

只在语义 diff 碰到 status 的 `kind` / `text` 时记。51 个 pass 没有这类语义差。

- `deadline`：native 与 rust 的 `turn_timeout` 都有 `kind=durable.status`、`statusKind=error`、`text=Turn exceeded the 3000ms timeout.`。rust 另有 `gateway_submit_failed`，同样带齐 `kind` / `statusKind` / `text`。差的是多了一条事件，以及终态 `durableStopReason` / `resultType`，不是缺字段。
- `sidecar_budget_limit`：两侧 `kind=durable.status`、`statusKind=error`、`event=max_budget_reached`。差的是 `text`（native 金额句 vs rust `max_budget_reached`）。

预测里的压缩场景（`auto_compact`、`sidecar_durable_compaction`、两条 compaction budget）这次语义通过，没有撞上 `profile_gap`。
