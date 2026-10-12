# T-P0a-01 Module Protocol JSON Schema

Machine-readable contract for the agent-loop ↔ sidecar Module Protocol.
**Hand-mapped** from `src/agent/modules/protocol.ts` `validateModuleMessage`
plus source anchors and replay — `protocol.ts` is the only input.
No protocol or runtime behavior change. No Rust type generation. No CI gate.
PRs that change `src/agent/modules/protocol.ts` must follow
[`evidence/protocol-sync-gate.md`](../protocol-sync-gate.md).

## Artifacts

| Path | Role |
| --- | --- |
| `module-protocol.schema.json` | JSON Schema draft 2020-12 |
| `additional-properties-probe.md` | Empirical `additionalProperties` result |
| `replay-report.md` / `replay-report.json` | A1–A4 evidence (`gitSha`, `gitDirty=false`) |
| `fixtures/negative-samples.json` | Per-type negatives + conditionals |
| `fixtures/edge-samples.json` | Raw JSON `1.0` / `-0` / `-1` / exponents / overflow, extra fields, empty/non-string ids, `response.final` non-booleans, forbidden-field locality |

Validator: **ajv 8.20.0** + draft **2020-12**. **ajv must run `strict: true`** for accept/reject parity.

`x-pilotdeck.contractVersions` are **annotations only**; the schema does not
enforce `protocolVersion` or `capabilitiesVersion`.
`storageConfigVersion` is explicitly not a contract version.

```json
{
  "protocolVersion": { "field": "protocolVersion", "value": "2.0" },
  "capabilitiesVersion": { "field": "capabilitiesVersion", "value": null, "negotiated": true }
}
```

## A2 corpus

Replay A2 is **synthetic template messages** materialized from the 53
`tools/agent-loop-parity` scenario metadata (`REQUIRED_GATEWAY_SCENARIOS`).
These are **not** live wire traces. The report records accept/reject counts
and per-source totals.

## Commands

Tree must be clean before generate or official replay.

```bash
node scripts/generate-module-protocol-schema.mjs
node scripts/replay-module-protocol-schema.mjs
node scripts/probe-module-protocol-additional-properties.mjs
```

Generate refuses a dirty tree (exit 2). A second generate on a clean tree must be a no-op (`git diff` empty).

Replay compares accept/reject only against `validateModuleMessage` for the
synthetic 53-scenario templates, plus negatives, edges, and a loosened-schema
control that must FAIL (every conditional rule).
