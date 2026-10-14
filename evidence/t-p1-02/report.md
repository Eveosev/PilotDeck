# T-P1-02 evidence (TCP connect-only harness)

Collected on clean tree `3a6fbffd0397006651c0c27073f36d1917822eea` (`gitDirty=false`).
Base: `rust_standalone_alpha1@0db122b3b60b638b01edd45fe8650fcd9d4eeb8e` (merge #18).
Draft PR: Eveosev/PilotDeck#20 → `rust_standalone_alpha1`.

## Commands

```
node tools/t-p1-02-harness/run.mjs --out evidence/t-p1-02/harness-1.json   # exit 0
node tools/t-p1-02-harness/run.mjs --out evidence/t-p1-02/harness.json     # exit 0
# host-only: start rust --listen 127.0.0.1:0, then
PILOTDECK_AGENT_LOOP_TRANSPORT=tcp \
PILOTDECK_AGENT_LOOP_TCP_HOST=127.0.0.1 \
PILOTDECK_AGENT_LOOP_TCP_PORT=<ephemeral> \
  node tools/t-p1-02-harness/run.mjs --host-only --out evidence/t-p1-02/host-only.json   # exit 0
PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND=node ... node tools/t-p1-02-harness/host.mjs        # exit 1
```

## Results

| Run | Exit | hello | execute | status | terminal | mismatch |
| --- | ---: | --- | --- | --- | --- | ---: |
| harness-1 | 0 | ok | accepted | running | completed | 0 |
| harness | 0 | ok | accepted | running | completed | 0 |
| host-only | 0 | ok | accepted | running | completed | 0 |
| SIDECAR_COMMAND set | 1 | host refused spawn | | | | |

Host env on the successful runs:

- `PILOTDECK_AGENT_LOOP_TRANSPORT=tcp`
- `PILOTDECK_AGENT_LOOP_TCP_HOST=127.0.0.1`
- `PILOTDECK_AGENT_LOOP_TCP_PORT=<ephemeral>`
- `PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND` / `SIDECAR_PATH` unset

Harness starts Rust `pilotdeck-agent-loop --listen 127.0.0.1:0` and reads `listening HOST:PORT` from stderr. The host process only TCP-connects (`createConnection` + `setNoDelay`, same as `createTcpAgentLoopSidecarConnectionFactory` / `AgentLoopDeploymentProfile.ts:84-93`). Dialogue is hello → execute (`pure_text` stub) → status. `sessionId` / `turnId` echo `sess-t-p1-02` / `turn-t-p1-02`. Every incoming frame accepted by `validateModuleMessage`.

## Scope

- `tools/t-p1-02-harness/`, `evidence/t-p1-02/`
- `src/`, `ui/`, `packages/`, `protocol.ts`, crate TCP implementation: unchanged
- Not done: T-P1-03/04/07, real model, resume/ack, protocol change
