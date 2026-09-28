# Fixed-target binding preparation

Authority and normal account/approval process: [PRE_CANDIDATE_INPUTS_20260928.md](/Users/a1/Documents/Codex/2026-09-27/g0-g6-integration-intake/PRE_CANDIDATE_INPUTS_20260928.md), incorporating the independent [environment readiness original](/Users/a1/Documents/Codex/2026-09-27/g0-g7-acceptance-preparation/ENVIRONMENT_READINESS_20260928.md). The integration owner retains this offline binding tool; provider/profile/domain DI implementations retain their existing owners.

`scripts/prepare-staffdeck-bindings.mjs` consumes saved normal API responses, never makes requests or creates identities. Input fields: `actorLogin`, `actorMe`, `credentialCreated`, `credentials`, `target`, `pilotDeckLogin`, `pilotDeckMe`, optional paired `approverLogin`/`approverMe`, `staffDeckOrigin`, `definitionsPath`, `defaultSopId`. The response fields are the unwrapped bodies described in the authority document; no guessed IDs, old keys or database insertion.

It checks recorded tenant/actor/PD user/target consistency, active owned account credentials and their 20-character prefix/scopes/expiry, and, if provided, the complete same-tenant native web approver identity. The accepted minimum path can omit both approver fields; partial tuples are rejected. Domain binding additionally outputs `PILOTDECK_DOMAIN_HOST_ENABLED=true` and the response-derived `PILOTDECK_USER_ID`; the normal Gateway origin/token path still comes from the deployment root. Output contains `env`, a partial `configPatch`, public `identity` metadata, and explicit readiness limitations. Production routes continue to authenticate and authorize every request. Offline response consistency cannot establish current authentication, runtime/model readiness or approval authority.

Run from this checkout with Node22:

```sh
node scripts/prepare-staffdeck-bindings.mjs /absolute/private-input.json /absolute/new-private-output.json
```

Output is a new private JSON file (mode600, refuses overwrite), never a shell script or a complete profile. It contains account key/token and the runtime parser's literal `discoveryApiKey`, so it belongs in private preparation, not public evidence. Merge its config patch into the actual owner-supplied effective profile; keep existing seven-slot/provider/endpoints, budgets, DI and actual SOP definitions. No successful bundle/version/receipt/wait is generated.

The source-derived native bootstrap is normal startup seed followed by authenticated account creation, login/me, blank target creation and account key issuance. Disabling seed on an empty database without external control leaves tenant/admin bootstrap missing; login itself does not create them. External control requires its original identity source and member resolver, not fallback or shadow accounts.

Approval is user-deferred for the accepted minimum path, with human submission disabled when the normal credential or admitted mapping is absent. The retained later contract remains distinct: SD's native handoff inbox filters PD-origin sessions, and existing PD resume carries no SD assignee identity. An actual fixed approver account and `web` channel do not prove the two-host approval principal/wait mapping. Public/runtime must supply that formal contract for the integration bridge to consume.

Validation: focused Node tests6/6 passed for response-derived bindings, cross-tenant/actor/PD user rejection, foreign/revoked/expired/missing-scope credentials, invalid native members and invalid formal origins. No service launch, model call, old-ref business run or gate upgrade. Existing continuation pair is retained. This preparation does not prove effective profile or business operation; only minimum-path-required contracts remain candidate prerequisites. Deferred operations and approval mapping are not marked PASS.
