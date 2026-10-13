# T-P1-01 PR-B evidence (F-5 / S3 / S4)

Collected on clean tree `fd5dececd778ae2a7e8df0cbd2456936625b6090` (`gitDirty=false`).
Base: `rust_standalone_alpha1@61ef132170b642fecf7e0acaf65b8f121319a651`.
Draft PR: Eveosev/PilotDeck#18 → `rust_standalone_alpha1`.

## Commands

```
cargo test --workspace -- --test-threads=1   # twice, both exit 0, 55/0
cargo clean
cargo clippy --workspace --all-targets -- -D warnings   # exit 0; Checking pilotdeck-agent-loop
T_P1_01_EMITTED_OUT=evidence/t-p1-01/emitted-messages.json \
  PILOTDECK_AGENT_LOOP_STABLE_IDS=1 \
  cargo test -p pilotdeck-agent-loop --test roundtrip rust_emitted_messages_roundtrip_schema_and_ts
crates/pilotdeck-agent-loop/tests/mask_f3.sh --committed evidence/t-p1-01/emitted-messages.json
# exit 0; 19 messages; F-5 shape; field sets match; masked bytes identical
```

## Test counts

| Suite | Passed | Failed |
| --- | ---: | ---: |
| lib (`protocol`/`sidecar`/`time`/`parse_serve_mode`) | 27 | 0 |
| `--test lock` | 6 | 0 |
| `--test roundtrip` | 2 | 0 |
| `--test serde_r2` | 7 | 0 |
| `--test sidecar_stdio` | 6 | 0 |
| `--test sidecar_tcp` | 7 | 0 |
| hello crate + doc-tests | 0 | 0 |
| **total** | **55** | **0** |

Second `cargo test` run: same pass/fail counts (`run1EqRun2=true`). No network.

## F-5

Live corpus completed final: `payload.result.{type:success, sessionId:sess-done, turnId:turn-done}`.
Cancelled final: `payload.result.{type:aborted, sessionId:sess-1, turnId:turn-1, stopReason:aborted_streaming}`.
Not empty `payload:{}`.

## S3 (TS JSON.parse + validateModuleMessage)

| Case | TS | Rust | Divergence |
| --- | --- | --- | --- |
| 1.0 | accept (js=1) | accept | none |
| -0 | accept (`Object.is(-0,-0)`) | accept (i64 0) | sign not preserved as a distinct Number; accept/reject aligned |
| 1e2 / 1E0 / 100e-2 | accept | accept | none |
| >2^53 `9007199254740993` | accept (js=9007199254740992) | accept (exact 9007199254740993) | value split; accept/reject aligned |
| 1e400 | parse Infinity, then reject | parse error | path differs; both reject |
| duplicate keys | last-wins | last-wins via `Value` | none |
| ajv strict | accept 1.0 / reject 1e400 | same | none |

## S4

`--listen 127.0.0.1:0`. Full B1/B4 suite over TCP (`sidecar_tcp` 7 tests) including cancel/status/resume/ack/malformed plus Node TS host `b4-tcp-host.mjs`.

## mask_f3

Moved to `crates/pilotdeck-agent-loop/tests/mask_f3.sh`. Not deleted: `*At` timestamps still vary. Stable IDs via `PILOTDECK_AGENT_LOOP_STABLE_IDS=1`.

## Scope

- `src/`, `package.json` / lockfile, CI: unchanged
- `crates/pilotdeck-agent-loop-hello`: unchanged
- Transport: stdio JSONL + TCP listen
