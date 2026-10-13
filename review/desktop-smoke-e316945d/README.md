# Desktop smoke @ `e316945d` (verification only)

Post-merge X11 + Wayland smoke for `rust_standalone_alpha1` tip after PR #12.

- gitSha: `e316945d0c667b64bcbd2e27a1bd05ca895ab1d5`
- gitDirty at start: `false`
- Evidence branch: `review/desktop-smoke-e316945d`
- No PR (requested)
- recordedAt: `2026-10-13T06:00:56Z`

## Result: PASS

Local chrome e2e on this SHA passed under both Xvfb/X11 and headless Weston/Wayland (`exit=0`). Merge commit itself has no GitHub Actions (Desktop is PR-only). Lineage CI on PR #12 head `b257df70` was fully green, including DEB/RPM packaged-app X11+Wayland and DEB chrome e2e.

| Check | Scope | Result |
|---|---|---|
| Actions on `e316945d` | merge SHA | none (not triggered) |
| Desktop run `38352306293` | PR head `b257df70` | success (all 9 jobs) |
| DEB x64/arm64 X11 display + chrome | PR head | success |
| DEB x64/arm64 Wayland display + chrome | PR head | success |
| RPM x64/arm64 X11 + Wayland display | PR head | success |
| Local `run-linux-chrome-smoke.sh x11` | this SHA, Ubuntu 24.04 x64 | **PASS exit 0** |
| Local `run-linux-chrome-smoke.sh wayland` | this SHA, Ubuntu 24.04 x64 | **PASS exit 0** |

Details: `ci-lineage.md`, `local/SUMMARY.md`.
