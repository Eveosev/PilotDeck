# Desktop Linux chrome smoke — merge `008dcd16`

Evidence-only. No product code changes. Hypothesis-free: run and record.

## Git identity

Verified on a clean checkout of the merge commit **before** this evidence tree was written, and re-checked immediately after creating `cursor/desktop-smoke-008dcd16-8518` (still empty porcelain):

| Field | Value |
|---|---|
| `gitSha` | `008dcd163fc04008c6c4236f036c4e566ee59106` |
| `gitDirty` | `false` |
| `git rev-parse HEAD` | `008dcd163fc04008c6c4236f036c4e566ee59106` |
| `git status --porcelain` | empty (0 bytes) |
| verifiedAtUtc | `2026-10-13T12:16:29Z` |
| commit subject | `Merge pull request #13 from Eveosev/pilotdeck-rust/T-CI-F3-node-test-scan` |
| branch containing this SHA | `rust_standalone_alpha1` (remote `008dcd163fc04008c6c4236f036c4e566ee59106`) |

See `git-identity.txt`.

## GitHub Actions `desktop-smoke` / `Desktop` workflow

Prefer `workflow_dispatch` on ref `008dcd16` / `rust_standalone_alpha1`.

| Attempt | Result |
|---|---|
| `gh workflow run desktop-smoke.yml --ref 008dcd163fc04008c6c4236f036c4e566ee59106` | **403** `Resource not accessible by integration` (`POST /repos/Eveosev/PilotDeck/actions/workflows/381604437/dispatches`) |
| `gh workflow run Desktop --ref rust_standalone_alpha1` | **403** (same endpoint) |

`gh run list --commit 008dcd163fc04008c6c4236f036c4e566ee59106` returned **no runs**. This merge SHA has no Desktop workflow execution.

Nearest pre-merge Desktop success on PR #13 head `4ebfa745754373117da6ed46c522c5d8d74d60ef` (not this merge SHA, recorded for context only, not substituted):

- run: https://github.com/Eveosev/PilotDeck/actions/runs/38390778145
- conclusion: `success`
- Linux / DEB x64 chrome X11 step: success
- Linux / DEB x64 chrome Wayland step: success
- Linux / DEB arm64 chrome X11 step: success
- Linux / DEB arm64 chrome Wayland step: success

Fallback: local Linux chrome smoke in this environment, same script entry as CI.

## Local environment (fallback)

| Item | Value |
|---|---|
| OS | Ubuntu 24.04.5 LTS (`noble`), x86_64 |
| CI runner contrast | CI Linux DEB jobs use `ubuntu-22.04` |
| Node used for smoke | v22.23.3 (`~/.nvm/versions/node/v22.23.3/bin/node`) |
| CI Node | 22.23.1 |
| pnpm | 10.32.1 (same as CI) |
| weston | 13.0.0 (`apt` package `weston` 13.0.0-4build3) |
| xvfb | already present (`xvfb` 2:21.1.12-1ubuntu1.8) |
| dbus-x11 / x11-utils / xauth | present (same package set CI installs) |
| install | `pnpm install --frozen-lockfile` exit 0 |
| compile | `pnpm --filter pilotdeck-desktop run compile` exit 0 |

CI-equivalent apt packages installed here:

```
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  dbus-x11 desktop-file-utils weston x11-utils xauth xvfb
```

## Local smoke commands (same entry as CI)

```
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"
export PILOTDECK_CHROME_NODE_BINARY="$HOME/.nvm/versions/node/v22.23.3/bin/node"
bash apps/desktop/scripts/run-linux-chrome-smoke.sh x11
bash apps/desktop/scripts/run-linux-chrome-smoke.sh wayland
```

Results below are filled after the runs. Placeholder until then:

| Backend | Command | Exit | Duration | File-click | Artifacts |
|---|---|---|---|---|---|
| X11 | `bash apps/desktop/scripts/run-linux-chrome-smoke.sh x11` | PENDING | PENDING | PENDING | `logs/x11-smoke.txt`, `artifacts/linux-x11/` |
| Wayland | `bash apps/desktop/scripts/run-linux-chrome-smoke.sh wayland` | PENDING | PENDING | PENDING | `logs/wayland-smoke.txt`, `artifacts/linux-wayland/` |

## Wayland File-click hang

Do not waive. Record actual counts from this run (stable vs timeout). Pending execution.
