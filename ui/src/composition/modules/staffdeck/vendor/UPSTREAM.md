# StaffDeck business UI release

This directory is the vendored `@staffdeck/business-ui` `0.1.0` shared-slice release
used by the PilotDeck production composition. Its source package lives in the
StaffDeck repository at `packages/staffdeck-business-ui` on the task branch
`codex/staffdeck-shared-business-ui`.

The snapshot is intentionally checked into PilotDeck so a normal build never
depends on an unversioned sibling checkout. Only original StaffDeck graph and
SOP version-detail slices are shared here; full Knowledge/SOP pages remain
pending faithful extraction.
Run the repository vendor check
with `STAFFDECK_BUSINESS_UI_ROOT=/absolute/path/to/StaffDeck/packages/staffdeck-business-ui`
before updating this release.
