# T-P1-01 PR-A evidence (gaps 4 / 5 / 6)

Collected on clean code commit `29babbc740e6987d1430ef4085f91e16bf7bb6dc` (`gitDirty=false`).
Base: `rust_standalone_alpha1@1da663a2`.
B4 TS-host E2E: **not in this follow-up** (deferred to PR-B).

## Commands

```
cargo test --workspace -- --test-threads=1   # twice, both exit 0
cargo clean
cargo clippy --workspace --all-targets -- -D warnings   # exit 0; Checking pilotdeck-agent-loop
```

Gap 5 mutation (uncommitted, reverted):

```
# locally change parse_json_line to first-wins
cargo test -p pilotdeck-agent-loop --lib last_wins -- --nocapture
# FAIL exit 101; then git checkout -- crates/pilotdeck-agent-loop/src/protocol.rs
```

## Test counts

| Suite | Passed | Failed |
| --- | ---: | ---: |
| lib (`protocol`/`sidecar`/`time`) | 18 | 0 |
| `--test lock` | 5 | 0 |
| `--test roundtrip` | 2 | 0 |
| `--test sidecar_stdio` | 5 | 0 |
| hello crate + doc-tests | 0 | 0 |
| **total** | **30** | **0** |

Second `cargo test` run: same pass/fail counts. No network.

Delta vs previous evidence (28): +1 `s1_execute_rejects_step_id` (Gap 4), +1 `crate_rust_version_matches_hello_msrv` (Gap 6).

## Gap 4 — execute + stepId rejected (stdio)

`sidecar_stdio::s1_execute_rejects_step_id` sends a valid-looking execute with `stepId` over the real binary. Sidecar replies `kind=error`, `code=UNSUPPORTED_FIELD`. PASS.

## Gap 5 — last-wins via `parse_json_line`

`execute_duplicate_keys_last_wins_like_json_parse` now calls `parse_json_line` (not a local `raw()` helper). PASS: `requestId=second`, `payload.prompt=B`.

First-wins mutation (uncommitted): `requestId` became `"first"`; test FAILED:

```
assertion `left == right` failed
  left: String("first")
 right: "second"
test protocol::tests::execute_duplicate_keys_last_wins_like_json_parse ... FAILED
test result: FAILED. 0 passed; 1 failed
EXIT:101
```

Mutation was reverted; not in the code commit.

## Gap 6 — rust-version / MSRV

`crates/pilotdeck-agent-loop/Cargo.toml` already declared `rust-version = "1.83"`, matching hello and `rust-toolchain.toml` (`1.83.0`). Workspace root has no `rust-version`. **No Cargo.toml field was added or changed.** A lock test now pins the existing value so drift fails the suite.

## Clippy

`cargo clean` then `cargo clippy --workspace --all-targets -- -D warnings` shows:

```
Checking pilotdeck-agent-loop v0.1.0
Checking pilotdeck-agent-loop-hello v0.1.0
Finished ...
```

## Base contrast

`cargo test -p pilotdeck-agent-loop --test lock` on `1da663a2`: FAIL (`package ID specification did not match any packages`). On this code SHA: PASS (5 tests).

## Scope check

- `src/`, `package.json` / lockfile, CI: unchanged
- `crates/pilotdeck-agent-loop-hello`: unchanged
- Transport: stdio JSONL only (no TCP)
- No B4 TS-host E2E (deferred to PR-B)
