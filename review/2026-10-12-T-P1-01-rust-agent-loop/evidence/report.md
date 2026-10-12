# T-P1-01 PR-A evidence (S0–S2 follow-up)

Collected on clean code commit `4dd7a8b7b5e8749678cd4c6dba0fbb76628fbb91` (`gitDirty=false`).
Base: `rust_standalone_alpha1@1da663a2`.

## Commands

```
cargo test --workspace -- --test-threads=1   # twice, both exit 0
cargo clean
cargo clippy --workspace --all-targets -- -D warnings   # exit 0; Checking pilotdeck-agent-loop
```

Accept corpus (Rust-emitted):

```
node crates/pilotdeck-agent-loop/scripts/roundtrip-validate.mjs --messages emitted-messages.json
```

Invalid corpus (B1 gap):

```
node crates/pilotdeck-agent-loop/scripts/roundtrip-validate.mjs \
  --messages crates/pilotdeck-agent-loop/fixtures/invalid-messages.json \
  --expect reject --rust-decisions rust-decisions.json
```

## Test counts

| Suite | Passed | Failed |
| --- | ---: | ---: |
| lib (`protocol`/`sidecar`/`time`) | 18 | 0 |
| `--test lock` | 4 | 0 |
| `--test roundtrip` | 2 | 0 |
| `--test sidecar_stdio` | 4 | 0 |
| hello crate + doc-tests | 0 | 0 |
| **total** | **28** | **0** |

Second `cargo test` run: same pass/fail counts. No network.

## Schema / TS / Rust

### Accept (Rust-emitted)

| Metric | Value |
| --- | ---: |
| messages | 19 |
| ajv strict accept | 19 |
| TS `validateModuleMessage` accept | 19 |
| mismatch | **0** |

By kind: response 9, event 3, error 7.

### Reject (invalid fixture, ≥1 per message type)

| Metric | Value |
| --- | ---: |
| samples | 20 |
| ajv strict reject | 20 |
| TS `validateModuleMessage` reject | 20 |
| Rust `validate_module_message` reject | 20 |
| three-way mismatch | **0** |
| expectViolations | **0** |

Types: hello, capabilities, execute (missing fields / attemptId / stepId), cancel, status, resume, ack, module_call, event, response, error, invalid kind, non-object.

## Clippy

`cargo clean` then `cargo clippy --workspace --all-targets -- -D warnings` shows:

```
Checking pilotdeck-agent-loop v0.1.0
Checking pilotdeck-agent-loop-hello v0.1.0
Finished ...
```

## Scope check

- `src/`, `package.json` / lockfile, CI: unchanged
- `crates/pilotdeck-agent-loop-hello`: unchanged
- Transport: stdio JSONL only (no TCP)
- No TS-host E2E (B4) in this follow-up
