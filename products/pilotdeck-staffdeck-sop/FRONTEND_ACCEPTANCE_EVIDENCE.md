# StaffDeck Frontend Acceptance Evidence

This record distinguishes browser/component integration from real service
operations. It was produced against the local formal profile on 2026-09-21.

## Current G0-G7 Gate Status

This is the authoritative frontend status for the current committed working
trees (`StaffDeck e755aaa4`, `PilotDeck 24b130f9`). A build or source
inspection is not treated as proof of a real service workflow.

| Gate | Status | Evidence / limitation |
| --- | --- | --- |
| G0 scope and traceability | PASS (static) | Formal source map, host adapters, vendor snapshot, module profile, and the two commit IDs are recorded in `STAFFDECK_FORMAL_REUSE_AUDIT.md`. |
| G1 actual formal UI sharing | PARTIAL | Knowledge and Skills list/lifecycle pages are shared from the StaffDeck source; the original Distill editor is not yet extracted, so full SOP editing is not claimed. |
| G2 generic glue/service boundary | PASS (static) | Shared pages call generic host APIs; PilotDeck adapters map module clients and route navigation; vendor check passes. |
| G3 seven-slot/profile assembly | PASS (static) | Generated module profile includes Knowledge and SOP pages plus optional `/knowledge/new`; typecheck/build and composition tests pass. Runtime profile matrix was not rerun in this turn. |
| G4 Knowledge persistence loop | PARTIAL/PASS | Owner and Gateway lifecycle evidence remains PASS. This turn also verified the formal PilotDeck Knowledge page, isolated document upload task creation, seeded document/card/search/citation rendering; the uploaded README job remained queued while the Gateway was restarting. |
| G5 SOP edit/publish/run/reload | PARTIAL | Formal Distill source/flow editor loads. PilotDeck UI edited `operator_approval`, saved version `1.1.0`, refreshed the editor, and verified the SOP plaza shows the new name/version while preserving the approval node. Public StaffDeck `sops:*` management and AI streaming remain unconfigured. |
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

The full StaffDeck public draft/create/validate/publish/archive/version/rollback
API is still not configured in this local formal profile. AI generation through
the portable Distill host intentionally returns an explicit unavailable error
until a streaming provider is supplied.

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
