# T-P0a-01 module-protocol schema replay

- input: `src/agent/modules/protocol.ts`
- schema: `evidence/schema/module-protocol.schema.json`
- gitSha: `b328626a8ce4daf27dae3fe613dc2d18f94b42c7`
- gitDirty: `false`
- ajv: `8.20.0`
- JSON Schema: draft 2020-12

## additionalProperties

Top-level and payload extra fields are accepted (`true`). Rejected by name only: attemptId, stepId, moduleInstanceId, connectionGeneration. Probe: `evidence/schema/additional-properties-probe.md`.

## A1 reproducible generation

- file matches builder: `true`
- second generation diff empty: `true`
- dirty tree refused (exit 2): `true`

## A2 53-scenario accept/reject replay

A2 corpus is **synthetic template messages** materialized from the 53
`tools/agent-loop-parity` scenario metadata (`REQUIRED_GATEWAY_SCENARIOS`).
These are **not** live wire traces.

- scenarios: **53**
- total compared: **648**
- accept/reject: **648/0**
- per-source counts: `ack` 2 (2/0), `cancel` 3 (3/0), `error` 9 (9/0), `event` 53 (53/0), `event-final` 53 (53/0), `execute` 53 (53/0), `execute-accepted` 53 (53/0), `handshake` 212 (212/0), `module_call-response:budget` 3 (3/0), `module_call-response:capability` 4 (4/0), `module_call-response:context` 3 (3/0), `module_call-response:model` 9 (9/0), `module_call-response:turn` 4 (4/0), `module_call:budget` 3 (3/0), `module_call:capability` 4 (4/0), `module_call:context` 3 (3/0), `module_call:model` 9 (9/0), `module_call:turn` 4 (4/0), `response-final` 53 (53/0), `result_unknown` 106 (106/0), `resume` 2 (2/0), `status` 3 (3/0)
- expressible mismatches: **0** (must be 0)
- inexpressible rules: **0** (listed separately; schema was not loosened)

No expressible mismatches.

## A3 negatives, edges, loosened control

- negatives: 20; both reject: `true`
- missing message types: (none)
- missing conditionals: (none)
- edges: 26; match expect: `true`
- loosened-schema control: **FAIL** (must FAIL; per-rule every)

- `final-implies-outcome`: compared=2 fail=true
- `forbidden-attemptId-stepId`: compared=2 fail=true
- `forbidden-binding-on-event`: compared=2 fail=true

## A4 contract versions

Versions in `x-pilotdeck.contractVersions` are **annotations**; the schema does not enforce them.

- protocolVersion: `{"field":"protocolVersion","value":"2.0"}`
- capabilitiesVersion: `{"field":"capabilitiesVersion","value":null,"negotiated":true}`
- storageConfigVersion written as contract: `false`
- notContractVersions: storageConfigVersion

## T-P1 Rust serde parse risk

JSON.parse may collapse 1.0 / exponent forms (1e2, 1E0, 100e-2) to JS integers, keep Object.is(-0,-0), lose precision above 2^53, and turn 1e400 into Infinity. Rust serde_json may keep f64, reject exponent-as-integer, preserve signed zero, or error on overflow instead of Infinity. ajv must run strict:true for parity with this schema.

ajv must run `strict: true` for parity with this schema.

- `event-sequence-1.0` token=1.0 js=1 negativeZero=undefined
- `event-sequence-negative-zero` token=-0 js=0 negativeZero=true
- `resume-lastAppliedSequence-1.0` token=1.0 js=1 negativeZero=undefined
- `resume-lastAppliedSequence-negative-zero` token=-0 js=0 negativeZero=true
- `event-sequence-1e2` token=1e2 js=100 negativeZero=undefined
- `event-sequence-1E0` token=1E0 js=1 negativeZero=undefined
- `event-sequence-100e-2` token=100e-2 js=1 negativeZero=undefined
- `event-sequence-above-2-pow-53` token=9007199254740993 js=9007199254740992 negativeZero=undefined
- `event-sequence-1e400` token=1e400 js=Infinity negativeZero=undefined

## Inexpressible rules

None. isId / isSequence / isResumeSequence / isBinding / isOutcome are all expressible in draft 2020-12. Schema was not loosened to force a zero mismatch count.
