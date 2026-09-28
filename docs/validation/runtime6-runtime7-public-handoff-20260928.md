# runtime-6/runtime-7 public runtime handoff

This handoff preserves the minimum scope and the fresh3/fresh4/fresh5 raw failures. No service or business acceptance was run. SD code delivery is clean `2f1dcd28405976390f423ba3c9b4869a17e86766` (parent `8e476b64464e040e11486994f1703683b83b2576`); the narrow integration diff is only `backend/app/public_api/pilotdeck_domain_host.py` and `backend/tests/test_public_host_sop_route.py`. Apply those hunks to the integrated SD `702063efc0436024e510bcd1a6b98633cba1c3a2`; retain its `pilotdeck_domain_binding.py` and root/authentication changes. Do not replace the root with this owner's earlier base.

## Exact model contract and repair change

PD discovery sends `POST /api/v1/agents/{target}/sops:route`, authenticated by the original account public credential with `sops:read`, and explicit `model_source: "pilotdeck_host"`. SD applies the original principal/agent access and published SOP visibility before the callback. The PD branch never reads `model_for_agent`, an SD model config, or a second provider.

The bound server-only SD client calls authenticated Gateway `POST /api/module-host/call` with `{principal:{pilotDeckUserId,tenantId,actorUserId,agentId},operation,input}`. Root must obtain that principal tuple and bridge token from the existing verified deployment identity; body actor fields alone are not authentication. Integrated `FixedPilotDeckDomainHostClient` rejects tuple mismatches. `list_model_catalog` takes `{}` and returns `{data:[{id:"provider/model",provider,model,available:true}],defaultSelection:{mode:"model",provider,model}}` (or the existing `is_default` projection). This minimum contract requires exactly one available model, matching the default.

`model_stream` input is `{requestId,modelId:"provider/model",request:{provider,model,systemPrompt,messages:[{role:"user"|"assistant",content:[{type:"text",text}]}],stream:true}}`. The same catalog ID is selected for the initial plan and original repair requests. Canonical NDJSON must supply `text_delta.text` and a completed `message_end` with `finishReason:"stop"`; an error or incomplete stream fails visibly. The PD Port retains selection/budget validation and caller signal. There is no model fallback.

The narrow SD change reuses `LLMClient.generate_json`'s existing JSON parser and bounded JSON repair while overriding only its candidate execution to this PD stream. It constructs no SD LLM driver/config. Previously `json.loads` rejected outputs accepted by the original parser and bypassed JSON repair. `TurnPlanner._generate_validated_plan` and normalization stay unchanged, including original schema repair. Provider stream errors are not retried by JSON repair. Exhausted malformed output retains `PUBLIC_HOST_SOP_PLAN_INVALID`; original host failure subcodes remain visible through the route's 503 detail.

This fixes a source contract difference; it does **not** establish that JSON formatting was the historical fresh5 K3 503 cause. That raw lacks the response detail. A new process must preserve the problem response's `code`, `detail` and request ID if routing fails again, without replacing the retained raw.

## Portable SOP and profile contract

`/healthz` is the portable service protocol manifest, not the SD management API health. It must return `status:"ok"`, `moduleId:"sop.runtime"`, `contract:"sop.lifecycle/v2"`, `protocolVersion:"2.0"`, and `operations:["prepare","submit"]` from the same service that handles `POST /v1/sop/prepare` and `POST /v1/sop/submit`. There is no HTTP `execute` route: execution is prepare then proposal submission using the original v2 envelopes and owner semantics.

Keep `modules.sop.endpoint` on this real portable origin. Keep discovery and management on SD `/api/v1` with the original credential, target, published bundle and default SOP ID. Do not synthesize `/healthz` on the SD API or disable manifest checks. Existing source is `portable_sop/src/staffdeck_sop_runtime/api.py`; it needs no new service implementation. Start the existing `staffdeck_sop_runtime.api:app` with that package plus its original backend dependencies available to the process.

Read-only inputs observed in runtime-6/runtime-7: both checkouts are PD `d1de0e0a38520c1138ca62a5cb12eb3cc63c43c7` / SD `702063efc0436024e510bcd1a6b98633cba1c3a2`. Their new portable origins are respectively `http://127.0.0.1:16512` and `http://127.0.0.1:17712`; this records configured inputs, not running readiness. Both `fresh_profile.mjs` still import/call the pure `composeLimitedStaffDeckProfile` function. For a subsequent frozen candidate consume integrated PD `8a03e8818594aa189f308a21dfe784c97fdf2fac`'s `composeVerifiedLimitedStaffDeckProfile` (await it) or the script CLI after starting the portable service. That fixed code rejects SD/portable origin collisions and reads/validates the actual manifest before writing enabled profile. Existing process/test roots are not edited by this handoff.

## Focused evidence

- SD `PYTHONPATH=backend:backend/src:portable_sop/src backend/.venv/bin/python -m pytest -q portable_sop/tests/test_api.py backend/tests/test_public_host_sop_route.py backend/tests/test_public_sop_route.py`: **17 passed**. Covers original portable manifest/envelopes, PD-bound catalog/stream, no SD lookup, visible route selection, fenced JSON, original JSON/schema repair and terminal stream error without model retry. Test transport is controlled HTTP/NDJSON, not real business evidence.
- PD Node v22.23.1 with explicit bundled workspace `tsx/dist/loader.mjs`, focused `public-host-sop-model-provider`, `staffdeck-sop-discovery-client`, `staffdeck-sop-client` specs: **11 passed**. Covers one catalog/stream source, authenticated discovery DTO, manifest and prepare/submit envelopes, semantic errors and cancellation.
- SD Python syntax check and `git diff --check`: passed. PD production code is unchanged in this batch; no full build or new typecheck is claimed.

## Remaining real-process prerequisites

Integration must consume the two-file SD diff into its own root and freeze a new clean pair. SD enabled startup must bind the integrated fixed domain client to this run's authenticated Gateway/token/identity tuple; Gateway must expose the selected runtime's existing catalog and model stream. Portable service must be independently started and verified before the enabled profile is written, with the final endpoint pointing to it. A new actual route must retain its problem response on failure; historical K3 is not declared resolved by focused tests.

Fresh4 string `message.content` must be rejected with HTTP 400 before provider admission. Integrated `ab35cdcc5a0b6bab19448f6dc64525c40df5d998` handles the active public Port; shared canonical validator/native coverage remains the previously assigned validator-owner hunk. runtime-6/runtime-7's old fixed PD ref does not contain that fix. Do not present an invalid probe's downstream provider 400 as successful admission.

Only independent new-process evidence can establish normal Knowledge/SOP completion, effective profile/model binding or gate status. Approval/high management remains deferred and employee/team additions remain excluded. No old state, fallback, second model, business rerun, push, merge, deploy or archive is part of this delivery.
