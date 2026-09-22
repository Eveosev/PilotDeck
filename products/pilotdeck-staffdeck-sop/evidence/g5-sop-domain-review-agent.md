# G5 SOP Domain Review

This evidence belongs to the isolated PilotDeck worktree created for the G5
domain task.

## Baseline

- Source: `PilotDeck-frontend-seven-slot`
- Branch: `codex/g5-sop-agent-pd`
- Commit: `9f66017139d017239929b304331bfba01992cb5a`
- Worktree: `/Users/a1/Desktop/claw/openbmb/PilotDeck-g5-sop-agent`
- PilotDeck accesses SOP management and runtime through host adapters and the
  explicit StaffDeck protocol; it does not import StaffDeck backend modules.

## Reviewed Contracts

- `ui/server/routes/sop.js` maps status/resume errors and never treats an
  unavailable Gateway as a successful reload.
- `ui/src/composition/modules/staffdeck/vendor/SkillsPage.tsx` and
  `DistillPage.tsx` consume the shared formal UI; host glue supplies the
  management client and capability state.
- `tests/sop/staffdeck-sop-agent-loop.spec.ts` and
  `tests/sop/staffdeck-sop-gateway-http-e2e.spec.ts` cover wait/resume,
  handoff/external-task continuation, stale revisions, duplicate request IDs,
  and terminal completion over the explicit Gateway boundary.

## Focused Verification

The intended rerun is:

```sh
cd /Users/a1/Desktop/claw/openbmb/PilotDeck-g5-sop-agent
env -u NODE_OPTIONS -u npm_config_node_options \
  PATH=/Users/a1/.nvm/versions/node/v22.22.0/bin:$PATH \
  pnpm exec vitest run tests/sop/staffdeck-sop-definitions.spec.ts \
    tests/sop/staffdeck-sop-agent-loop.spec.ts \
    tests/sop/staffdeck-sop-client.spec.ts
```

Result in this fresh worktree: **BLOCKED by environment**. The worktree has no
installed Node dependencies (`vitest` was not found). The command also avoids
the inherited invalid `NODE_OPTIONS` preload path.

No local YAML fallback was used as a management publish proof, and no runtime
state or database event was fabricated by this task.

## Follow-up Runtime Evidence

After installing the lockfile with Node 22.22.0, the isolated StaffDeck
portable runtime was started on `127.0.0.1:16200` with a temporary SQLite file,
`APP_SECRET=g5-local-secret-16200`, and the isolated Python environment. The
real PilotDeck Gateway tests then consumed that service through
`sop.lifecycle/v2`:

```text
test:sop:core                 30 passed
test:sop:http-e2e             10 passed, 0 skipped
process-restart-sop-resume   status=passed, sopStatus=completed, duplicate=true
```

The restart smoke proves a new PilotDeck process reloads the persisted SOP
session state, resumes the same handoff once, and deduplicates the repeated
resume request. The HTTP matrix also covered disabled composition, handoff and
external waits, stale/concurrent state, malformed responses, HTTP 500, and
timeouts. The service and temporary database were stopped/removed after the
run.
