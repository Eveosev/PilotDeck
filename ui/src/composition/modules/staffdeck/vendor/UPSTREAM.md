# StaffDeck business UI snapshot

Version: 0.1.13 (integration in progress; no gate approval).
Canonical source: StaffDeck packages/staffdeck-business-ui/src at 0fa53ce38bef3e4547cd85b88142a7cc1528ec52.
Source repository: /Users/a1/Documents/Codex/2026-09-27/g0-g6-integration-intake/worktrees/staffdeck.

The canonical sources come from the explicitly transferred UI WIP (SD972f38cf)
and mounted Distill/API error repair (SD8e50d166). UI owner user-content delivery (1b201192) was integrated by three-way hunks.
Mounted Knowledge/Skills boundaries (SD4fafd1aa) remove module Host state. All 40 canonical source
files are copied byte-for-byte; host adapter/primitives/tests remain PilotDeck-owned.
Use scripts/verify-staffdeck-business-ui-vendor.mjs with STAFFDECK_BUSINESS_UI_ROOT
to verify the full source directory. Subsequent UI/adapter deliveries must update
this snapshot from the same canonical shared source, through the integration owner.

Adapter3fa7b145 host helpers are canonical FormalHostContractHelpers.ts;
PD host-contract-helpers.ts is a re-export leaf. Legacy Formal helper paths
also re-export the common source. No shared source imports PD-private modules.

UI32b87446 actual native input refs and version-detail user content boundary
were integrated incrementally as SD0fa53ce3. Shared pages retain prior public
mounted/context/helper repairs. PDd77691af adds only a real Portal locale test.
