# T-P1-03 TASK_DEF

Source note: the T-P1-03 row below is inlined from the rust-proposal-v2 task plan (row originally cited as TASK_PLAN.md:78). That plan file is not in this repo, so the row is copied here instead of linking a path outside the checkout.

| T-P1-03 | 跑 pure_text + single_tool（≥30 次）；目标实现经 T-P0a-00 可替换 | QA | T-P1-02, T-P0a-00, T-P0a-02 | evidence/p1/{scenario}.json | trace 与 TS-tcp 一致 | 粗估 1 人天 | — |

## Payne-approved decisions

- **PR-A / PR-B split.** This PR-A ships a host-driven stub: sidecar-originated `module_call` to host `model` / `capability`. The ≥30-run parity evidence against TS-tcp is PR-B.
- **Reuse mode.** Start the crate with `--listen` first; `tools/agent-loop-parity/run.py` connects via `--pilotdeck-tcp-host` / `--pilotdeck-tcp-port`. The crate does not read env for host/port.
- **B2(a).** The crate does not detect `pure_text` vs `single_tool`. It sends `module_call` to host model with the conversation; if the host reply has `tool_calls`, it sends `module_call` to host capability for each, emits `tool_calls_detected` / `tool_result`, then calls model again; if the host returns text only, it finishes. Host inbound `module_call` stays `UNEXPECTED_MODULE_CALL`.
- **B1.** Prompt is the last user message's text block (`messages[].content[]`, `canonical.ts:178-182`). Execute payload shape follows `agentLoopSidecarClient.ts:741-775`. `tools[]` is the host manifest and is always non-empty — not a scenario selector. The crate does not read `payload.scenario` or `q`.
- **F-9(a) and F-9(b) were already TS-aligned on baseline `c5bed6c1`. PR-A adds tests only; no F-9 product-logic change.**
- **F-9(a)** (baseline): finished `operationId` + different `runId` → `OPERATION_RUN_MISMATCH`. TS `src/agent/modules/transport/moduleRuntime.ts:30`. Rust `c5bed6c1` `sidecar.rs:223-234` / test `:1251`. PR-A test: `execute_finished_run_mismatch_is_rejected`.
- **F-9(b)** (baseline): same `runId` re-execute of a finished operation is accepted (`moduleRuntime.ts:31-34`); `InProcessModuleRuntime.execute` still yields a second completed (`moduleRuntime.ts:192-198`, `:268-293`, `:295-310`); `recordFinal` keeps the first outcome (`moduleRuntime.ts:51`; `tests/agent/modules/module-protocol.spec.ts:250-251`). PR-A merged test: `execute_finished_cancel_then_complete_keeps_cancelled_status` (first run cancel, second run complete, status stays `cancelled`). Must pass on baseline `c5bed6c1` and tip.

## M1 (Payne-approved)

- Real host `sidecarDefaultModuleDispatcher.ts:67-150` / `hostModelInvokerPort.ts` has no `operation: complete`. Sidecar mints `preparationId` and drives `prepare` → `stream` → `close_stream`. Model text / tool calls are assembled from `payload.events` (`text_delta`, `tool_call_end`), not `payload.message` / `choices`. Capability `execute` is unchanged.

## M2 (Payne-approved)

- Outbound `messages[].content` / `message.content` is always a Canonical block array `[{type:"text", text}]` (or `tool_call` / `tool_result` blocks). The former string content was only on the pure_text completed path (`emit_text_only_turn` → `emit_completed`). `capability_result` now wraps a host string `content` into a text block and keeps an array as-is. Cancelled / failed terminals emit `messages: []`.

## R2 / B3(a) (Payne-approved)

- **budget.** Before each host model call, if `hostModules.budget` advertises `evaluate_request_budget`, sidecar calls that operation and emits `agent.context_budget` with the host snapshot (AgentLoop.ts:784-830). Host durable `context_budget` status follows from that event.
- **modelView.** `model_request` sends `agent.maxOutputTokens`, `systemPrompt`, `stream`, `toolChoice` / `thinking` / `metadata` when present, and model tool schemas `{name,description,inputSchema}` (not the raw host manifest). Tool-call conversation messages carry `timeline` / `metadata.model`; tool results carry `raw`.
- **next_turn.** After first-round tool results, emit `agent.turn_continued` with `reason: "next_turn"`.
- **m-a.** `capability_result` keeps host `error`; the matching `tool_result` sets `isError`. `json` / `file` blocks are rewritten to text; empty arrays and plain string arrays are rejected (fallback text / string-to-text-block).
- **m-b.** First-round text before tool calls is kept on the same assistant message. Multiple tool calls in one round become one assistant message and one results message. A second-round tool call fails with `UNEXPECTED_SECOND_TURN_TOOL_CALLS`.
- **m-c.** Prepare interrupt and a host that never answers `stream` both send `close_stream`. Tests: `cancel_during_prepare_still_sends_close_stream`, `cancel_while_host_omits_stream_still_closes_stream`.
- **n-b errata (append-only).** The F-9(a) sentence above keeps its `c5bed6c1` cites (`sidecar.rs:223-234` / test `:1251`). Those are baseline line numbers, not the current tip. TS `moduleRuntime.ts:30` is unchanged. Current rust check is `sidecar.rs` `OPERATION_RUN_MISMATCH` in `handle_execute` and test `execute_finished_run_mismatch_is_rejected`.
