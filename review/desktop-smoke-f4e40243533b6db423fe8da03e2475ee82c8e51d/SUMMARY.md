# Desktop Linux chrome smoke — merge `f4e40243` (post-#32)

Evidence-only. **Do not merge.** Draft. No product / `src` / `ui` / `apps` changes.

Post-#32 merge smoke on `rust_standalone_alpha1` tip `f4e40243533b6db423fe8da03e2475ee82c8e51d`. Ancestors include tip `bbe50045` and prior `f376b4a5`. This folder records **this** official N=1 one-shot pair only. It does **not** claim the #14 Wayland File-click hang is fixed.

`gitSha` = `f4e40243533b6db423fe8da03e2475ee82c8e51d`. `gitDirty` = `false`.

## Result

| Backend | Result | Exit | Seconds | File-click (official N=1) |
|---|---|---|---|---|
| **X11** | **PASS** | `0` | 25 | timeout=0, stable=1, N=1 |
| **Wayland** | **PASS** | `0` | 21 | timeout=0, stable=1, N=1 |

`passed:true` JSON from both official scripts. Wrapper `timeout 300` on Wayland was not hit.

**PR targeting:** head `cursor/desktop-smoke-f4e40243-97b1` is rooted at `f4e40243`. Base **must** be `rust_standalone_alpha1` (same SHA). A `main` base is wrong and inflates the diff. After retarget, the PR adds only `review/desktop-smoke-f4e40243533b6db423fe8da03e2475ee82c8e51d/**`.

## Git identity

Verified on a clean checkout of the merge commit, immediately after `git checkout -b cursor/desktop-smoke-f4e40243-97b1 f4e40243533b6db423fe8da03e2475ee82c8e51d` and **before** this evidence tree was written:

```
$ git fetch origin rust_standalone_alpha1
$ git checkout -b cursor/desktop-smoke-f4e40243-97b1 f4e40243533b6db423fe8da03e2475ee82c8e51d
$ git rev-parse f4e40243533b6db423fe8da03e2475ee82c8e51d
f4e40243533b6db423fe8da03e2475ee82c8e51d

$ git rev-parse HEAD
f4e40243533b6db423fe8da03e2475ee82c8e51d

$ git log -1 --format='%P %s'
f376b4a5b6c487367a9671ddb47fd2fefe9eba8a bbe50045c3270abc3c153bc6dd2dfa480889c68a Merge pull request #32 from Eveosev/cursor/t-p1-03-fu-b-37eb

$ git status --porcelain
# empty (porcelain byte count 0)
```

