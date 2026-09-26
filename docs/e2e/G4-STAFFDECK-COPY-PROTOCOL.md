# StaffDeck plaza copy bridge (PilotDeck WebUI)

The shared Knowledge and SOP pages retain their StaffDeck copy workflow. This
WebUI-only bridge does not add an eighth runtime owner or change Knowledge/SOP
module state. It calls StaffDeck's formal enterprise API with a server-held
token for the actual StaffDeck user. The PilotDeck browser token is never sent
to StaffDeck, and the StaffDeck token is never returned to the browser.

## Operation boundary

Previously public PilotDeck operations were Knowledge `list_bases` and
`sync_base`, plus SOP management `list` scoped to one configured agent. They
do not supply an authenticated visible agent directory, an overall SOP source
list, or the formal two-scope resource import.

`staffdeck.enterprise-copy/v1` exposes only these WebUI operations through
`POST /api/modules/staffdeck-copy/call`:

| Operation | StaffDeck formal request | Input from browser |
| --- | --- | --- |
| `list_agents` | `GET /api/enterprise/agents?tenant_id=<bound>` | none |
| `list_knowledge_bases` | `GET /api/enterprise/knowledge-bases?tenant_id=<bound>&agent_id=<visible-source>` | `sourceAgentId` |
| `list_skills` | `GET /api/enterprise/agents/<visible-source>/skills?tenant_id=<bound>` | `sourceAgentId` |
| `import_resources` | `POST /api/enterprise/agents/<bound-target>/resources/import` | `targetAgentId`, `sourceAgentId`, `resourceType`, `resourceIds` |

The bridge admits only an authenticated PilotDeck user whose ID equals the
configured `pilotDeckUserId`. Before every operation it calls StaffDeck's
formal `GET /api/auth/me` with the server-held token and requires its returned
`id` and `tenant_id` to equal the configured `actorUserId` and `tenantId`.
This uses StaffDeck's normal `get_current_user`/control-provider authentication,
not local token decoding. An expired credential, disabled user, or identity
mismatch fails before reading the directory or copying. Redirects are not
followed with the user credential. If a Knowledge or SOP management binding
already declares an agent ID, it must equal the copy target. StaffDeck's
authenticated directory must include the configured non-overall target. Every
source must be in that same visible
directory; `import_resources` also requires the browser target to equal the
configured target. Tenant ID, destination path and StaffDeck bearer token come
only from server configuration. StaffDeck performs the authoritative source,
target, resource visibility, version-copy and write-permission checks. Its
403/404 responses are not converted into successful copy results. The
`PILOTDECK_MODULE_ADMIN=0` setting also disables this bridge's writes.

The returned `is_overall` is the actual directory value. `active` is derived
only from the returned `status`, and `copy_target` identifies the configured
target row without granting server permission. `can_manage` is true only when
the formal directory explicitly returns `metadata.directory_access.can_manage`
for that row; PilotDeck's local admin flag is not treated as StaffDeck
authorization. No `overall` ID or resource is synthesized by PilotDeck.

## Configuration

The native-five StaffDeck profile declares `webui.staffdeckCopy`; `webui` is
the reserved WebUI namespace and is not exposed by `/api/modules/runtime`.
Set these variables in the PilotDeck WebUI server environment before starting
the formal page:

- `STAFFDECK_FORMAL_API_ORIGIN`: StaffDeck formal backend origin, not the
  Knowledge module endpoint or SOP management endpoint.
- `STAFFDECK_COPY_TENANT_ID`: tenant of the StaffDeck user token.
- `STAFFDECK_COPY_ACTOR_USER_ID`: user ID returned by the formal StaffDeck
  `GET /api/auth/me` for that token.
- `STAFFDECK_COPY_TARGET_AGENT_ID`: existing employee managed by that user.
- `STAFFDECK_COPY_PILOTDECK_USER_ID`: actual authenticated PilotDeck user ID
  authorized to use this binding.
- `STAFFDECK_COPY_USER_TOKEN`: StaffDeck formal user bearer token issued for
  that user. A SOP agent management API key is not interchangeable with it.

An absent, expired, or mismatched identity fails explicitly. Do not replace
it with a client-provided tenant, a guessed overall ID, or a silent empty
directory. The bridge needs a renewed formal user credential when the token
expires; no automatic privilege escalation or token minting is implemented.

Contract tests exercise formal identity preflight, directory projection, both
source reads, both resource types, scope rejection, redirects and upstream
failure. They do not establish a real dual-host browser or StaffDeck
persistence PASS; independent G4 evidence must
still cover the actual UI, HTTP response and stored result.
