# Desktop Linux chrome smoke — merge `0db122b3` (post-#18)

Evidence-only. **Do not merge.** Draft. No product / `src` / `ui` / `apps` changes.

Post-#18 merge smoke on `rust_standalone_alpha1` tip `0db122b3b60b638b01edd45fe8650fcd9d4eeb8e`. This folder records **this** official N=1 one-shot pair only. It does **not** claim the #14 Wayland File-click hang is fixed.

`gitSha` = `0db122b3b60b638b01edd45fe8650fcd9d4eeb8e`. `gitDirty` = `false`.

## Result

| Backend | Result | Exit | Seconds | File-click (official N=1) |
|---|---|---|---|---|
| **X11** | **PASS** | `0` | 22 | timeout=0, stable=1, N=1 |
| **Wayland** | **PASS** | `0` | 19 | timeout=0, stable=1, N=1 |

`passed:true` JSON from both official scripts. Wrapper `timeout 300` on Wayland was not hit.

**PR targeting:** head `cursor/desktop-smoke-0db122b3-88fc` is rooted at `0db122b3`. Base **must** be `rust_standalone_alpha1` (same SHA). A `main` base is wrong and inflates the diff. After retarget, the PR adds only `review/desktop-smoke-0db122b3/**`.

## Git identity

Verified on a clean checkout of the merge commit, immediately after `git checkout -b cursor/desktop-smoke-0db122b3-88fc` and **before** this evidence tree was written:

```
$ git rev-parse HEAD
0db122b3b60b638b01edd45fe8650fcd9d4eeb8e

$ git log -1 --format='%P %s'
61ef132170b642fecf7e0acaf65b8f121319a651 2dba57fc8c4c61aff5fa8901889b2d889c7eaa9b Merge pull request #18 from Eveosev/cursor/t-p1-01-pr-b-c23a

$ git status --porcelain
# empty (porcelain byte count 0)
```

