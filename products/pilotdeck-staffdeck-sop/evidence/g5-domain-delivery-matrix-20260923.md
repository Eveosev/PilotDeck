# G5 SOP Domain Delivery Matrix (2026-09-23)

This checklist is the scoped domain review after the generic transition-context
fix. It is evidence inventory, not independent acceptance. The fixed refs are
PilotDeck `5f5433afd4bc2a9211efaf2565b4307a0cd513a2` and StaffDeck
`5e07316ad7f1703683d62ed06bb9b69a64e31810`.

Focused PilotDeck verification after the fix:

```text
pnpm run build
node --test --test-force-exit \
  dist/tests/sop/staffdeck-sop-discovery-routing.spec.js \
  dist/tests/sop/staffdeck-sop-discovery-client.spec.js \
  dist/tests/sop/staffdeck-sop-definitions.spec.js \
  dist/tests/sop/staffdeck-sop-client.spec.js \
  dist/tests/sop/staffdeck-sop-agent-loop.spec.js
```

Result: **34/34 passed**. StaffDeck's native pytest process remains
environment-blocked on this macOS checkout: pytest is not installed in the
available Python environment, and the previously used environment exited 139
during pytest capture initialization before collection. Native source/tests
are cited below but are not relabeled as newly executed passes.

| Domain item | Status | Evidence and fixed refs | Remaining gap / boundary |
| --- | --- | --- | --- |
| 1. Dual-host ordinary entry, including StaffDeck-native reference | **PASS with packaging gap** | PilotDeck ordinary natural entry and full lifecycle: `g5-natural-input-success-20260923.json` and `.summary.json`; StaffDeck native route-only smoke is recorded in `G5_REPRO_RESULT_REPORT_20260923.zh.md` and exercises `POST /api/v1/agents/.../sops:route` against a fresh SQLite with one shared `APP_SECRET`. | The route-only log/database are under `/tmp/g5-minimal-route.rBPHQI`, not a versioned artifact. This is an evidence retention gap, not an observed route failure. |
| 2. Multi-SOP selection | **PASS** | `tests/sop/staffdeck-sop-discovery-routing.spec.ts`: the native discovery test routes `purchase` and `compare`; `g5-natural-input-success-20260923.summary.json` records selection of published `project_delivery_plan@1.0.1`. | PilotDeck's deployed profile uses an explicit default binding; automatic multi-SOP discovery is covered by the native discovery test, not claimed for that profile. |
| 3. No-match routing | **PASS** | The same discovery-routing test asserts an ordinary turn with no selected SOP and confirms no SOP tool/prompt injection. | No additional gap identified for the declared routing contract. |
| 4. SOP disabled / not installed | **PARTIAL** | `tests/sop/staffdeck-sop-gateway-http-e2e.spec.ts` covers disabled composition (`SOP_MODULE_DISABLED`) and required capability absence before model dispatch; `tests/sop/staffdeck-sop-agent-loop.spec.ts` covers `SOP_REQUIRED_TOOL_UNAVAILABLE`. | No dedicated end-to-end case currently asserts a missing published definition/default SOP. Existing malformed/duplicate definition coverage is in `staffdeck-sop-definitions.spec.ts`. |
| 5. Unauthorized or out-of-scope access | **PASS** | Invisible requested selection is rejected by `staffdeck-sop-discovery-routing.spec.ts`. StaffDeck native owner tests cover `PermissionDenied`, foreign-tenant assignment, and SOP runtime cross-tenant guards in `backend/tests_harness/test_handoff_core.py`, `backend/tests_harness/modules/test_sop_runtime.py`, and `backend/tests_harness/test_security_profiles.py`. | Native pytest execution is not available in this environment; source-level test references are retained for independent execution. |
| 6. Discovery failure modes | **PARTIAL** | PilotDeck client tests cover semantic rejection, retryability, timeout, cancellation, malformed envelopes, and authenticated request shape (`staffdeck-sop-client.spec.ts`, `staffdeck-sop-discovery-client.spec.ts`). Connection-refused and non-responsive timeout probes are described in `G5_REPRO_RESULT_REPORT_20260923.zh.md`. | The refused/timeout probe JSONs remain under `/tmp/g5-fetch-refused-trace-20260923.json` and `/tmp/g5-fetch-timeout-trace-20260923.json`; they should be copied into versioned evidence before independent acceptance. |
| 7. Conditional branch behavior | **PASS** | Published graph contains `scope_changed`, `no_scope_change`, and `confirmation_received`; ordinary success summary records `build_plan -> confirm_scope -> finalize_plan`, handoff wait, reload-preserved wait, resume, duplicate replay, and terminal completion. The adapter preserves transition condition/priority/label/target context at StaffDeck ref `5e07316ad7f1703683d62ed06bb9b69a64e31810`; PilotDeck guidance is at ref `5f5433afd4bc2a9211efaf2565b4307a0cd513a2`. | No hardcoded `project_delivery_plan` branch was added. |
| 8. New publish followed by new run | **PASS** | Page-published objects and lineage are retained in `g5-pilotdeck-page-published-1.2.1.json`, `g5-pilotdeck-postfix-page-published-1.1.1.json`, and `g5-sop-version-lineage.md`; exact published-object replay and real configured-model replay are recorded by `g5-agentloop-real-config-1.2.1.json`. | Earlier guided replays remain auxiliary; the ordinary post-fix `1.0.1` run is the primary natural-entry proof. |
| 9. Existing run preserves old definition/version after new publish | **PASS** | `staffdeck-sop-agent-loop.spec.ts` test “SOP state keeps the session definition snapshot after a deployment definition changes” asserts an existing session keeps the old bundle while a fresh session receives version `2`; `g5-sop-version-lineage.md` records the page-publish/version relationship. | No additional gap identified for the declared snapshot contract. |

## Readiness

The implementation and ordinary natural-entry scenario are ready for a
separate independent acceptance review. Do not call the G5 domain matrix fully
accepted until the two temporary discovery-failure artifacts and the missing
definition boundary case are either versioned/executed or explicitly waived
by that reviewer.
