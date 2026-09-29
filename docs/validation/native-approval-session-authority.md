# Native approval session authority

The normal local Gateway now supplies an approval session resolver from the original native installation and session persistence. It does not derive PilotDeck session keys from StaffDeck external IDs or maintain a second access list.

At first native session creation, the host checks the single active user in the existing read-only auth database against the configured PilotDeck owner and checks the selected SOP discovery target against the formal target. Only an empty original transcript with no corruption diagnostics (a missing new transcript is expected) receives `staffDeckAdmission` metadata (tenant, target, owner, registered project). Existing histories are never backfilled. No credential or approver assignment is stored in that metadata.

The resolver joins the original active installation owner, registered project/session catalog, and persisted admission metadata. Foreign, unregistered, ambiguous, changed or missing joins are refused. Metadata snapshots may retain the same original admission; conflicting records are refused. The Gateway retains explicit authority injection for hosts with another original session authority.

The existing current-user authentication, SOP pinned assignee, locked wait/revision validation and receipt replay remain authoritative. The resolver does not choose an approver, create a wait, change SOP state or continue a turn. Legacy sessions without original admission remain forbidden; independent real approval verification must create a fresh session on this candidate through normal admission and retain its real human wait and pinned published definition.

Focused checks use the real native auth database and transcript storage, exercise normal production Gateway admission, reject old/foreign/changed mappings, and retain the existing bridge authentication/replay tests. These deterministic checks do not claim a real-provider human approval lifecycle PASS.
