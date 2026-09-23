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

Result: **35/35 passed**. StaffDeck's focused native permission/scope suite was
also executed in its isolated environment; the native AgentLoop parity entry
remains separately blocked by the unavailable Harness v3 build.

| Domain item | Status | Evidence and fixed refs | Remaining gap / boundary |
| --- | --- | --- | --- |
| 1. Dual-host ordinary entry, including StaffDeck-native reference | **PD PASS; SD route-only PASS; native AgentLoop BLOCKED** | PilotDeck ordinary natural entry and full lifecycle: `g5-natural-input-success-20260923.json` and `.summary.json`. StaffDeck route-only smoke is recorded in `G5_REPRO_RESULT_REPORT_20260923.zh.md` and exercises `POST /api/v1/agents/.../sops:route` against a fresh SQLite with one shared `APP_SECRET`. The native entry boundary is explicitly recorded in `g5-staffdeck-native-entry-status-20260923.json`. | Native StaffDeck selection/execution/wait/resume was not run: `AgentLoop.handle_turn` reaches `HarnessV3Engine -> HarnessV3Runtime`, but `apps/cli/lib/bin.js` is unavailable. The route-only log/database remain under `/tmp/g5-minimal-route.rBPHQI`, not a versioned artifact. |
| 2. Multi-SOP selection | **PASS (controlled/mock routing)** | `tests/sop/staffdeck-sop-discovery-routing.spec.ts` overrides `globalThis.fetch` and asserts `purchase`/`compare`; classify this as controlled/mock transport. `g5-natural-input-success-20260923.summary.json` separately records real-provider selection of published `project_delivery_plan@1.0.1`. | PilotDeck's deployed profile uses an explicit default binding; this test is not native discovery evidence. |
| 3. No-match routing | **PASS** | The same discovery-routing test asserts an ordinary turn with no selected SOP and confirms no SOP tool/prompt injection. | No additional gap identified for the declared routing contract. |
| 4. SOP disabled / not installed | **PASS for declared boundary** | `tests/sop/staffdeck-sop-gateway-http-e2e.spec.ts` covers disabled composition (`SOP_MODULE_DISABLED`) and required capability absence before model dispatch; `tests/sop/staffdeck-sop-agent-loop.spec.ts` covers `SOP_REQUIRED_TOOL_UNAVAILABLE`; `staffdeck-sop-definitions.spec.ts` now covers missing definition file and absent default binding. | This is a focused boundary, not a native AgentLoop execution claim. |
| 5. Unauthorized or out-of-scope access | **PASS; native tests executed** | Invisible requested selection is rejected by `staffdeck-sop-discovery-routing.spec.ts`. Native owner tests cover `PermissionDenied`, foreign-tenant assignment, SOP runtime cross-tenant guards, and capability isolation. Focused command from `/Users/a1/Desktop/claw/openbmb/StaffDeck-g5-sop-agent`: `backend/.venv/bin/python -m pytest -p no:capture backend/tests_harness/test_handoff_core.py backend/tests_harness/test_security_profiles.py backend/tests_harness/test_sop_capability_isolation.py backend/tests_harness/modules/test_sop_runtime.py backend/tests_harness/modules/test_sop_definition.py` (**55 passed** in the current isolated run). | This validates native permission/scope and definition tests; it does not unblock the separate Harness v3 AgentLoop entry. |
| 6. Discovery failure modes | **PASS for captured probes** | PilotDeck client tests cover semantic rejection, retryability, timeout, cancellation, malformed envelopes, and authenticated request shape (`staffdeck-sop-client.spec.ts`, `staffdeck-sop-discovery-client.spec.ts`). Versioned real-provider probes are `g5-discovery-refused-20260923.json` and `g5-discovery-timeout-20260923.json`. | These are failure-mode probes, not a successful native AgentLoop discovery run. |
| 7. Conditional branch behavior | **PARTIAL** | `g5-natural-input-success-20260923.summary.json` covers `scope_changed` and `confirmation_received` with handoff wait, reload-preserved wait, resume, duplicate replay, and terminal completion. `g5-no-change-controlled-20260923.json` covers `build_plan -> finalize_plan` on `no_scope_change` using a controlled scripted model. | No natural/real-model `no_scope_change` execution is evidenced. The adapter preserves transition condition/priority/label/target context at StaffDeck ref `5e07316ad7f1703683d62ed06bb9b69a64e31810`; PilotDeck guidance is at ref `5f5433afd4bc2a9211efaf2565b4307a0cd513a2`. |
| 8. New publish followed by new run | **PASS** | Page-published objects and lineage are retained in `g5-pilotdeck-page-published-1.2.1.json`, `g5-pilotdeck-postfix-page-published-1.1.1.json`, and `g5-sop-version-lineage.md`; exact published-object replay and real configured-model replay are recorded by `g5-agentloop-real-config-1.2.1.json`. | Earlier guided replays remain auxiliary; the ordinary post-fix `1.0.1` run is the primary natural-entry proof. |
| 9. Existing run preserves old definition/version after new publish | **PASS** | `staffdeck-sop-agent-loop.spec.ts` test “SOP state keeps the session definition snapshot after a deployment definition changes” asserts an existing session keeps the old bundle while a fresh session receives version `2`; `g5-sop-version-lineage.md` records the page-publish/version relationship. | No additional gap identified for the declared snapshot contract. |

## Readiness

The implementation and ordinary natural-entry scenario are ready for continued
implementation review. Do not call the G5 domain matrix fully accepted: native
StaffDeck AgentLoop execution is blocked by the unavailable Harness v3 build,
and the no-change branch currently has controlled evidence only.
