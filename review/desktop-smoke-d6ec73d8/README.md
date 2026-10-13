# Desktop smoke @ `d6ec73d8` (verification only)

Post-merge X11 + Wayland smoke for `rust_standalone_alpha1` tip after PR #7.

- gitSha: `d6ec73d824e74009c47c0254c86db194ad7ce66d`
- gitDirty at start: `false`
- Evidence branch: `review/desktop-smoke-d6ec73d8`
- No PR (requested)
- recordedAt: `2026-10-13T06:20:28Z`

## Result: PASS

Local chrome e2e on this SHA passed under both Xvfb/X11 and headless Weston/Wayland (`exit=0`). Merge commit itself has no GitHub Actions (Desktop is PR-only + path-filtered). PR-side parent `54e9d8b7` also has **no Desktop run** (PR #7 touched only docs/review files). The only Actions on that parent is Web Regression.

| Check | Scope | Result |
|---|---|---|
| Actions on `d6ec73d8` | merge SHA | none (not triggered) |
| Desktop on `54e9d8b7` | PR #7 head | **none** (path filter) |
| Web Regression `38354088069` | PR head `54e9d8b7` | success (web + docker) |
| Local `run-linux-chrome-smoke.sh x11` | this SHA, Ubuntu 24.04 x64 | **PASS exit 0** |
| Local `run-linux-chrome-smoke.sh wayland` | this SHA, Ubuntu 24.04 x64 | **PASS exit 0** |

Details: `ci-lineage.md`, `local/SUMMARY.md`.
