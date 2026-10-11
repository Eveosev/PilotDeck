# Desktop packaging checklist

## PKG-14 — Hello Rust extraResources (S0, linux x64)

Status: **draft / in progress** (hello crate + extraResources + verify handshake). Not a product default runtime. `spawnRuntime` still launches the Node runtime.

### Paths

| Role | Path |
|---|---|
| Crate | `crates/pilotdeck-agent-loop-hello/` |
| Workspace cargo output | `target/release/pilotdeck-agent-loop-hello` |
| Staged extraResources source | `apps/desktop/resources/rust/pilotdeck-agent-loop-hello` |
| Packaged location | `Resources/rust/pilotdeck-agent-loop-hello` (`from: resources/rust` → `to: rust`) |
| Verify | `node apps/desktop/scripts/verify-rust-hello.mjs` |
| Rust substep (always cargo + copy) | `node apps/desktop/scripts/build-runtime.mjs --rust-only` |

The binary itself is gitignored. `apps/desktop/resources/rust/.gitkeep` keeps the directory. Verify builds it when missing by calling the rust substep (`cargo build --release` then copy). Full `build-runtime.mjs` also invokes that substep before the existing Node runtime work; if `cargo` is absent it skips (so current desktop CI without Rust still packs). `--rust-only` and verify always require `cargo`.

`mac.signIgnore` stays only the Playwright browsers path. Do **not** add `rust/`.

### Black-box acceptance

| # | Command | Expect |
|---|---|---|
| A1 | From a clean tree: `cargo build --release` | Exit 0. Binary at `target/release/pilotdeck-agent-loop-hello`. |
| A2 | `node apps/desktop/scripts/build-runtime.mjs --rust-only` | Exit 0. Binary at `apps/desktop/resources/rust/pilotdeck-agent-loop-hello`. Full `build-runtime.mjs` runs the same rust step first when `cargo` is on `PATH`. |
| A3 | Inspect `apps/desktop/package.json` `build.extraResources` and `build.mac.signIgnore` | extraResources contains `{ "from": "resources/rust", "to": "rust" }`. `signIgnore` is unchanged (Playwright browsers only; no rust entry). |
| A4 | `node apps/desktop/scripts/verify-rust-hello.mjs` | Exit 0. Binary exists (built if missing). Spawn stdio, send Module Protocol `hello` then `capabilities` JSONL, receive binding (`moduleId` / `moduleInstanceId` / `connectionGeneration` / `capabilitiesVersion`) and a capabilities payload with matching `capabilitiesVersion`, a `methods` array, and `transport=stdio`. |

### Out of scope (PKG-14 S0)

- Full AgentLoop execute / cancel / turn
- Switching product `spawnRuntime` to Rust
- PKG-15 (glibc / musl / manylinux)
- Windows signing / mac notarization
- UI / IPC / Tauri
