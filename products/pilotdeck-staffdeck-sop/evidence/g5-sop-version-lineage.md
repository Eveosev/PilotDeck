# G5 SOP Version Lineage

This record separates the two host UI saves from the definition that was
actually published through the StaffDeck management adapter and consumed by
the real PilotDeck run. Matching only the SOP ID would be insufficient.

## UI Records

| Host surface | ID / version | Structure after save and reload | Role |
| --- | --- | --- | --- |
| PilotDeck shared editor | `project_delivery_plan@1.1.0` | 4 nodes, 4 edges; `collect_status -> build_plan`, conditional `build_plan -> confirm_scope/finalize_plan`, and `confirm_scope -> finalize_plan` | Authoring graph; reload preserved all nodes and edges |
| StaffDeck shared editor | `project_delivery_plan@1.1.0` | 2 local nodes, 1 edge: `n1_collect -> n2_plan` | Separate local branch; reload preserved its retry/terminal fields |

The StaffDeck UI branch is therefore not the definition used by the run. The
PilotDeck graph has the required handoff and terminal path, but its UI save
version (`1.1.0`) is also not claimed to be the runtime version.

## Authoritative Runtime Publish

The management sequence used for the run was list, draft replace, validate,
publish, list versions, get version, and rollback. The published response was
`project_delivery_plan@1.0.2`, with exactly 4 nodes and 4 edges. The publish
response normalized unavailable capability references to empty arrays and added
the owner-side nullable node fields; these are the only material differences
from the PilotDeck UI graph. The graph topology, node IDs, conditions,
handoff, retry policies, and terminal node are the same.

The run bundle is built from the saved `get version`/publish response, not from
the StaffDeck UI branch and not merely from a same-ID lookup. The run output
records the binding as `project_delivery_plan@1.0.2` with `nodes: 4` and
`edges: 4`.

## Minimal Replay

Build PilotDeck first, start the StaffDeck SOP sidecar at the configured local
endpoint, and save the management publish response to a local JSON file. No
API key is embedded in the runner.

```sh
cd /Users/a1/Desktop/claw/openbmb/PilotDeck-g5-sop-agent
NODE_OPTIONS='' \
G5_PUBLISHED_SOP_JSON=/path/to/g5-management-publish-response.json \
STAFFDECK_SOP_ENDPOINT=http://127.0.0.1:16213 \
G5_OUTPUT_PATH=/tmp/g5-real-run.json \
node --import tsx products/pilotdeck-staffdeck-sop/evidence/g5-real-run.mjs
```

The replay asserts a durable handoff, identical wait ID after gateway reload,
single acceptance plus duplicate replay for the same request ID, and terminal
completion at `finalize_plan` with `scope_confirmed: true`.

## Verification Notes

- PilotDeck host route/onboarding checks: 113 passed.
- The StaffDeck targeted pytest process exits 139 during macOS pytest capture
  initialization before collecting a result; this remains an environment
  limitation, not a passing behavior claim.
- The temporary sidecar used for the run was stopped after evidence capture;
  its generated `backend/staffdeck-runtime.applied*.json` files were removed.
