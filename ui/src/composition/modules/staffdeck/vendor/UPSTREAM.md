# StaffDeck business UI release

This directory is the vendored `@staffdeck/business-ui` `0.1.2` shared-slice release
used by the PilotDeck production composition. The authoritative source package
lives in `OpenBMB/StaffDeck` at `packages/staffdeck-business-ui` on branch
`codex/g0-g6-unified-integration-sd`. This snapshot corresponds to StaffDeck
candidate commit `6e95aa6d54d226adfb24182a5d6770183193ded9`; the latest shared
source change is that commit, following `6b34f80b174a7cfa17805d186efd912fe686caed`.

The snapshot is intentionally checked into PilotDeck so a normal build never
depends on an unversioned sibling checkout. It includes the original formal
Knowledge and Skills pages, their generic host bridges, the Knowledge graph
canvas, and the SOP version-detail renderer. PilotDeck supplies only transport,
auth/scope, navigation, notifications, and primitive adapters.
To update this snapshot, first select and record a fixed StaffDeck candidate
commit and package version. Copy the package's `package.json` and the shared
source files checked by `scripts/verify-staffdeck-business-ui-vendor.mjs` from
that commit into this directory. Then run the repository vendor check with
`STAFFDECK_BUSINESS_UI_ROOT=/absolute/path/to/StaffDeck/packages/staffdeck-business-ui`
pointing at the same checked-out commit. Update the commits and version above
only after the snapshot and check agree.
