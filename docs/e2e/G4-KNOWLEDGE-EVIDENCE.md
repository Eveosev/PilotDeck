# G4 Knowledge Evidence

## Scope and ownership

- PilotDeck isolation: `codex/g4-knowledge-pd` at `9f66017139d017239929b304331bfba01992cb5a`.
- StaffDeck isolation: `codex/g4-knowledge-sd` at `f41c8524bd129bcaea96f4f774d97a931e566636`.
- Formal shared source: `StaffDeck/packages/staffdeck-business-ui` (`@staffdeck/business-ui` `0.1.0`).
- PilotDeck consumes the checked-in vendor snapshot under `ui/src/composition/modules/staffdeck/vendor/`; the vendor check compares `KnowledgePage.tsx`, `KnowledgePageHost.tsx`, and the related shared files byte-for-byte with the SD package.
- StaffDeck production route `frontend-enterprise/src/pages/KnowledgePage.tsx` consumes the same package and supplies only `knowledgePageHost`.

## Protocol coverage

`ui/src/composition/modules/staffdeck/vendor/knowledge-host-adapter.test.tsx` covers the formal page's adapter mapping for base/document CRUD, asynchronous jobs and cancellation, versions and publish/rollback, buckets/chunks, OKF import/export/lint, discoveries, query, and citation resolution. The test also asserts unsupported paths fail instead of silently issuing an unrelated request.

`ui/server/routes/modules.test.js` covers the server-side `staffdeck.knowledge/v1` boundary. Binding `tenantId` and `actorUserId` are trusted identity values: browser-supplied values are overwritten, and missing binding identity returns `MODULE_IDENTITY_UNAVAILABLE`. Knowledge writes are rejected with `MODULE_ADMIN_REQUIRED` when `PILOTDECK_MODULE_ADMIN=0`; reads remain available.

## Real persistence path

The existing real-owner E2E in `tests/composition/real-staffdeck-seven-slot-e2e.spec.ts` starts an isolated StaffDeck Knowledge service with an isolated SQLite database, creates a base, imports a document, polls the durable ingest job to completion, queries, resolves a citation, edits a document, refreshes it from storage, and verifies unchanged fields plus citation source retention. It also exercises failed import response handling and cancellation through the protocol proxy. It is the real persistence evidence; mock model fixtures are only used for the surrounding AgentLoop turn.

## Reproduction

From the PD worktree, install the declared workspace dependencies, then run:

```sh
env -u NODE_OPTIONS pnpm exec vitest run ui/src/composition/modules/staffdeck/vendor/knowledge-host-adapter.test.tsx ui/server/routes/modules.test.js
env -u NODE_OPTIONS pnpm exec vitest run tests/composition/real-staffdeck-seven-slot-e2e.spec.ts
env -u NODE_OPTIONS node scripts/verify-staffdeck-business-ui-vendor.mjs
```

At evidence capture time this checkout had no installed workspace `vitest` binary and the ambient `NODE_OPTIONS` referenced the missing `/Users/a1/.openclaw/proxy-preload.mjs`; those commands were therefore not executed successfully here. `node --check ui/server/routes/modules.js` and `git diff --check` remain environment-independent checks.

## Limits

No credentials, database dumps, or running service output are committed. A supervisor must rerun the browser actions against both real hosts on ports in `16100-16129`; API-only results do not substitute for that UI acceptance.
