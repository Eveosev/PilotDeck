# StaffDeck Frontend Acceptance Evidence

This record distinguishes browser/component integration from real service
operations. It was produced against the local formal profile on 2026-09-21.

## Current G0-G7 Gate Status

This is the authoritative frontend status for the current uncommitted working
trees. A build or source inspection is not treated as proof of a real service
workflow.

| Gate | Status | Evidence / limitation |
| --- | --- | --- |
| G0 scope and traceability | PASS (static) | Formal source map, host adapters, vendor snapshot, and module profile are recorded in `STAFFDECK_FORMAL_REUSE_AUDIT.md`; final commit IDs remain pending until the intended changes are committed. |
| G1 actual formal UI sharing | PARTIAL | Knowledge and Skills list/lifecycle pages are shared from the StaffDeck source; the original Distill editor is not yet extracted, so full SOP editing is not claimed. |
| G2 generic glue/service boundary | PASS (static) | Shared pages call generic host APIs; PilotDeck adapters map module clients and route navigation; vendor check passes. |
| G3 seven-slot/profile assembly | PASS (static) | Generated module profile includes Knowledge and SOP pages plus optional `/knowledge/new`; typecheck/build and composition tests pass. Runtime profile matrix was not rerun in this turn. |
| G4 Knowledge persistence loop | NOT RUN (environment) | No local service was listening on ports `13121` or `15121` during this run. The historical isolated lifecycle below remains prior evidence and is not silently re-attributed to the new adapter changes. |
| G5 SOP edit/publish/run/reload | BLOCKED | No public `sops:*` service/credential is configured, and the shared Skills page still routes editing to the unextracted formal Distill page. |
| G6 dual-host regression/reproducible delivery | PARTIAL | StaffDeck build, PilotDeck typecheck/build, vendor snapshot, and consumption tests pass. Real dual-host browser/persistence rerun is still required. |
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

## SOP: Historical Evidence

Portable SOP definitions continue to be exercised through the local definition
facade and Gateway lifecycle. These results predate the full-page migration and
do not prove the missing formal Distill editor path.

The full StaffDeck draft/create/validate/publish/archive/version/rollback page
is intentionally not claimed as shared. No StaffDeck `/api/v1` service with a
scoped `sops:*` credential is configured in this local formal profile, so no
real public SOP management operation is recorded as passed.

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
