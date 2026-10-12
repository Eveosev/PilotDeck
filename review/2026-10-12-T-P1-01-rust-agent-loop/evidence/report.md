# T-P1-01 PR-A evidence (Round-1 F-1 / F-2 / F-3 / F-6 / F-9)

Collected on clean code tip `2b492df382999a0bdbb21406cce964760503ef5c` (`gitDirty=false`).
Base: `rust_standalone_alpha1@1da663a2`.
F-4 / F-5: not touched (pending Payne). B4: deferred to PR-B.

## Toolchain (F-8 / F-12)

```
rustc 1.83.0 (90b35a623 2024-11-26)
cargo 1.83.0 (5ffbef321 2024-10-29)
```

`cargo +1.83.0 test -p pilotdeck-agent-loop` exit 0 (this host's default toolchain is already 1.83.0 via `rust-toolchain.toml`).

## Commands

```
cargo test --workspace -- --test-threads=1   # twice, both exit 0
cargo +1.83.0 test -p pilotdeck-agent-loop -- --test-threads=1
cargo clean
cargo clippy --workspace --all-targets -- -D warnings
```

## Test counts

| Suite | Passed | Failed |
| --- | ---: | ---: |
| lib | 19 | 0 |
| `--test lock` | 5 | 0 |
| `--test roundtrip` | 2 | 0 |
| `--test sidecar_stdio` | 6 | 0 |
| hello + doc | 0 | 0 |
| **total** | **32** | **0** |

## Mutations M7 (uncommitted, reverted)

| ID | Change | LIB_EXIT | STDIO_EXIT | OVERALL |
| --- | --- | ---: | ---: | ---: |
| M7a | drop in-loop cancel check | 101 | 101 | **101** |
| M7b | `thread::sleep(delay); false` | 101 | 101 | **101** |
| M7c | `STUB_POLL_MS = 5000` | 101 | 101 | **101** |

M7c lib panic: `cancel mid-execute must terminate within 2s, took 4.95s`.

## Live emitted corpus (F-3)

`T_P1_01_EMITTED_OUT` dump from `rust_emitted_messages_roundtrip_schema_and_ts`: 19 messages (response 9 / error 7 / event 3), includes `agent.execute.completed` and `agent.execute.cancelled`.
