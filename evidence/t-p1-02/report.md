# T-P1-02 evidence (R1 + G8/G9)

Collected on clean tree `b5b47aee481d464ffd918fdf3b6191d9a202df52` (`gitDirty=false`).
Base: `rust_standalone_alpha1@0db122b3b60b638b01edd45fe8650fcd9d4eeb8e` (merge #18).
Draft PR: Eveosev/PilotDeck#20 → `rust_standalone_alpha1`.

## Commands

```
node tools/t-p1-02-harness/run.mjs --out evidence/t-p1-02/harness-1.json   # exit 0
node tools/t-p1-02-harness/run.mjs --out evidence/t-p1-02/harness.json     # exit 0
# host-only against an external --listen
PILOTDECK_AGENT_LOOP_TRANSPORT=tcp \
PILOTDECK_AGENT_LOOP_TCP_HOST=127.0.0.1 \
PILOTDECK_AGENT_LOOP_TCP_PORT=<ephemeral> \
  node tools/t-p1-02-harness/run.mjs --host-only --out evidence/t-p1-02/host-only.json   # exit 0
PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND=node ... node tools/t-p1-02-harness/host.mjs        # exit 1
node tools/t-p1-02-harness/run.mjs --bin /no/such/pilotdeck-agent-loop-missing           # exit 1
node tools/t-p1-02-harness/run.mjs --fail-host                                           # exit 1
# SIGINT to run.mjs after rust --listen appears                                         # exit 130
pgrep -f 'pilotdeck-agent-loop --listen'   # before/after each run
```

## Results

| Run | Exit | hello | execute | status | terminal | pgrep before→after |
| --- | ---: | --- | --- | --- | --- | --- |
| harness-1 | 0 | ok | accepted | running + identities | completed + result fields | 0→0 |
| harness | 0 | ok | accepted | running + identities | completed + result fields | 0→0 |
| host-only | 0 | ok | accepted | running + identities | completed + result fields | 1→1 (external listener) |
| SIDECAR_COMMAND set | 1 | host refused spawn | | | | 0→0 |
| bad `--bin` | 1 | spawn ENOENT | | | | 0→0 |
| `--fail-host` | 1 | forced host error after listen | | | | 0→0 |
| SIGINT mid-run | 130 | rust seen (mid=1) then reaped | | | | 0→0 |

Host env on successful runs:

- `PILOTDECK_AGENT_LOOP_TRANSPORT=tcp`
- `PILOTDECK_AGENT_LOOP_TCP_HOST=127.0.0.1`
- `PILOTDECK_AGENT_LOOP_TCP_PORT=<ephemeral>`
- `SIDECAR_COMMAND` / `SIDECAR_PATH` unset

The host **mirrors** `createTcpAgentLoopSidecarConnectionFactory` (`AgentLoopDeploymentProfile.ts:84-93`) with `createConnection` + `setNoDelay`. It does not import or call the factory (`connectFactoryUsed: false`).

Status asserts `payload.{runId,operationId,requestIds,cancelRequested,state}` (running without outcome, or completed with `outcome=completed`). Terminal asserts `eventType=agent.execute.completed`, `outcome=completed`, and `result.{type,sessionId,turnId,stopReason,turns,startedAt,completedAt}`.

## Leak gates (G8 / G9)

See `leak-summary.json` and `leak-*-before.txt` / `leak-*-after.txt`. SIGINT mid-run snapshot: `leak-sigint-mid.txt` (`mid_count=1`).

## Scope

- `tools/t-p1-02-harness/`, `evidence/t-p1-02/`
- `src/`, `ui/`, `packages/`, `protocol.ts`, crate TCP implementation: unchanged
- Not done: T-P1-03/04/07, real model, resume/ack, protocol change
