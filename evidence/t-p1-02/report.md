# T-P1-02 evidence (R2-m1 + n1–n6 + extended G8)

Collected on clean tree `8046ea2f405820697e51db3977fb66677f71f3d2` (`gitDirty=false`).
Evidence content tip: `cf80abc7e165142e9354b486918a44c8ce6fc009`.
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
| SIGINT mid-run | 130 | rust+host seen (mid=1/1) then reaped in 10ms | | | | 0→0 | 0→0 |
| SIGTERM mid-run | 143 | rust+host seen (mid=1/1) then reaped in 11ms | | | | 0→0 | 0→0 |

Successful runs: `hostPid === host.pid` (no `spawnSync` grandchild). Host env:

- `PILOTDECK_AGENT_LOOP_TRANSPORT=tcp`
- `PILOTDECK_AGENT_LOOP_TCP_HOST=127.0.0.1`
- `PILOTDECK_AGENT_LOOP_TCP_PORT=<ephemeral>`
- `SIDECAR_COMMAND` / `SIDECAR_PATH` unset

## Leak gates (extended G8 / n5)

See `r2m1-leak-summary.json` and `leak-*-{before,mid,after}.txt`.

Both `pgrep -f 'pilotdeck-agent-loop --listen'` and `pgrep -f 't-p1-02-harness/host.mjs'` returned to the pre-run baseline after every run. SIGINT/SIGTERM were sent to the `run.mjs` PID only; both counts were back to baseline within 1s (10ms / 11ms).

## Scope

- `tools/t-p1-02-harness/`, `evidence/t-p1-02/`
- `src/`, `ui/`, `packages/`, `protocol.ts`, crate TCP implementation: unchanged
- Not done: T-P1-03/04/07, real model, resume/ack, protocol change
