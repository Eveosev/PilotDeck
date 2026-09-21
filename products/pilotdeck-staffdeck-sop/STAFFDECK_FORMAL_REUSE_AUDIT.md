# StaffDeck Formal UI Reuse Audit

## Source Baseline

| Repository | Branch | Commit |
| --- | --- | --- |
| PilotDeck | `codex/frontend-seven-slot-composition` | `023e3556b6c5a2eb1babc5a9236ba6703731cdd1` (before this delivery) |
| StaffDeck | `codex/delivery-protocol-20260920` | `4305310eecf70472849a81dfab20d7ff84a9fd80` |

The source enterprise pages are not imported wholesale. They depend on the
StaffDeck enterprise router, employee-scope storage, enterprise authentication,
the Toast provider, aliases, and direct `/api/enterprise/*` requests. Current
PilotDeck workspaces are **source-logic adaptations**, not shared source page
components. The next extraction boundary is a StaffDeck-owned reusable
component package, starting with the independent Knowledge graph component;
the public module client replaces only host auth/routing concerns.

## Reused Source Files

| Source | Reuse status and responsibility | PilotDeck destination |
| --- | --- | --- |
| `frontend-enterprise/src/pages/KnowledgePage.tsx` | StaffDeck remains the formal source; faithful full-page extraction is pending. Only the graph slice is currently shared. | `frontend-enterprise/src/pages/KnowledgePage.tsx` (source), `packages/staffdeck-business-ui/src/KnowledgeGraphCanvas.tsx` (shared slice) |
| `frontend-enterprise/src/components/KnowledgeGraphCanvas.tsx` | Production Knowledge route now imports the versioned shared package directly; no sibling checkout is required by PilotDeck | `packages/staffdeck-business-ui/src/KnowledgeGraphCanvas.tsx`, PilotDeck vendor snapshot |
| `frontend-enterprise/src/pages/SkillsPage.tsx` | StaffDeck formal page remains the source; the version-detail dialog is extracted faithfully, while the editor and lifecycle controls remain in the formal page. | `frontend-enterprise/src/pages/SkillsPage.tsx`, `packages/staffdeck-business-ui/src/SopVersionDetailDialog.tsx` |
| `frontend-enterprise/src/types/index.ts` | normalized record shapes for the shared public view models | `packages/staffdeck-business-ui/src/types.ts` |
| `backend/app/api/module_knowledge.py` | supported `staffdeck.knowledge/v1` operations and input shape | `ui/server/routes/modules.js`, `ui/src/composition/modules/staffdeck/clients.ts` |
| `backend/app/public_api/sops.py` | authoritative draft/ETag/publish/version management contract | SOP management adapter design; not substituted with the runtime lifecycle contract |

## Capability Matrix

Status meanings: **protocol** = module service exposes the operation;
**surface** = the extracted module presents it; **verified** = isolated real
operation evidence is recorded by the acceptance run.

| Area | Source operation | Module operation / transport | PilotDeck surface | Status |
| --- | --- | --- | --- | --- |
| Knowledge bases | list/create/update/delete | `list_bases`, `create_base`, `update_base`, `delete_base` | base list and details | surface; verification pending |
| Documents | list/read/import/update/archive | `list_documents`, `get_document`, `import_document`, `update_document`, `delete_document` | document editor | surface; verification pending |
| Version lifecycle | list/sync/promote/rollback | `list_versions`, `sync_base`, `publish_version`, `rollback_version` | formal lifecycle panel | surface; verification pending |
| Ingestion | list/get/cancel | `list_jobs`, `get_job`, `cancel_job` | jobs panel | surface; verification pending |
| Structure | list/update bucket and chunk | `list_document_buckets`, `update_bucket`, `list_bucket_chunks`, `update_chunk` | structure editor | surface; real isolated update/readback verified |
| OKF / graph | list/read/upsert/export/lint | `list_okf_concepts`, `get_okf_concept`, `upsert_okf_concept`, `export_okf`, `lint_okf` | OKF panel; canvas remains StaffDeck-only | surface; verification pending |
| Discoveries | list/confirm/reject | `list_discoveries`, `confirm_discovery`, `reject_discovery` | discovery panel | surface; verification pending |
| Retrieval | query/citation resolve | `query`, `resolve_citation` | search and citation inspector | surface; verification pending |
| SOP runtime | prepare/submit/status/resume | `sop.lifecycle/v2` through Gateway | chat wait, approval and resume | surface; verification pending |
| SOP management | draft/create/copy/validate/publish/archive/version/rollback | StaffDeck public SOP API | Original StaffDeck editor remains in place; only the formal version-detail dialog is shared | G1 FAIL / partial slice only |

Real Knowledge lifecycle evidence is recorded in `FRONTEND_ACCEPTANCE_EVIDENCE.md`.

## Boundaries And Follow-up

`staffdeck.knowledge/v1` accepts the explicit `tenantId`, `actorUserId`, and
optionally `agentId` values required by StaffDeck. PilotDeck injects the first
two from the selected profile; branch promotion and rollback require an agent
scope provided by the operator. Those actions are presented as unavailable
until that value is supplied.

SOP YAML management belongs to the current portable deployment and is not
equivalent to StaffDeck's public draft/publish API. The latter has scoped
credentials and ETag concurrency semantics. No replacement management panel
is claimed in this release. The shared SOP slice is limited to the original
version-detail dialog; draft/publish management remains in the StaffDeck
formal page and its explicit service adapter. The previous hand-written
`SopManagement` and `KnowledgeOperations` replacement panels were removed from
both hosts and are not part of the reuse claim.

## SOP Public Management Binding

The binding is optional. Omit it for portable SOP deployments; no formal
management panel is mounted. A deployment with StaffDeck's `/api/v1` public
API can configure it as follows (the API key must be injected by deployment
secret management, never committed):

```yaml
modules:
  sop:
    management:
      enabled: true
      endpoint: https://staffdeck.example/api/v1
      apiKeyEnv: STAFFDECK_SOP_PUBLIC_API_KEY
      agentId: employee-agent-id
      methods: [list, create, get_draft, replace_draft, validate, publish, archive, list_versions, get_version, rollback]
```

The public key must carry the corresponding `sops:read`, `sops:write`, and
`sops:publish` scopes. The facade forwards `If-Match` only for draft
replacement and never serializes the endpoint or key into generated frontend
code.

The source code remains attributed above. Extracted files contain no imports
from a sibling checkout and use only declared PilotDeck dependencies.

### Versioned Shared Package: `KnowledgeGraphCanvas`

The source file is published from StaffDeck commit
`4305310eecf70472849a81dfab20d7ff84a9fd80`. The package owns its public
`KnowledgeConceptRead` type and CSS alongside the canvas; the PilotDeck copy is
an exact vendor snapshot of the package release. The wrapper maps
module-client concept records into this public shape and handles selected
concept state. It contains no graph business logic.
