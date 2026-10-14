# T-P1-02 harness

Reusable TCP harness for the Rust `pilotdeck-agent-loop` crate from T-P1-01 / #18.

1. Start `pilotdeck-agent-loop --listen 127.0.0.1:0`.
2. Discover the ephemeral port from stderr (`listening HOST:PORT`).
3. Run a **connect-only** TS host. The host never spawns and never sees `PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND` / `SIDECAR_PATH`. It connects with the same TCP env as `src/cli/AgentLoopDeploymentProfile.ts` (`TRANSPORT` / `TCP_HOST` / `TCP_PORT`) using `createConnection({ host, port })` + `setNoDelay`. That **mirrors** `createTcpAgentLoopSidecarConnectionFactory` (`AgentLoopDeploymentProfile.ts:84-93`); the host does not import or call the factory.
4. Dialogue: **hello → execute → status**. Exit 0 on success.

This is not T-P1-03/04/07, not a real model, and not resume/ack.

## Run

From the repo root (Node ≥ 22.6 required — `--experimental-strip-types`; Rust 1.83, `cargo` on PATH):

```bash
node tools/t-p1-02-harness/run.mjs
```

Reuse an already-listening sidecar:

```bash
PILOTDECK_AGENT_LOOP_TRANSPORT=tcp \
PILOTDECK_AGENT_LOOP_TCP_HOST=127.0.0.1 \
PILOTDECK_AGENT_LOOP_TCP_PORT=9345 \
  node tools/t-p1-02-harness/run.mjs --host-only
```

Options:

- `--bin PATH` — Rust binary (default: `cargo build -p pilotdeck-agent-loop` → `target/debug/pilotdeck-agent-loop`)
- `--out FILE` — write the combined JSON report
- `--host-only` — skip listen; require the TCP env above
- `--fail-host` — after listen, force the host to fail (cleanup / leak evidence)

Listen parse accepts a full `listening HOST:PORT` line only (`127.0.0.1` / `localhost` / `[::1]:PORT`), LF or CRLF. `run.mjs` spawns the host with `--experimental-strip-types` so `host.mjs` does not `spawnSync`-re-exec. The harness never calls `process.exit()` until children are reaped; SIGINT/SIGTERM/SIGHUP/`exit` kill them (SIGTERM, then SIGKILL).

The crate-local S4/B4 script (`crates/pilotdeck-agent-loop/scripts/b4-tcp-host.mjs`) stays the full cancel/resume/ack dialogue. This harness wraps the same `--listen` path into `tools/` as hello→execute→status only.

## Evidence

```bash
node tools/t-p1-02-harness/run.mjs --out evidence/t-p1-02/harness.json
```
