# T-P0a-01 Module Protocol JSON Schema

Machine-readable contract for the agent-loop ↔ sidecar Module Protocol.
Generated from `src/agent/modules/protocol.ts` only (`validateModuleMessage`).
No protocol or runtime behavior change. No Rust type generation. No CI gate.

## Artifacts

| Path | Role |
| --- | --- |
| `module-protocol.schema.json` | JSON Schema draft 2020-12 |
| `additional-properties-probe.md` | Empirical `additionalProperties` result |
| `replay-report.md` / `replay-report.json` | A1–A4 evidence (`gitSha`, `gitDirty=false`) |
| `fixtures/negative-samples.json` | Per-type negatives + conditionals |
| `fixtures/edge-samples.json` | Raw JSON `1.0` / `-0` / `-1`, extra fields, empty/non-string ids |

Validator: **ajv 8.20.0** + draft **2020-12**.

Contract versions written into the schema: `protocolVersion` and `capabilitiesVersion`.
`storageConfigVersion` is explicitly not a contract version.

## Commands

Tree must be clean before generate or official replay.

```bash
node scripts/generate-module-protocol-schema.mjs
node scripts/replay-module-protocol-schema.mjs
```

Generate refuses a dirty tree (exit 2). A second generate on a clean tree must be a no-op (`git diff` empty).

Replay compares accept/reject only against `validateModuleMessage` for the 53
`tools/agent-loop-parity` gateway gate scenarios (same set as
`REQUIRED_GATEWAY_SCENARIOS`), plus negatives, edges, and a loosened-schema
control that must FAIL.
