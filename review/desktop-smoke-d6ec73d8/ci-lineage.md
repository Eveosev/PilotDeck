# Desktop CI lineage for merge `d6ec73d8`

## Merge commit itself

- SHA: `d6ec73d824e74009c47c0254c86db194ad7ce66d`
- `GET /commits/d6ec73d8…/check-runs` → `total_count=0`
- `GET /commits/d6ec73d8…/status` → `state=pending`, empty statuses
- `gh run list --commit d6ec73d8` → empty
- `GET /actions/runs?head_sha=d6ec73d8…` → `total_count=0`
- Cause: `.github/workflows/desktop-smoke.yml` is `pull_request` (path-filtered) + `workflow_dispatch` only. A push/merge onto `rust_standalone_alpha1` does not start Desktop.

## PR #7 head (second parent)

- PR head: `54e9d8b7c224fc2b807d1420208b1cc2dcb5c95a`
- Merge: `d6ec73d8` = `e316945d` + `54e9d8b7`
- PR: https://github.com/Eveosev/PilotDeck/pull/7
- Desktop on this SHA: **none**
  - `gh run list --workflow=Desktop` has no run with `headSha=54e9d8b7…`
  - `GET /actions/runs?head_sha=54e9d8b7…` returns only Web Regression
  - Cause: Desktop `on.pull_request.paths` is `apps/desktop/**`, `src/**`, `ui/**`, `skills/**`, lockfile/workspace, and desktop workflow files. PR #7 changed only docs/review files (`CONTRIBUTING.md`, `README.md`, `README.zh.md`, `evidence/**`, `review/2026-10-12-T-P0a-07-protocol-change-gate/**`).

### Only Actions run on `54e9d8b7` (not Desktop)

- Latest / only run: [38354088069](https://github.com/Eveosev/PilotDeck/actions/runs/38354088069)
  - workflow: **Web Regression**
  - event: `pull_request`
  - conclusion: **success**
  - duration: 4m46s
  - created: 2026-10-13T05:57:34Z
  - finished: 2026-10-13T06:02:20Z

| Job | conclusion | job URL |
|---|---|---|
| web | success | https://github.com/Eveosev/PilotDeck/actions/runs/38354088069/job/115152834918 |
| docker | success | https://github.com/Eveosev/PilotDeck/actions/runs/38354088069/job/115152835084 |

There is **no Desktop run URL** for `d6ec73d8` or `54e9d8b7`. Local chrome smoke on this merge SHA is recorded under `local/`.