| Field | Value |
|---|---|
| `gitSha` | `f4e40243533b6db423fe8da03e2475ee82c8e51d` |
| `gitDirty` | `false` |
| porcelain byte count | `0` |
| verifiedAtUtc | `2026-10-15T01:50:21Z` |
| commit subject | `Merge pull request #32 from Eveosev/cursor/t-p1-03-fu-b-37eb` |
| parents | `f376b4a5` (previous `rust_standalone_alpha1` tip / post-#30) + `bbe50045` (#32 tip) |
| remote `rust_standalone_alpha1` | `f4e40243533b6db423fe8da03e2475ee82c8e51d` |

See `git-identity.txt`, `summary.json`, and `provenance.json`.

Smoke ran on evidence branch `cursor/desktop-smoke-f4e40243-97b1`. Product tree vs the merge SHA is empty:

```
git diff --stat f4e40243533b6db423fe8da03e2475ee82c8e51d -- . ':!review'
# empty
```

No `main.ts:536` workaround, global throttle, `--disable-gpu`, or any product source change.

## GitHub Actions `Desktop` / `desktop-smoke.yml`

Prefer `workflow_dispatch` on this SHA / `rust_standalone_alpha1`. Same 403 fallback as prior #17 / #19 / #22 / #23 / #25 / #27 / #29 / #31.

| Attempt | HTTP | Body |
|---|---|---|
| `gh workflow run Desktop --ref rust_standalone_alpha1` | **403** | `Resource not accessible by integration` (`POST .../actions/workflows/381604437/dispatches`) |
| `gh workflow run desktop-smoke.yml --ref rust_standalone_alpha1` | **403** | same |
| `gh workflow run desktop-smoke.yml --ref f4e40243533b6db423fe8da03e2475ee82c8e51d` | **403** | same |

`gh run list --commit f4e40243533b6db423fe8da03e2475ee82c8e51d` → **no runs**. This merge SHA has no Desktop workflow execution. See `gha/`.

No GHA run id / job conclusion exists for `f4e40243`. **Local fallback used** (same as #17 / #19 / #22 / #23 / #25 / #27 / #29 / #31): official scripts ran in this cloud VM.

Context only (not this SHA, not substituted): prior post-#30 evidence is #31 on `f376b4a5`. Those results are not reused here. #14 remains a separate diagnostic branch; this post-merge smoke does not claim that hang is fixed.

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

Wayland was wrapped with `timeout --preserve-status --signal=TERM --kill-after=30s 300` so a File-click stall would be recorded as exit 124 rather than an unbounded hang. It was not needed. Official script exit code is what counts.

| Backend | Command | Start UTC | End UTC | Exit | Seconds | Log | Screenshots |
|---|---|---|---|---|---|---|---|
| X11 | `bash apps/desktop/scripts/run-linux-chrome-smoke.sh x11` | 2026-10-15T01:51:15Z | 2026-10-15T01:51:40Z | **0** | 25 | `smoke-x11.log` | `chrome-screenshots/linux-x11/` (9 PNG) |
| Wayland | `bash apps/desktop/scripts/run-linux-chrome-smoke.sh wayland` | 2026-10-15T01:51:50Z | 2026-10-15T01:52:11Z | **0** | 21 | `smoke-wayland.log` | `chrome-screenshots/linux-wayland/` (9 PNG) |

Script-owned output dir (gitignored): `outputs/desktop-chrome-review/linux-{x11,wayland}/`. Copies live under `chrome-screenshots/` (the repo `.gitignore` entry `outputs/desktop-chrome-review/` would drop the originals).

Weston headless log was copied from the official script's temp `XDG_RUNTIME_DIR` while the script was still running (`weston.log`). Command line:

```
weston --backend=headless-backend.so --socket=wayland-pilotdeck-chrome --no-config --idle-time=0 --width=1440 --height=900
```

Stdout from each official script:

```
PASS: compact caption and rich About dialog, version copy and project link
{"passed":true,"geometry":{"x":6,"border":"1px","radius":"14px"},"unmappedFixtureEndpoints":["/api/taskmaster/installation-status","/api/agents/runtime-config","/api/commands/list","/api/v1/providers"],"artifactDir":"..."}
```

## File-click counts (official N=1)

Observed on **this** official one-shot pair after #32 merged:

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

Association: post-merge of [#32](https://github.com/Eveosev/PilotDeck/pull/32) into `rust_standalone_alpha1`. #14 remains a separate diagnostic branch. This `f4e40243` official one-shot recorded File-click timeout=0 / stable=1 per backend. That is what the smoke shows; it is not a C-gate rate and does not claim the #14 hang is fixed.

## Anomalies

1. **Host vs CI:** Ubuntu 24.04 + Node 22.23.3 locally; CI DEB jobs use Ubuntu 22.04 + Node 22.23.1. Same as prior local fallbacks (#17 / #19 / #22 / #23 / #25 / #27 / #29 / #31).
2. **GHA:** `workflow_dispatch` 403; no Actions run on this SHA. Local official scripts used. No GHA run id invented.
3. **Fonts:** headless environment lacks a full Chinese font set; glyph acceptance is visual-only on a full GNOME session (same limitation as `docs/ubuntu-desktop-support.md`).
4. **#14:** not claimed fixed. This is official chrome smoke N=1, not the Wayland File-click C-group N=300 diagnostic.

## Artifact index

- `SUMMARY.md` — this file
- `summary.json` — `gitSha` / `gitDirty=false` / per-mode result / exit codes / timestamps
- `provenance.json` — same identity plus host / GHA / commands
- `git-identity.txt` — identity captured before evidence writes
- `host.txt` — OS, Node, weston, xvfb
- `file-click-counts.txt` — hang counts
- `gha/workflow-dispatch-403.txt` — dispatch 403
- `gha/runs-on-f4e40243.txt` — empty run list on this SHA
- `smoke-x11.log`, `smoke-wayland.log` — combined full logs (meta + stdout + stderr + vite; Wayland also embeds weston)
- `weston.log` — weston headless compositor log
- `run-logs/x11-*.txt`, `run-logs/wayland-*.txt`, `run-logs/weston.log` — split stdout/stderr/meta/vite/weston
- `chrome-screenshots/linux-x11/`, `chrome-screenshots/linux-wayland/`
- `SHA256SUMS.txt`
