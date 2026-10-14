# T-P1-03 TASK_DEF

Source: `review/2026-10-09-rust-proposal-v2/TASK_PLAN.md:78`

| T-P1-03 | 跑 pure_text + single_tool（≥30 次）；目标实现经 T-P0a-00 可替换 | QA | T-P1-02, T-P0a-00, T-P0a-02 | evidence/p1/{scenario}.json | trace 与 TS-tcp 一致 | 粗估 1 人天 | — |

## Payne-approved decisions

- **PR-A / PR-B split.** This PR-A ships the `single_tool` stub, F-9, and unit tests. The ≥30-run parity evidence against TS-tcp is PR-B.
- **Reuse mode.** Start the crate with `--listen` first; `tools/agent-loop-parity/run.py` connects via `--pilotdeck-tcp-host` / `--pilotdeck-tcp-port`. The crate does not read env for host/port.
- **F-9 fixed in PR-A.** `execute` re-entry whose `runId` does not match the recorded run is rejected with the protocol error (`OPERATION_RUN_MISMATCH` for a finished operation; `OPERATION_IDENTITY_MISMATCH` while the operation is still active). The matching-`runId` path is unchanged.
