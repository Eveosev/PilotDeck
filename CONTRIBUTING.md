# Contributing

Workflow: **Fork → feature branch → PR**.

## Module Protocol changes

Any PR that touches `src/agent/modules/protocol.ts` must follow
[`evidence/protocol-sync-gate.md`](evidence/protocol-sync-gate.md) (T-P0a-07).

The protocol is **not frozen**. It may change, but the same PR must keep these
in sync:

1. Regenerate `evidence/schema/module-protocol.schema.json` via
   `scripts/generate-module-protocol-schema.mjs` (second generate = empty diff).
   Update `docs/pilotdeck-module-protocol-v2.schema.json` when the published v2
   profile is affected.
2. `scripts/replay-module-protocol-schema.mjs` — expressible mismatches = 0.
3. Update A3 fixtures; loosened-schema control must **FAIL**.
4. Re-run `tools/agent-loop-parity` when runtime accept/reject changes.
5. From T-P1-01 on, update the matching `crates/` adapter in the same PR.
6. Write down whether `protocolVersion` / `capabilitiesVersion` bump.
7. Record evidence on a clean tree (`gitSha`, `gitDirty=false`).

Schema is **hand-mapped + source anchors + replay**, not generated from
TypeScript types (limit **F-5**). Field-mutation fuzz of reject samples is
**R2-1**, owned by T-P0a-04.

Path-triggered CI for this gate is **not** enabled yet.