| Field | Value |
|---|---|
| `gitSha` | `0db122b3b60b638b01edd45fe8650fcd9d4eeb8e` |
| `gitDirty` | `false` |
| porcelain byte count | `0` |
| verifiedAtUtc | `2026-10-14T02:47:18Z` |
| commit subject | `Merge pull request #18 from Eveosev/cursor/t-p1-01-pr-b-c23a` |
| parents | `61ef1321` (previous `rust_standalone_alpha1` tip / post-#16) + `2dba57fc` (#18 tip) |
| remote `rust_standalone_alpha1` | `0db122b3b60b638b01edd45fe8650fcd9d4eeb8e` |

See `git-identity.txt` and `provenance.json`.

Smoke ran on evidence branch `cursor/desktop-smoke-0db122b3-88fc`. Product tree vs the merge SHA is empty:

```
git diff --stat 0db122b3b60b638b01edd45fe8650fcd9d4eeb8e -- . ':!review'
# empty
```

## GitHub Actions `Desktop` / `desktop-smoke.yml`

Prefer `workflow_dispatch` on this SHA / `rust_standalone_alpha1`. Same 403 fallback as prior #17.

| Attempt | HTTP | Body |
|---|---|---|
| `gh workflow run Desktop --ref rust_standalone_alpha1` | **403** | `Resource not accessible by integration` (`POST .../actions/workflows/381604437/dispatches`) |
| `gh workflow run desktop-smoke.yml --ref 0db122b3b60b638b01edd45fe8650fcd9d4eeb8e` | **403** | same |

`gh run list --commit 0db122b3b60b638b01edd45fe8650fcd9d4eeb8e` → **no runs**. This merge SHA has no Desktop workflow execution. See `gha/`.

No GHA run id / job conclusion exists for `0db122b3`. **Local fallback used** (same as #17): official scripts ran in this cloud VM.

Context only (not this SHA, not substituted): prior post-#16 evidence is #17 on `61ef1321`. Those results are not reused here. #14 remains a separate diagnostic branch; this post-merge smoke does not claim that hang is fixed.

## Local environment (fallback)

| Item | Value |
|---|---|
| OS | Ubuntu 24.04.5 LTS (`noble`), x86_64 |
| CI contrast | CI Linux DEB jobs: `ubuntu-22.04` + Node 22.23.1 |
| Node | v22.23.3 (`/home/ubuntu/.nvm/versions/node/v22.23.3/bin/node`) |
| pnpm | 10.32.1 (same as CI) |
| electron | 42.11.1 |
| weston | 13.0.0 (`weston` 13.0.0-4build3) |
| xvfb | 2:21.1.12-1ubuntu1.8 |
| dbus-x11 | present |

CI-equivalent apt set:

```
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  dbus-x11 desktop-file-utils weston x11-utils xauth xvfb
```

Prep (not the smoke entry, required so the script can load Electron + compiled shell):

```
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"
export PILOTDECK_CHROME_NODE_BINARY="$HOME/.nvm/versions/node/v22.23.3/bin/node"
pnpm install --frozen-lockfile          # exit 0
pnpm --filter pilotdeck-desktop run compile   # exit 0
```

See `host.txt`.

## Official smoke commands (same entry as CI)

```
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"
export PILOTDECK_CHROME_NODE_BINARY="$HOME/.nvm/versions/node/v22.23.3/bin/node"
bash apps/desktop/scripts/run-linux-chrome-smoke.sh x11
bash apps/desktop/scripts/run-linux-chrome-smoke.sh wayland
```

Wayland was wrapped with `timeout --preserve-status --signal=TERM --kill-after=30s 300` so a File-click stall would be recorded as exit 124 rather than an unbounded hang. It was not needed.

| Backend | Command | Start UTC | End UTC | Exit | Seconds | Log | Screenshots |
|---|---|---|---|---|---|---|---|
| X11 | `bash apps/desktop/scripts/run-linux-chrome-smoke.sh x11` | 2026-10-14T02:47:58Z | 2026-10-14T02:48:20Z | **0** | 22 | `smoke-x11.log` | `chrome-screenshots/linux-x11/` (9 PNG) |
| Wayland | `bash apps/desktop/scripts/run-linux-chrome-smoke.sh wayland` | 2026-10-14T02:48:26Z | 2026-10-14T02:48:45Z | **0** | 19 | `smoke-wayland.log` | `chrome-screenshots/linux-wayland/` (9 PNG) |

Script-owned output dir (gitignored): `outputs/desktop-chrome-review/linux-{x11,wayland}/`. Copies live under `chrome-screenshots/` (the repo `.gitignore` entry `outputs/desktop-chrome-review/` would drop the originals).

Stdout from each official script:

```
PASS: compact caption and rich About dialog, version copy and project link
{"passed":true,"geometry":{"x":6,"border":"1px","radius":"14px"},"unmappedFixtureEndpoints":["/api/taskmaster/installation-status","/api/agents/runtime-config","/api/commands/list","/api/v1/providers"],"artifactDir":"..."}
```

## File-click counts (official N=1)

Observed on **this** official one-shot pair after #18 merged:

| | X11 | Wayland | Total |
|---|---|---|---|
| Suite runs | 1 | 1 | 2 |
| Suite pass | 1 | 1 | 2 |
| Suite fail | 0 | 0 | 0 |
| File-click **timeout** | **0** | **0** | **0** |
| File-click **stable** | **1** | **1** | **2** |
| File `.click()` sites completed in a passing suite | 3 | 3 | 6 |
| Wrapper timeout (300s) | n/a | 0 | 0 |

File `.click()` sites that a passing `desktop-chrome.smoke.mjs` must finish: L161 (dark File), L243 (File → New Project), L339 (light File). No Playwright File-click timeout text in `smoke-x11.log` or `smoke-wayland.log`. Screenshots include File popup on both backends (`linux-dark-popup.png`, `linux-light-popup.png`, `linux-light-zh-popup.png`).

This is N=1 per backend, same as the official chrome smoke entry. It is **not** the C-group N=100/300 File-click gate. See `file-click-counts.txt`.

Association: post-merge of [#18](https://github.com/Eveosev/PilotDeck/pull/18) into `rust_standalone_alpha1`. #14 remains a separate diagnostic branch. This 0db122b3 official one-shot recorded File-click timeout=0 / stable=1 per backend. That is what the smoke shows; it is not a C-gate rate and does not claim the #14 hang is fixed.

## Artifact index

- `SUMMARY.md` — this file
- `provenance.json` — `gitSha` / `gitDirty=false` / commands / timestamps
- `git-identity.txt` — identity captured before evidence writes
- `host.txt` — OS, Node, weston, xvfb
- `file-click-counts.txt` — hang counts
- `gha/workflow-dispatch-403.txt` — dispatch 403
- `gha/runs-on-0db122b3.txt` — empty run list on this SHA
- `smoke-x11.log`, `smoke-wayland.log` — combined full logs (meta + stdout + stderr + vite)
- `run-logs/x11-*.txt`, `run-logs/wayland-*.txt` — split stdout/stderr/meta/vite
- `chrome-screenshots/linux-x11/`, `chrome-screenshots/linux-wayland/`
- `SHA256SUMS.txt`
