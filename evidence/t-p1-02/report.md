# T-P1-02 evidence (R3 F1/F2 + n1–n6 + extended G8)

Collected on clean tree `1874e5d48a73aeb5d2821531367c8825e01c90bd` (`gitDirty=false`).
Base: `rust_standalone_alpha1@1d15a13033aeb57f2740b3677e13281cc5f9036d` (merge #20).
Draft PR: Eveosev/PilotDeck#21 → `rust_standalone_alpha1`.

## Commands

```
node tools/t-p1-02-harness/run.mjs --bin target/debug/pilotdeck-agent-loop --out evidence/t-p1-02/harness-1.json   # exit 0
node tools/t-p1-02-harness/run.mjs --bin target/debug/pilotdeck-agent-loop --out evidence/t-p1-02/harness.json     # exit 0
# host-only against an external --listen
PILOTDECK_AGENT_LOOP_TRANSPORT=tcp \
PILOTDECK_AGENT_LOOP_TCP_HOST=127.0.0.1 \
PILOTDECK_AGENT_LOOP_TCP_PORT=<ephemeral> \
  node tools/t-p1-02-harness/run.mjs --host-only --out evidence/t-p1-02/host-only.json   # exit 0
PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND=node node --experimental-strip-types tools/t-p1-02-harness/host.mjs          # exit 1
node tools/t-p1-02-harness/run.mjs --bin /no/such/pilotdeck-agent-loop-missing           # exit 1
node tools/t-p1-02-harness/run.mjs --fail-host                                           # exit 1
# SIGINT to run.mjs after rust --listen and host.mjs appear                             # exit 130
# SIGTERM to run.mjs after rust --listen and host.mjs appear                            # exit 143
pgrep -f 'pilotdeck-agent-loop --listen'   # before / mid / after (1s)
pgrep -f 't-p1-02-harness/host.mjs'        # before / mid / after (1s)
```

## Results

| Run | Exit | hello | execute | status | terminal | listen pgrep | host.mjs pgrep |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| harness-1 | 0 | ok | accepted | running + identities | completed + result fields | 0→0 | 0→0 |
| harness | 0 | ok | accepted | running + identities | completed + result fields | 0→0 | 0→0 |
| host-only | 0 | ok | accepted | running + identities | completed + result fields | 1→1 (external) | 0→0 |
| SIDECAR_COMMAND set | 1 | host refused spawn | | | | 0→0 | 0→0 |
| bad `--bin` | 1 | spawn ENOENT | | | | 0→0 | 0→0 |
| `--fail-host` | 1 | forced host error after listen | | | | 0→0 | 0→0 |
| SIGINT mid-run | 130 | rust+host seen (mid=1/1) then reaped in 6ms | | | | 0→0 | 0→0 |
| SIGTERM mid-run | 143 | rust+host seen (mid=1/1) then reaped in 6ms | | | | 0→0 | 0→0 |

Successful runs: `hostPid === host.pid` (no `spawnSync` grandchild). Host env:

- `PILOTDECK_AGENT_LOOP_TRANSPORT=tcp`
- `PILOTDECK_AGENT_LOOP_TCP_HOST=127.0.0.1`
- `PILOTDECK_AGENT_LOOP_TCP_PORT=<ephemeral>`
- `SIDECAR_COMMAND` / `SIDECAR_PATH` unset

The host **mirrors** `createTcpAgentLoopSidecarConnectionFactory` (`AgentLoopDeploymentProfile.ts:84-93`) with `createConnection` + `setNoDelay`. It does not import or call the factory (`connectFactoryUsed: false`).

Status asserts `payload.{runId,operationId,requestIds,cancelRequested,state}` (running without outcome, or completed with `outcome=completed`). Terminal asserts `eventType=agent.execute.completed`, `outcome=completed`, and `result.{type,sessionId,turnId,stopReason,turns,startedAt,completedAt}`.

Signaled reports include `interruptedBy` (`SIGINT` / `SIGTERM`). Node ≥ 22.6 is required (`--experimental-strip-types`).

## Leak gates (extended G8 / n5)

See `r2m1-leak-summary.json` (canonical; the duplicate `leak-summary.json` was removed) and `leak-*-{before,mid,after}.txt`.

Both `pgrep -f 'pilotdeck-agent-loop --listen'` and `pgrep -f 't-p1-02-harness/host.mjs'` returned to the pre-run baseline after every run. SIGINT/SIGTERM were sent to the `run.mjs` PID only; both counts were back to baseline within 1s (6ms / 6ms). No leftover listen or host.mjs processes (no grandchildren).

## Scope

- `tools/t-p1-02-harness/`, `evidence/t-p1-02/`
- `src/`, `ui/`, `packages/`, `protocol.ts`, crate TCP implementation: unchanged
- Not done: T-P1-03/04/07, real model, resume/ack, protocol change
