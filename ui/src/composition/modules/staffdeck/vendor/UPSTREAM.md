# StaffDeck business UI release

This directory is the vendored `@staffdeck/business-ui` `0.1.11` shared-slice release
used by the PilotDeck production composition. The authoritative source package
lives in `OpenBMB/StaffDeck` at `packages/staffdeck-business-ui` on branch
`codex/g5-editor-context-sd`. This snapshot corresponds to StaffDeck
candidate commit `e83c347d1425d8c869c8b61772b57c93216f8a7e`; the latest shared source change is that commit,
following `019f0355e27c6bc71e71a01e0f3055ef49d9bb7b`,
following `0d2839ebaad22c077cfaaf22ca479dd47e27c5f1`,
following `5adaade114b38a9a5af731f922ce71110fd24798`,
following `67b0ceaac3cb7115c1f752f9fceabd43b05a1c48`,
following `f8c82b71f8fb61b866d1c3a3eea8124a6bfbfab9`, `e8826ed9abc977921d0ed0b80281241b38bf9c9e`, `999e036b65387e7ff81c0f4f100384dafdc1b976`, `60873869ae66e84178d779fac3cb8317236c0df0`, `426f583956f49e7c419cdf7fb8672ce7aae92ff9`, `04ba7e4103820b1fd91d52a36909e78df69eb46c`, `6e95aa6d54d226adfb24182a5d6770183193ded9` and
`6b34f80b174a7cfa17805d186efd912fe686caed`.

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
