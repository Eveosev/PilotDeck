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
