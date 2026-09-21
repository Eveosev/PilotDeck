# StaffDeck Frontend Acceptance Evidence

This record distinguishes browser/component integration from real service
operations. It was produced against the local formal profile on 2026-09-22.

## Current G0-G7 Gate Status

This is the authoritative frontend status for the current working trees
(`StaffDeck 8fcb96fd`, `PilotDeck cb2d2627`, and adapter/evidence commit
`052033a7`). A build or source
inspection is not treated as proof of a real service workflow.

| Gate | Status | Evidence / limitation |
| --- | --- | --- |
| G0 scope and traceability | PASS (static) | Formal source map, host adapters, vendor snapshot, module profile, and the two commit IDs are recorded in `STAFFDECK_FORMAL_REUSE_AUDIT.md`. |
| G1 actual formal UI sharing | PARTIAL | Knowledge, Skills, and the formal Distill editor are shared from `@staffdeck/business-ui`; PilotDeck browser evidence is complete for the Distill route, but a fresh StaffDeck host browser rerun is still missing. |
| G2 generic glue/service boundary | PASS (static) | Shared pages call generic host APIs; PilotDeck adapters map module clients and route navigation; vendor check passes. |
| G3 seven-slot/profile assembly | PASS (static) | Generated module profile includes Knowledge and SOP pages plus optional `/knowledge/new`; typecheck/build and composition tests pass. Runtime profile matrix was not rerun in this turn. |
| G4 Knowledge persistence loop | PARTIAL/PASS | Owner and Gateway lifecycle evidence remains PASS. This turn also verified the formal PilotDeck Knowledge page, isolated document upload task creation, seeded document/card/search/citation rendering; the uploaded README job remained queued while the Gateway was restarting. |
| G5 SOP edit/publish/run/reload | PARTIAL | PilotDeck public-management mode loaded a three-node/two-edge draft, changed name/description in the formal Distill editor, saved `1.1.0`, refreshed with all nodes/edges/conditions/retry fields intact, published from `/sop`, and verified `list` plus `list_versions` through the public API. A stale ETag write returned `412 ETAG_MISMATCH`. Ordinary JWT-mode browser evidence, StaffDeck-host editing, and a new runtime consuming the published definition remain missing; AI streaming still reports an explicit unavailable error. |
| G6 dual-host regression/reproducible delivery | PASS (build/static) | StaffDeck production build and focused Distill tests pass; PilotDeck typecheck/build, module tests, vendor snapshot, and formal profile build pass. Browser evidence is recorded for PilotDeck; StaffDeck browser rerun remains outside this turn. |
| G7 independent supervision evidence | NOT RUN | No independent supervisor session has rerun G0-G6 for this working tree. |

The implementation must not be marked complete while G1/G5/G7 remain partial or
blocked. The commands used for the passing static checks are listed below.

## Knowledge: Real Isolated Lifecycle

The PilotDeck facade at `http://localhost:13121/api/modules/knowledge/call`
was used with a uniquely named temporary knowledge base. The acceptance run:

1. called `create_base`;
2. called `import_document` and polled `get_job` plus `list_documents` until
   the job was `succeeded` and the document was `ready`;
3. called `update_document`, then `get_document` and verified the updated
   title was returned;
4. called `query` scoped to that base and received one evidence chunk;
5. called `resolve_citation` for that chunk; and
6. called `delete_base` in a `finally` block.

Observed values from the completed run:

| Check | Evidence |
| --- | --- |
| Temporary base | `kb_22ee86ded9a84478` (cleaned) |
| Import job | `succeeded` |
| Document | `ready` |
| Update/readback | `Acceptance document updated` |
| Query | one evidence chunk |
| Citation | `kchunk_ac88b2807d424426` |

## Knowledge: Real Structure Editing

A second, separately created temporary base completed ingestion and then used
the extracted structure operations:

| Check | Evidence |
| --- | --- |
| Temporary base | `kb_90d75aa358cb4b02` (cleaned) |
| Import job | `succeeded` |
| Bucket update/read | title `Acceptance bucket` |
| Chunk update/read | summary `Updated chunk summary` and content `Updated cedar-47 chunk content` |

This run used `list_document_buckets`, `update_bucket`, `list_bucket_chunks`,
and `update_chunk` through the same PilotDeck facade.

The browser at `http://localhost:15121/knowledge` was also inspected in
Chinese. It rendered real seeded StaffDeck bases, document state, search, and
the extracted lifecycle/job/structure/OKF/discovery panels.

## SOP: Browser Evidence

Portable SOP definitions were exercised through the local definition facade and
Gateway lifecycle. The formal browser path was then verified at `/sop` and
`/sop/distill?skill_id=operator_approval`: source view opened, name and
description changed, draft version `1.1.0` saved, reload preserved the updated
fields and original node, and the plaza reflected the updated name/version.

The public-management adapter was additionally exercised against an isolated
StaffDeck public API app. Its `drafts` response was loaded by stable `sop_id`,
the formal editor saved the complex `acceptance_complex` graph as version
`1.1.0`, and refresh preserved all three nodes, both conditions, capability
references, and the review retry policy. The SOP list page published the draft;
the public API then returned it in `data` and exposed it through
`list_versions`. A stale `If-Match` write returned `412 ETAG_MISMATCH` and the
original content was restored. This was a server-side public API validation,
not ordinary JWT-mode evidence, and it does not replace a StaffDeck-host
browser run or runtime-consumption proof. AI generation through the portable
Distill host intentionally returns an explicit unavailable error until a
streaming provider is supplied.

## Focused Verification

```sh
env -u NODE_OPTIONS -u npm_config_node_options \
  PATH=/Users/a1/.nvm/versions/node/v22.22.0/bin:$PATH \
  pnpm --dir ui run typecheck

env -u NODE_OPTIONS -u npm_config_node_options \
  PATH=/Users/a1/.nvm/versions/node/v22.22.0/bin:$PATH \
  pnpm --dir ui exec vitest run src/composition/consumption.test.tsx server/routes/modules.test.js

env -u NODE_OPTIONS -u npm_config_node_options \
  PATH=/Users/a1/.nvm/versions/node/v22.22.0/bin:$PATH \
  node --test scripts/generate-frontend-modules.test.mjs
```
