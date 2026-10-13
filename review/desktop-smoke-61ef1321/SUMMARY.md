# Desktop Linux chrome smoke — merge `61ef1321` (post-#16)

Evidence-only. No product code changes. Hypothesis-free: commands, exit codes, artifact paths, File-click counts.

Post-#16 merge smoke on `rust_standalone_alpha1` tip. This folder records **this** official N=1 one-shot pair only. It does not claim the #14 Wayland File-click hang is fixed beyond what this smoke shows.

## Result

Smoke not yet recorded. Official local fallback pending after `workflow_dispatch` 403.

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

## GitHub Actions `Desktop` / `desktop-smoke.yml`

Prefer `workflow_dispatch` on this SHA / `rust_standalone_alpha1`.

| Attempt | HTTP | Body |
|---|---|---|
| `gh workflow run Desktop --ref rust_standalone_alpha1` | **403** | `Resource not accessible by integration` (`POST .../actions/workflows/381604437/dispatches`) |
| `gh workflow run desktop-smoke.yml --ref 61ef132170b642fecf7e0acaf65b8f121319a651` | **403** | same |

`gh run list --commit 61ef132170b642fecf7e0acaf65b8f121319a651` → **no runs**. This merge SHA has no Desktop workflow execution. See `gha/`.

No GHA run id / job conclusion exists for `61ef1321`. Local fallback will be used.

## Next

Run official N=1 entry scripts (not C-group N=300):

```
bash apps/desktop/scripts/run-linux-chrome-smoke.sh x11
bash apps/desktop/scripts/run-linux-chrome-smoke.sh wayland
```
