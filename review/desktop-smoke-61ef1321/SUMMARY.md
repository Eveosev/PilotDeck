# Desktop Linux chrome smoke — merge `61ef1321` (post-#16)

Evidence-only. No product code changes. Hypothesis-free: commands, exit codes, artifact paths, File-click counts.

Post-#16 merge smoke on `rust_standalone_alpha1` tip. This folder records **this** official N=1 one-shot pair only. It does not claim the #14 Wayland File-click hang is fixed beyond what this smoke shows.

## Result

| Backend | Result | Exit | Seconds | File-click hang |
|---|---|---|---|---|
| **X11** | **PASS** | `0` | 26 | **timeout=0 / stable=1** (suite N=1) |
| **Wayland** | **PASS** | `0` | 21 | **timeout=0 / stable=1** (suite N=1) |

`passed:true` JSON from both official scripts. Wrapper `timeout 300` on Wayland was not hit.

**PR targeting:** head `cursor/desktop-smoke-61ef1321-bfaf` is rooted at `61ef1321`. Base **must** be `rust_standalone_alpha1` (same SHA). A `main` base is wrong and inflates the diff. After retarget, the PR adds only `review/desktop-smoke-61ef1321/**`.

## Git identity

Verified on a clean checkout of the merge commit, immediately after `git checkout -b cursor/desktop-smoke-61ef1321-bfaf` and **before** this evidence tree was written:

```
$ git rev-parse HEAD
61ef132170b642fecf7e0acaf65b8f121319a651

$ git log -1 --format='%P %s'
008dcd163fc04008c6c4236f036c4e566ee59106 a1a114bb9ec809b594373788fef62a33c85a0ca7 fix(desktop): Linux Wayland File-click hang (#16)

$ git status --porcelain
# empty
```

| Field | Value |
|---|---|
| `gitSha` | `61ef132170b642fecf7e0acaf65b8f121319a651` |
| `gitDirty` | `false` |
| porcelain byte count | `0` |
| verifiedAtUtc | `2026-10-13T18:34:20Z` |
| commit subject | `fix(desktop): Linux Wayland File-click hang (#16)` |
| parents | `008dcd16` (previous `rust_standalone_alpha1` tip) + `a1a114bb` (#16 tip) |
| remote `rust_standalone_alpha1` | `61ef132170b642fecf7e0acaf65b8f121319a651` |

See `git-identity.txt`.

Smoke ran on evidence branch `cursor/desktop-smoke-61ef1321-bfaf`. Product tree vs the merge SHA is empty:

```
git diff --stat 61ef132170b642fecf7e0acaf65b8f121319a651 -- . ':!review'
# empty
```

## GitHub Actions `Desktop` / `desktop-smoke.yml`

Prefer `workflow_dispatch` on this SHA / `rust_standalone_alpha1`.

| Attempt | HTTP | Body |
|---|---|---|
| `gh workflow run Desktop --ref rust_standalone_alpha1` | **403** | `Resource not accessible by integration` (`POST .../actions/workflows/381604437/dispatches`) |
| `gh workflow run desktop-smoke.yml --ref 61ef132170b642fecf7e0acaf65b8f121319a651` | **403** | same |

`gh run list --commit 61ef132170b642fecf7e0acaf65b8f121319a651` → **no runs**. This merge SHA has no Desktop workflow execution. See `gha/`.

No GHA run id / job conclusion exists for `61ef1321`. Local fallback used.

Context only (not this SHA, not substituted): #16 pre-merge Desktop C-gate on tip `28dec7cd` https://github.com/Eveosev/PilotDeck/actions/runs/38430172657 and harness tip `a1a114bb` https://github.com/Eveosev/PilotDeck/actions/runs/38442265035. Those are N=300/100 File-click C gates, not this official N=1 chrome smoke.

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
| X11 | `bash apps/desktop/scripts/run-linux-chrome-smoke.sh x11` | 2026-10-13T18:35:34Z | 2026-10-13T18:36:00Z | **0** | 26 | `run-logs/x11-smoke.txt` | `chrome-screenshots/linux-x11/` (9 PNG) |
| Wayland | `bash apps/desktop/scripts/run-linux-chrome-smoke.sh wayland` | 2026-10-13T18:36:06Z | 2026-10-13T18:36:27Z | **0** | 21 | `run-logs/wayland-smoke.txt` | `chrome-screenshots/linux-wayland/` (9 PNG) |

Script-owned output dir (gitignored): `outputs/desktop-chrome-review/linux-{x11,wayland}/`. Copies live under `chrome-screenshots/` (the repo `.gitignore` entry `artifacts/` would have dropped the original name).

Stdout from each official script:

```
PASS: compact caption and rich About dialog, version copy and project link
{"passed":true,"geometry":{"x":6,"border":"1px","radius":"14px"},"unmappedFixtureEndpoints":["/api/taskmaster/installation-status","/api/agents/runtime-config","/api/commands/list","/api/v1/providers"],"artifactDir":"..."}
```

## File-click counts (official N=1)

Observed on **this** official one-shot pair after #16 merged:

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

This is N=1 per backend, same as the official chrome smoke entry. It is **not** the C-group N=100/300 File-click gate. See `file-click-counts.txt`.

Association: post-merge of [#16](https://github.com/Eveosev/PilotDeck/pull/16) (`fix(desktop): Linux Wayland File-click hang`). #14 remains a separate diagnostic branch. This 61ef1321 official one-shot recorded File-click timeout=0 / stable=1 per backend. That is what the smoke shows; it is not a C-gate rate and does not replace #14.

## Artifact index

- `git-identity.txt` — `gitSha` / `gitDirty=false`
- `host.txt` — OS, Node, weston, xvfb
- `file-click-counts.txt` — hang counts
- `gha/workflow-dispatch-403.txt` — dispatch 403
- `gha/runs-on-61ef1321.txt` — empty run list on this SHA
- `run-logs/x11-*.txt`, `run-logs/wayland-*.txt` — stdout/stderr/meta/vite
- `chrome-screenshots/linux-x11/`, `chrome-screenshots/linux-wayland/`
- `SHA256SUMS.txt`
