# Desktop Linux chrome smoke — merge `1d15a130` (post-#20)

Evidence-only. **Do not merge.** Draft. No product / `src` / `ui` / `apps` changes.

Post-#20 merge smoke on `rust_standalone_alpha1` tip `1d15a13033aeb57f2740b3677e13281cc5f9036d`. This folder records **this** official N=1 one-shot pair only. It does **not** claim the #14 Wayland File-click hang is fixed.

`gitSha` = `1d15a13033aeb57f2740b3677e13281cc5f9036d`. `gitDirty` = `false`.

## Result

| Backend | Result | Exit | Seconds | File-click (official N=1) |
|---|---|---|---|---|
| **X11** | **PASS** | `0` | 26 | timeout=0, stable=1, N=1 |
| **Wayland** | **PASS** | `0` | 23 | timeout=0, stable=1, N=1 |

`passed:true` JSON from both official scripts. Wrapper `timeout 300` on Wayland was not hit.

**PR targeting:** head `cursor/desktop-smoke-1d15a130-6e62` is rooted at `1d15a130`. Base **must** be `rust_standalone_alpha1` (same SHA). A `main` base is wrong and inflates the diff. After retarget, the PR adds only `review/desktop-smoke-1d15a130/**`.

## Git identity

Verified on a clean checkout of the merge commit, immediately after `git checkout -b cursor/desktop-smoke-1d15a130-6e62` and **before** this evidence tree was written:

```
$ git rev-parse HEAD
1d15a13033aeb57f2740b3677e13281cc5f9036d

$ git log -1 --format='%P %s'
0db122b3b60b638b01edd45fe8650fcd9d4eeb8e 74b6facbb749326c9fc763a2e2853c08f60c6069 Merge pull request #20 from Eveosev/cursor/t-p1-02-harness-9da3

$ git status --porcelain
# empty (porcelain byte count 0)
```

| Field | Value |
|---|---|
| `gitSha` | `1d15a13033aeb57f2740b3677e13281cc5f9036d` |
| `gitDirty` | `false` |
| porcelain byte count | `0` |
| verifiedAtUtc | `2026-10-14T06:06:54Z` |
| commit subject | `Merge pull request #20 from Eveosev/cursor/t-p1-02-harness-9da3` |
| parents | `0db122b3` (previous `rust_standalone_alpha1` tip / post-#18) + `74b6facb` (#20 tip) |
| remote `rust_standalone_alpha1` | `1d15a13033aeb57f2740b3677e13281cc5f9036d` |

See `git-identity.txt`, `summary.json`, and `provenance.json`.

Smoke ran on evidence branch `cursor/desktop-smoke-1d15a130-6e62`. Product tree vs the merge SHA is empty:

```
git diff --stat 1d15a13033aeb57f2740b3677e13281cc5f9036d -- . ':!review'
# empty
```

## GitHub Actions `Desktop` / `desktop-smoke.yml`

Prefer `workflow_dispatch` on this SHA / `rust_standalone_alpha1`. Same 403 fallback as prior #17 / #19.

| Attempt | HTTP | Body |
|---|---|---|
| `gh workflow run Desktop --ref rust_standalone_alpha1` | **403** | `Resource not accessible by integration` (`POST .../actions/workflows/381604437/dispatches`) |
| `gh workflow run desktop-smoke.yml --ref 1d15a13033aeb57f2740b3677e13281cc5f9036d` | **403** | same |

`gh run list --commit 1d15a13033aeb57f2740b3677e13281cc5f9036d` → **no runs**. This merge SHA has no Desktop workflow execution. See `gha/`.

No GHA run id / job conclusion exists for `1d15a130`. **Local fallback used** (same as #17 / #19): official scripts ran in this cloud VM.

Context only (not this SHA, not substituted): prior post-#18 evidence is #19 on `0db122b3`. Those results are not reused here. #14 remains a separate diagnostic branch; this post-merge smoke does not claim that hang is fixed.

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
| X11 | `bash apps/desktop/scripts/run-linux-chrome-smoke.sh x11` | 2026-10-14T06:07:40Z | 2026-10-14T06:08:06Z | **0** | 26 | `smoke-x11.log` | `chrome-screenshots/linux-x11/` (9 PNG) |
| Wayland | `bash apps/desktop/scripts/run-linux-chrome-smoke.sh wayland` | 2026-10-14T06:08:19Z | 2026-10-14T06:08:42Z | **0** | 23 | `smoke-wayland.log` | `chrome-screenshots/linux-wayland/` (9 PNG) |

Script-owned output dir (gitignored): `outputs/desktop-chrome-review/linux-{x11,wayland}/`. Copies live under `chrome-screenshots/` (the repo `.gitignore` entry `outputs/desktop-chrome-review/` would drop the originals).

Stdout from each official script:

```
PASS: compact caption and rich About dialog, version copy and project link
{"passed":true,"geometry":{"x":6,"border":"1px","radius":"14px"},"unmappedFixtureEndpoints":["/api/taskmaster/installation-status","/api/agents/runtime-config","/api/commands/list","/api/v1/providers"],"artifactDir":"..."}
```

## File-click counts (official N=1)

Observed on **this** official one-shot pair after #20 merged:

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

Association: post-merge of [#20](https://github.com/Eveosev/PilotDeck/pull/20) into `rust_standalone_alpha1`. #14 remains a separate diagnostic branch. This 1d15a130 official one-shot recorded File-click timeout=0 / stable=1 per backend. That is what the smoke shows; it is not a C-gate rate and does not claim the #14 hang is fixed.

## Artifact index

- `SUMMARY.md` — this file
- `summary.json` — `gitSha` / `gitDirty=false` / per-mode result / exit codes / timestamps
- `provenance.json` — same identity plus host / GHA / commands
- `git-identity.txt` — identity captured before evidence writes
- `host.txt` — OS, Node, weston, xvfb
- `file-click-counts.txt` — hang counts
- `gha/workflow-dispatch-403.txt` — dispatch 403
- `gha/runs-on-1d15a130.txt` — empty run list on this SHA
- `smoke-x11.log`, `smoke-wayland.log` — combined full logs (meta + stdout + stderr + vite)
- `run-logs/x11-*.txt`, `run-logs/wayland-*.txt` — split stdout/stderr/meta/vite
- `chrome-screenshots/linux-x11/`, `chrome-screenshots/linux-wayland/`
- `SHA256SUMS.txt`
