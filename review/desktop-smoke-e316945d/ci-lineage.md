# Desktop CI lineage for merge `e316945d`

## Merge commit itself

- SHA: `e316945d0c667b64bcbd2e27a1bd05ca895ab1d5`
- `GET /commits/e316945d…/check-runs` → `total_count=0`
- `GET /commits/e316945d…/status` → `state=pending`, empty statuses
- `gh run list --commit e316945d` → empty
- Cause: `.github/workflows/desktop-smoke.yml` is `pull_request` + `workflow_dispatch` only. A push/merge onto `rust_standalone_alpha1` does not start Desktop.

## PR #12 head (second parent)

- PR head: `b257df70181004db13b35924c3bbd4b425e498c0`
- Merge: `e316945d` = `761572d7` + `b257df70`
- Latest Desktop run on that PR head: [38352306293](https://github.com/Eveosev/PilotDeck/actions/runs/38352306293)
  - event: `pull_request`
  - conclusion: **success**
  - duration: 15m7s
  - finished: 2026-10-13T05:52:09Z (approx)

| Job | conclusion | job URL |
|---|---|---|
| Checks | success | https://github.com/Eveosev/PilotDeck/actions/runs/38352306293/job/115147223834 |
| Linux / DEB x64 | success | https://github.com/Eveosev/PilotDeck/actions/runs/38352306293/job/115147224125 |
| Linux / DEB arm64 | success | https://github.com/Eveosev/PilotDeck/actions/runs/38352306293/job/115147224217 |
| Linux / RPM x64 | success | https://github.com/Eveosev/PilotDeck/actions/runs/38352306293/job/115147224096 |
| Linux / RPM arm64 | success | https://github.com/Eveosev/PilotDeck/actions/runs/38352306293/job/115147224232 |
| macOS / arm64 | success | https://github.com/Eveosev/PilotDeck/actions/runs/38352306293/job/115147224039 |
| macOS / x64 | success | https://github.com/Eveosev/PilotDeck/actions/runs/38352306293/job/115147224144 |
| Windows / x64 | success | https://github.com/Eveosev/PilotDeck/actions/runs/38352306293/job/115147224083 |
| Windows / arm64 | success | https://github.com/Eveosev/PilotDeck/actions/runs/38352306293/job/115147224218 |

### Linux DEB X11 + Wayland steps (both arches success)

| Step | DEB x64 | DEB arm64 |
|---|---|---|
| Smoke installed app under X11 | success | success |
| Smoke installed app under Wayland | success | success |
| Verify Linux menus, language and theme under X11 | success | success |
| Verify Linux menus, language and theme under Wayland | success | success |

### Linux RPM X11 + Wayland steps (both arches success)

| Step | RPM x64 | RPM arm64 |
|---|---|---|
| Smoke installed app under X11 | success | success |
| Smoke installed app under Wayland | success | success |

Lineage CI is green on the PR head that became the merge's second parent. It is **not** a run on `e316945d` itself. Local chrome smoke on this SHA is recorded under `local/`.
