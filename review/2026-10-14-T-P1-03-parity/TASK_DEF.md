# T-P1-03 TASK_DEF

Source: `review/2026-10-09-rust-proposal-v2/TASK_PLAN.md:78`

| T-P1-03 | 跑 pure_text + single_tool（≥30 次）；目标实现经 T-P0a-00 可替换 | QA | T-P1-02, T-P0a-00, T-P0a-02 | evidence/p1/{scenario}.json | trace 与 TS-tcp 一致 | 粗估 1 人天 | — |

## Payne-approved decisions

- **PR-A / PR-B split.** This PR-A ships the `single_tool` stub, F-9, and unit tests. The ≥30-run parity evidence against TS-tcp is PR-B.
- **Reuse mode.** Start the crate with `--listen` first; `tools/agent-loop-parity/run.py` connects via `--pilotdeck-tcp-host` / `--pilotdeck-tcp-port`. The crate does not read env for host/port.
- **F-9(a) already on baseline `c5bed6c1`.** Finished `operationId` + different `runId` is rejected with `OPERATION_RUN_MISMATCH` (`crates/pilotdeck-agent-loop/src/sidecar.rs:223-234` on this PR; `:223-234` / test `:1251` on `c5bed6c1`). That matches TS `src/agent/modules/transport/moduleRuntime.ts:30`. PR-A only adds tests (`execute_finished_run_mismatch_is_rejected` assertions + `execute_finished_run_match_is_accepted`).
- **F-9(b) already matches TS on baseline — no product change.** Same `runId` re-execute of a finished operation is accepted (`moduleRuntime.ts:31-34` keeps `state` unless it is `pending`; `agentLoopSidecarServer.ts:208-221` only rejects an *active* operation, then `accept`s and runs again). `recordFinal` will not overwrite the first outcome (`moduleRuntime.ts:51`; pinned by `tests/agent/modules/module-protocol.spec.ts:250-251`). Rust `accept_operation` (`sidecar.rs:393-401`) and `record_final_locked` (`sidecar.rs:796-800`) already do the same, so a second `agent.execute.completed` can emit while `status` still reports the first outcome. PR-A only adds `execute_finished_same_run_keeps_first_status_outcome` to lock that TS alignment.
