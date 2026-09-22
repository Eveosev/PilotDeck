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
env -u NODE_OPTIONS /Users/a1/.nvm/versions/node/v22.13.1/bin/node scripts/g4-knowledge-browser.mjs
```

The focused route and adapter suites passed with 32 tests. The real browser runner also passed against isolated StaffDeck Knowledge, PilotDeck Vite/API, and gateway services: upload and ingest completed, the persisted base was reopened, document content was edited and saved through the UI, the page was reloaded and the unchanged field was verified, and query plus citation resolution returned HTTP 200. The run used Node `22.13.1` with `NODE_OPTIONS` cleared.

The captured report is `test-results/g4-knowledge-browser/report.json`, the screenshot is `test-results/g4-knowledge-browser/g4-knowledge-browser.png`, and cleanup status is `test-results/g4-knowledge-browser/cleanup.json`.

## Limits

No credentials, database dumps, or running service output are committed. The browser runner uses an isolated temporary SQLite database and a local smoke model configuration; model responses are not used to establish Knowledge persistence. The StaffDeck service, its seed data, and the module transport are real for this acceptance run.
