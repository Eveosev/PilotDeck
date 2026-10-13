# Desktop Linux chrome smoke — merge `008dcd16`

Evidence-only. No product code changes. Hypothesis-free: commands, exit codes, artifact paths, File-click counts.

## Result

| Backend | Result | Exit | Seconds | File-click hang |
|---|---|---|---|---|
| **X11** | **PASS** | `0` | 24 | **timeout=0 / stable=1** (suite N=1) |
| **Wayland** | **PASS** | `0` | 21 | **timeout=0 / stable=1** (suite N=1) |

`passed:true` JSON from both official scripts. Wrapper `timeout 300` on Wayland was not hit.

Do not waive a known flake from other branches. This folder records **this** official one-shot pair only. N-trial File-click diag (PR #14) was **not** re-run here.

## Git identity

Verified on a clean checkout of the merge commit, immediately after `git checkout -b cursor/desktop-smoke-008dcd16-8518` and **before** this evidence tree was written:

```
$ git rev-parse HEAD
008dcd163fc04008c6c4236f036c4e566ee59106

$ git status --porcelain
# empty
```

| Field | Value |
|---|---|
| `gitSha` | `008dcd163fc04008c6c4236f036c4e566ee59106` |
| `gitDirty` | `false` |
| porcelain byte count | `0` |
| verifiedAtUtc | `2026-10-13T12:16:29Z` |
| commit subject | `Merge pull request #13 from Eveosev/pilotdeck-rust/T-CI-F3-node-test-scan` |
| remote `rust_standalone_alpha1` | `008dcd163fc04008c6c4236f036c4e566ee59106` |

See `git-identity.txt`.

Smoke ran on evidence branch `cursor/desktop-smoke-008dcd16-8518`. Product tree vs the merge SHA is empty:

```
git diff --stat 008dcd163fc04008c6c4236f036c4e566ee59106 -- . ':!review'
# empty
```

## GitHub Actions `Desktop` / `desktop-smoke.yml`

Prefer `workflow_dispatch` on this SHA / `rust_standalone_alpha1`.

| Attempt | HTTP | Body |
|---|---|---|
| `gh workflow run desktop-smoke.yml --ref 008dcd163fc04008c6c4236f036c4e566ee59106` | **403** | `Resource not accessible by integration` (`POST .../actions/workflows/381604437/dispatches`) |
| `gh workflow run Desktop --ref rust_standalone_alpha1` | **403** | same |

`gh run list --commit 008dcd163fc04008c6c4236f036c4e566ee59106` → **no runs**. This merge SHA has no Desktop workflow execution. See `gha/`.

No GHA run id / job conclusion exists for `008dcd16`. Local fallback used.

Context only (not this SHA, not substituted): PR #13 head `4ebfa745754373117da6ed46c522c5d8d74d60ef` Desktop run https://github.com/Eveosev/PilotDeck/actions/runs/38390778145 conclusion `success` (Linux DEB x64/arm64 chrome X11 + Wayland steps success).

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
| X11 | `bash apps/desktop/scripts/run-linux-chrome-smoke.sh x11` | 2026-10-13T12:18:00Z | 2026-10-13T12:18:24Z | **0** | 24 | `run-logs/x11-smoke.txt` | `chrome-screenshots/linux-x11/` (9 PNG) |
| Wayland | `bash apps/desktop/scripts/run-linux-chrome-smoke.sh wayland` | 2026-10-13T12:18:48Z | 2026-10-13T12:19:09Z | **0** | 21 | `run-logs/wayland-smoke.txt` | `chrome-screenshots/linux-wayland/` (9 PNG) |

Script-owned output dir (gitignored): `outputs/desktop-chrome-review/linux-{x11,wayland}/`. Copies live under `chrome-screenshots/` (the repo `.gitignore` entry `artifacts/` would have dropped the original name).

Stdout from each official script:

```
PASS: compact caption and rich About dialog, version copy and project link
{"passed":true,"geometry":{"x":6,"border":"1px","radius":"14px"},"unmappedFixtureEndpoints":["/api/taskmaster/installation-status","/api/agents/runtime-config","/api/commands/list","/api/v1/providers"],"artifactDir":"..."}
```

## Wayland File-click hang (do not waive)

Observed on **this** official one-shot pair:

| | X11 | Wayland | Total |
|---|---|---|---|
| Suite runs | 1 | 1 | 2 |
| Suite pass | 1 | 1 | 2 |
| Suite fail | 0 | 0 | 0 |
| File-click **timeout** | **0** | **0** | **0** |
| File-click **stable** | **1** | **1** | **2** |
| File `.click()` sites completed in a passing suite | 3 | 3 | 6 |
| Wrapper timeout (300s) | n/a | 0 | 0 |

File `.click()` sites that a passing `desktop-chrome.smoke.mjs` must finish: L161 (dark File), L243 (File → New Project), L339 (light File). No Playwright File-click timeout text in `run-logs/wayland-smoke.txt` or `run-logs/wayland-smoke.err.txt`. Screenshots include File popup on both backends (`linux-dark-popup.png`, `linux-light-popup.png`, `linux-light-zh-popup.png`).

This is N=1 per backend, same as CI. It is **not** an N=100/300 File-click rate. See `file-click-counts.txt`. PR #14 (`https://github.com/Eveosev/PilotDeck/pull/14`) is a separate diagnostic branch and is not this SHA.

## Artifact index

- `git-identity.txt` — `gitSha` / `gitDirty=false`
- `host.txt` — OS, Node, weston, xvfb
- `file-click-counts.txt` — hang counts
- `gha/workflow-dispatch-403.txt` — dispatch 403
- `gha/runs-on-008dcd16.txt` — empty run list on this SHA
- `run-logs/x11-*.txt`, `run-logs/wayland-*.txt` — stdout/stderr/meta/vite
- `chrome-screenshots/linux-x11/`, `chrome-screenshots/linux-wayland/`
- `SHA256SUMS.txt`
