# T-P1-03 TASK_DEF

Source: `review/2026-10-09-rust-proposal-v2/TASK_PLAN.md:78`

| T-P1-03 | 跑 pure_text + single_tool（≥30 次）；目标实现经 T-P0a-00 可替换 | QA | T-P1-02, T-P0a-00, T-P0a-02 | evidence/p1/{scenario}.json | trace 与 TS-tcp 一致 | 粗估 1 人天 | — |

## Payne-approved decisions

- **PR-A / PR-B split.** This PR-A ships the `single_tool` stub and unit tests. The ≥30-run parity evidence against TS-tcp is PR-B.
- **Reuse mode.** Start the crate with `--listen` first; `tools/agent-loop-parity/run.py` connects via `--pilotdeck-tcp-host` / `--pilotdeck-tcp-port`. The crate does not read env for host/port.
- **F-9(a) and F-9(b) were already TS-aligned on baseline `c5bed6c1`. PR-A adds tests only; no F-9 product-logic change.**
- **F-9(a)** (baseline): finished `operationId` + different `runId` → `OPERATION_RUN_MISMATCH`. TS `src/agent/modules/transport/moduleRuntime.ts:30`. Rust `c5bed6c1` `sidecar.rs:223-234` / test `:1251`. PR-A test: `execute_finished_run_mismatch_is_rejected`.
- **F-9(b)** (baseline): same `runId` re-execute of a finished operation is accepted (`moduleRuntime.ts:31-34`); `InProcessModuleRuntime.execute` still yields a second completed (`moduleRuntime.ts:192-198`, `:268-293`, `:295-310`); `recordFinal` keeps the first outcome (`moduleRuntime.ts:51`; `tests/agent/modules/module-protocol.spec.ts:250-251`). PR-A tests: `execute_finished_run_match_is_accepted`, `execute_finished_same_run_keeps_first_status_outcome`.
