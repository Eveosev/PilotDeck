# T-P1-01 PR-A evidence (S0–S2)

Collected on clean code commit `be33c4d501ecf78f7cc5fdb9f01a5afd06beef67` (`gitDirty=false`).
Base: `rust_standalone_alpha1@1da663a2`.

## Commands

```
cargo test --workspace -- --test-threads=1   # twice, both exit 0
cargo clippy --workspace --all-targets -- -D warnings   # exit 0
```

Round-trip (ajv 8 strict + TS `validateModuleMessage`):

```
node crates/pilotdeck-agent-loop/scripts/roundtrip-validate.mjs --messages emitted-messages.json
```

Lock contrast on base:

```
git worktree add /tmp/t-p1-01-base 1da663a2
(cd /tmp/t-p1-01-base && cargo test -p pilotdeck-agent-loop --test lock)
# FAIL exit 101: package ID specification `pilotdeck-agent-loop` did not match any packages
```

## Test counts

| Suite | Passed | Failed |
| --- | ---: | ---: |
| lib (`protocol`/`sidecar`/`time`) | 18 | 0 |
| `--test lock` | 3 | 0 |
| `--test roundtrip` | 1 | 0 |
| `--test sidecar_stdio` | 4 | 0 |
| hello crate + doc-tests | 0 | 0 |
| **total** | **26** | **0** |

Second `cargo test` run: same pass/fail counts (wall-clock only differs). No network.

## Schema / TS round-trip

| Metric | Value |
| --- | ---: |
| Rust-emitted messages | 19 |
| ajv strict accept | 19 |
| TS `validateModuleMessage` accept | 19 |
| mismatch | **0** |

By emitted kind: response 9, event 3, error 7.

Per message type (S0–S2): hello/capabilities/execute/cancel/status each have ≥1 valid accept path and ≥1 invalid reject path (validator + sidecar). resume/ack are valid protocol frames but sidecar-rejected (`RESUME_UNSUPPORTED` / `ACK_UNSUPPORTED`) without panic/hang.

## Scope check

- `src/`, `package.json` / lockfile, CI: unchanged
- `crates/pilotdeck-agent-loop-hello`: unchanged
- Transport: stdio JSONL only (no TCP)
