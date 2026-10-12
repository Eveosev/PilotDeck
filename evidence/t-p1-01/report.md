# T-P1-01 PR-A evidence (Round-2 R2-1 / R2-2)

Collected on evidence payload tip `16b274aa4fc63ec86bf4e84dcfb8a92c9952ab5b` (`gitDirty=false`).
Code tip: `16b274aa4fc63ec86bf4e84dcfb8a92c9952ab5b` (R2-2 regen; includes R2-1 deadline lock tests).
Base: `rust_standalone_alpha1@1da663a2`.
F-4 closed. F-5 stub payload / B4 TS-host E2E: **deferred to PR-B**.

## Commands

```
cargo test --workspace -- --test-threads=1   # twice, both exit 0
cargo clean
cargo clippy --workspace --all-targets -- -D warnings   # exit 0; Checking pilotdeck-agent-loop
T_P1_01_EMITTED_OUT=evidence/t-p1-01/emitted-messages.json \
  cargo test -p pilotdeck-agent-loop --test roundtrip rust_emitted_messages_roundtrip_schema_and_ts
review/2026-10-12-T-P1-01-rust-agent-loop/mask_f3.sh --live evidence/t-p1-01/emitted-messages.json
# exit 0; 19 messages; field sets match; masked bytes identical
```

## Test counts

| Suite | Passed | Failed |
| --- | ---: | ---: |
| lib (`protocol`/`sidecar`/`time`) | 25 | 0 |
| `--test lock` | 5 | 0 |
| `--test roundtrip` | 2 | 0 |
| `--test sidecar_stdio` | 6 | 0 |
| hello crate + doc-tests | 0 | 0 |
| **total** | **38** | **0** |

Second `cargo test` run: same pass/fail counts. No network.

Delta vs previous evidence (30): +F-4 runtime/offset/ISO tests and +R2-1 future/attempt/min deadline tests.

## R2-1 deadline locks

- `future_deadline_completes_when_not_expired` — unexpired `operationDeadline` + short `delayMs` → `completed`
- `attempt_deadline_during_stub_sleep_is_result_unknown` — `attemptDeadline=now+100ms` + `delayMs=500` → `result_unknown` / `DEADLINE_EXCEEDED`
- `earliest_deadline_uses_sooner_of_operation_and_attempt` — earlier of the two fields wins

Author mutations (uncommitted, reverted): S1/S2/S3/F4a/F4b all EXIT 101. See `review/2026-10-12-T-P1-01-rust-agent-loop/PROGRESS.md`.

## Emitted corpus

19 messages (response 9 / event 3 / error 7) including `agent.execute.completed` and `agent.execute.cancelled`. `mask_f3.sh` vs `0e60f9e4` committed sample: exit 0.

## Gap 5 first-wins mutation (uncommitted, reverted)

`parse_json_line` forced first `requestId`/`prompt`. `execute_duplicate_keys_last_wins_like_json_parse` FAILED, EXIT 101.

## Clippy

`cargo clean` then `cargo clippy --workspace --all-targets -- -D warnings` shows `Checking pilotdeck-agent-loop` and exit 0.

## Base contrast

`cargo test -p pilotdeck-agent-loop --test lock` on `1da663a2`: FAIL (`package ID specification did not match any packages`). On code SHA `16b274aa`: PASS (5 tests).

## Scope

- `src/`, `package.json` / lockfile, CI: unchanged
- `crates/pilotdeck-agent-loop-hello`: unchanged
- Transport: stdio JSONL only (no TCP)
- F-5 stub `sessionId`/`turnId` / aborted shape: not changed
