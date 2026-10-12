# T-P0a-01 module-protocol schema replay

- input: `src/agent/modules/protocol.ts`
- schema: `evidence/schema/module-protocol.schema.json`
- gitSha: `9dfec79ad9e417cd510b0cb4cfa5bebdb82b8ea5`
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

- scenarios: **53**
- total compared: **542**
- expressible mismatches: **0** (must be 0)
- inexpressible rules: **0** (listed separately; schema was not loosened)

No expressible mismatches.

## A3 negatives, edges, loosened control

- negatives: 20; both reject: `true`
- missing message types: (none)
- missing conditionals: (none)
- edges match expect: `true`
- loosened-schema control: **FAIL** (must FAIL)

## A4 contract versions

- protocolVersion: `2.0`
- capabilitiesVersion: `capabilitiesVersion`
- storageConfigVersion written as contract: `false`
- notContractVersions: storageConfigVersion

## T-P1 Rust serde parse risk

Named note for `1.0` / `-0` after JSON.parse. Both JS validators accept the integer-like values; a Rust `serde` integer field may not.

- `event-sequence-1.0` token=1.0 js=1 negativeZero=undefined
- `event-sequence-negative-zero` token=-0 js=0 negativeZero=true
- `resume-lastAppliedSequence-1.0` token=1.0 js=1 negativeZero=undefined
- `resume-lastAppliedSequence-negative-zero` token=-0 js=0 negativeZero=true

## Inexpressible rules

None. isId / isSequence / isResumeSequence / isBinding / isOutcome are all expressible in draft 2020-12. Schema was not loosened to force a zero mismatch count.
