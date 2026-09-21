# StaffDeck Frontend Acceptance Evidence

This record distinguishes browser/component integration from real service
operations. It was produced against the local formal profile on 2026-09-22.

## Current G0-G7 Gate Status

This is the authoritative frontend status for the current working trees
(`StaffDeck 8fcb96fd` plus `e755aaa4`, `PilotDeck 0587b2b0`, and the
PilotDeck shared-composition commits through `cb2d2627`). A build or source
inspection is not treated as proof of a real service workflow.

| Gate | Status | Evidence / limitation |
| --- | --- | --- |
| G0 scope and traceability | FAIL | The source map and commit IDs are recorded, but the PilotDeck implementation and evidence changes remain uncommitted; there is no final reviewable revision yet. |
| G1 actual formal UI sharing | PASS | PilotDeck-hosted formal browser checks mount the shared StaffDeck Knowledge/SOP modules, and an independent StaffDeck-native host run at `http://127.0.0.1:15217` rendered `/enterprise/skills` and `/enterprise/knowledge` from the same shared build. The native run used an authenticated admin session and captured desktop screenshots under `/tmp/staffdeck-native-enterprise-skills.png` and `/tmp/staffdeck-native-enterprise-knowledge.png`; the observed API requests (`/api/enterprise/skills`, `/api/enterprise/knowledge-bases`, `/api/enterprise/knowledge/documents`, and `/api/enterprise/knowledge-bases/:id/okf/concepts`) all carried the JWT. |
| G2 generic glue/service boundary | PASS | The Knowledge adapter covers job polling, document deletion, sync/publish/rollback, and the focused adapter tests pass. The SOP adapter uses explicit management calls and reports unavailable host capabilities instead of falling back silently. |
| G3 seven-slot/profile assembly | NOT RUN | Generator/typecheck/build checks pass, and authenticated native/minimal route matrices passed at desktop and mobile viewports. The required complete independent profile/network matrix has not been rerun. |
| G4 Knowledge persistence loop | NOT RUN | The PilotDeck isolated lifecycle and formal shared UI cover query plus evidence-pack/source presentation. The independent StaffDeck-native host also completed a real create/import/poll/update/query/delete loop (`kb_92f4d04c4571478d`, job `kjob_92517a5b00734b5c`, document `kdoc_a44e4138cd3e4f60`; job `succeeded`, document `ready`, one evidence chunk and one evidence-pack item), but the required same-definition double-host page persistence loop is not closed; citation resolution remains a direct API contract check, not a claimed shared-page button flow. |
| G5 SOP edit/publish/run/reload | NOT RUN | Portable-definition persistence, public-management lifecycle API behavior, and isolated StaffDeck runtime consumption are recorded. The required same-definition dual-host publish/reload/run proof is not closed. |
| G6 dual-host regression/reproducible delivery | NOT RUN | Frozen-lockfile install, focused builds/tests, and the StaffDeck host i18n check pass. Shared Knowledge/SOP pages still contain hardcoded Chinese strings and lack independent English-browser coverage, so reproducible bilingual dual-host regression is not closed. |
| G7 independent supervision evidence | NOT RUN | Do not mark this gate complete until the independent supervisor reruns G0-G6 against the final worktrees. |

The implementation must not be marked complete while G7 remains `NOT RUN`. The
commands used for the passing static checks are listed below.

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
the extracted lifecycle/job/structure/OKF/discovery panels. Its evidence-pack
and source presentation is UI evidence. `resolve_citation` above is instead a
direct PilotDeck API contract check; the shared page currently does not expose
the old English `Resolve citation` click action.

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

## SOP: StaffDeck Runtime Consumption

The StaffDeck formal page was exercised on the isolated acceptance service at
`http://127.0.0.1:5174` with Harness v3 and a local OpenAI-compatible model
fixture. The browser submitted `请按经营指标分析框架处理本月转化率问题` in a
fresh session after the SOP had been published. The durable event log recorded:

| Check | Evidence |
| --- | --- |
| Session | `session_0698f95a84523f40` |
| Skill/version binding | `skill_started`: `business_metric_analysis`, version `1.0.0`, first step `n1_collect` |
| Frame completion | `task_frame_finished`: `kind=sop`, `skill_id=business_metric_analysis`, status `awaiting_user`, action count `1` |
| Reply | `mock runtime consumed the published SOP definition; please confirm the analysis period.` |

The same flow was also observed advancing to `n2_framework` in
`session_b5ba8189ef677ee6`. This is a local acceptance fixture, not a claim
that an external provider was available; the fixture and isolated database
were removed after evidence capture.

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

## Browser Profile Checks

The StaffDeck-native host was independently started with the repository's existing
built Harness v3 checkout (`deepseek-harness-dsh-v0.1.2-alpha.2`) and a temporary
SQLite database. With an authenticated `tenant_demo/admin` session, the shared
pages rendered at `/enterprise/skills` and `/enterprise/knowledge` in both the
default Chinese locale and an `en-US` browser context. The English capture still
shows several hardcoded Chinese business labels inside the shared pages, which is
why G6 remains `NOT RUN`.

The native host's Knowledge API persistence probe created a temporary base,
uploaded and polled a Markdown document to `succeeded`/`ready`, updated the title,
queried one evidence chunk, and deleted the base in cleanup. The temporary base
and all generated records were removed before shutdown.

The local formal-host suite passed 6/6 at desktop and mobile viewports. Those
are PilotDeck-hosted checks of the shared StaffDeck modules, not a second
StaffDeck-native-host execution. The replacement runtime was started as an
independent process and observed its profile-owned `resultLimit: 3`.

After the adapter and authentication fixes, the authenticated route matrices
were rerun against direct Vite origins (the Express development server
redirects browser routes to Vite):

```sh
# formal-native: PilotDeck Skills present; SOP and Knowledge absent
FORMAL_ROUTE_PROFILE=native FORMAL_ROUTE_AUTH=1 \
FORMAL_COMPOSITION_URL=http://localhost:15118 \
pnpm --dir ui exec playwright test e2e/formal-route-matrix.spec.mjs \
  --config=e2e/formal-composition.config.mjs

# formal-minimal: Skills, SOP, and Knowledge absent
FORMAL_ROUTE_PROFILE=minimal FORMAL_ROUTE_AUTH=1 \
FORMAL_COMPOSITION_URL=http://localhost:15128 \
pnpm --dir ui exec playwright test e2e/formal-route-matrix.spec.mjs \
  --config=e2e/formal-composition.config.mjs
```

Each command passed 2/2 (desktop and mobile). The route test fixes the browser
locale to `zh-CN` for shared-page assertions and requires a profile with a
ready smoke model; otherwise the application correctly remains at onboarding.
