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
| Rust substep (explicit cargo + copy) | `node apps/desktop/scripts/build-runtime.mjs --rust-only` |

The binary itself is gitignored. `apps/desktop/resources/rust/.gitkeep` keeps the directory. Verify builds it when missing by calling the rust substep (`cargo build --release` then copy).

**Opt-in only.** Full `build-runtime.mjs` / `dev` / `pack` / `dist:*` do **not** invoke cargo unless `PILOTDECK_DESKTOP_RUST=1` or `PILOTDECK_DESKTOP_REQUIRE_RUST=1` is set. Jobs that claim PKG-14 must set one of those envs or call `--rust-only`. `--rust-only` and verify always require `cargo`. On Windows the staged name is `pilotdeck-agent-loop-hello.exe`.

`mac.signIgnore` stays only the Playwright browsers path. Do **not** add `rust/`.

`transport: "stdio"` on the capabilities payload is a hello-sidecar extra field. It is not in the TS `ModuleCapabilities` type; the existing client ignores unknown fields. It is not a second protocol.

### Black-box acceptance

| # | Command | Expect |
|---|---|---|
| A1 | From a clean tree: `cargo build --release` | Exit 0. Binary at `target/release/pilotdeck-agent-loop-hello`. |
| A2 | `node apps/desktop/scripts/build-runtime.mjs --rust-only` | Exit 0. Binary at `apps/desktop/resources/rust/pilotdeck-agent-loop-hello`. Full `build-runtime.mjs` does not run cargo unless `PILOTDECK_DESKTOP_RUST=1` / `PILOTDECK_DESKTOP_REQUIRE_RUST=1`. |
| A3 | Inspect `apps/desktop/package.json` `build.extraResources` and `build.mac.signIgnore` | extraResources contains `{ "from": "resources/rust", "to": "rust" }`. `signIgnore` is unchanged (Playwright browsers only; no rust entry). |
| A4 | `node apps/desktop/scripts/verify-rust-hello.mjs` | Exit 0. Binary exists (built if missing). Spawn stdio, send Module Protocol `hello` then `capabilities` JSONL, receive binding (`moduleId` / `moduleInstanceId` / `connectionGeneration` / `capabilitiesVersion`) and a capabilities payload with matching `capabilitiesVersion`, a `methods` array, and `transport=stdio`. After handshake, stdin is closed and the sidecar **exitCode must be 0** (hang/crash/SIGTERM is FAIL). |

### Out of scope (PKG-14 S0)

- Full AgentLoop execute / cancel / turn
- Switching product `spawnRuntime` to Rust
- PKG-15 (glibc / musl / manylinux)
- Windows signing / mac notarization
- UI / IPC / Tauri
