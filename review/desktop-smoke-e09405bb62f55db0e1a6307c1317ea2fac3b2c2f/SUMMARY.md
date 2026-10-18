# Desktop chrome smoke @ e09405bb62f55db0e1a6307c1317ea2fac3b2c2f

证据专用，产品代码未改。issue #14（Wayland File-click hang）**未声称已修复**。每个后端 N=1，不是 N=300 的 relaunch gate。基线是 PR #68 合入后的 `rust_standalone_alpha1` tip（#68 merge = tip `e09405bb`，merged_by `Eveosev`（Payne_Wu），merged_at 2026-10-18 19:58:38 CST；first parent `bfd397f5`；head tip `28ce5bb8`）。相对先前 smoke tip `bfd397f5`（post-#66），`apps/desktop` / `ui` / `packages` / `crates` **0 文件变更**；相对 first parent `bfd397f5` 为 docs-only（3 files changed, 49 insertions(+), 6 deletions(-)，仅 `docs/rust_rebuild/PLAN.md` + `review/2026-10-18-T-PC1-3-close/`），无桌面 chrome 变更。默认 native transport，未开 sidecar opt-in。

## 结果

| backend | exit | seconds | stdout passed | screenshots | file-click timeout | stable | sites |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| X11 | 0 | 27.900 | true | 9 | 0 | 1 | 3 |
| Wayland | 0 | 25.953 | true | 9 | 0 | 1 | 3 |

计数定义同 PR #35（套件级，不按 per-site 日志行）。#35 外层 `timeout 300`，本次 `timeout 600`，均未触发。L161/L243/L339 均为 `per-site log line: absent`。stderr 两个后端均为空（0B）。

## 与 post-#66（`bfd397f5`）对比

| backend | post-#66 | post-#68 | Δ |
| --- | ---: | ---: | ---: |
| X11 | 26.849 | 27.900 | +1.051s（+3.9%） |
| Wayland | 23.456 | 25.953 | +2.497s（+10.6%） |

差异在 N=1 噪声范围内，不判为回归。9 张截图文件名一致；入口脚本与 `ui/e2e/desktop-chrome.smoke.mjs` 的 sha256 与上一轮相同（`3861251e64560eb9868d0c042b884b6e41ee831f0716af6022ed9ef3b4cd3825` / `89e6f1860250c5b8399aff79ae469e93580b8b1bdeb2b532c051281fe23bf130`）。

## GHA

dispatch `Desktop` workflow (`.github/workflows/desktop-smoke.yml`) 返回 HTTP **422** `Actions has been disabled for this repository`，原文见 `gha/`。改为本地跑官方入口。

## 运行环境

本地 Grok Bot box（Debian 13，Node v20.19.2，Weston 14.0.2），不是 GitHub runner，也不是 CloudAgent VM。`make` / `g++` / `weston` 已从 post-#60/#62/#64/#66 那轮 apt 保留。本轮将 `fs.inotify.max_user_watches` 提到 1048576（共享 box 上多 worktree 导致 ENOSPC；抬高后本证据跑 X11/Wayland 各一次成功）。`pnpm install --frozen-lockfile` 与 `pnpm compile`（`apps/desktop`）一次通过（`pnpm-install-compile.log`；node_modules 自 wt-smoke-bfd397f5 hardlink，lockfile 一致）。smoke 本身每个后端只跑了一次，没有产品失败重跑。

## Weston 日志

脚本未改。外部进程在 Wayland 运行期间每 20ms 把 `/tmp/tmp.*/weston.log` 拷到 `weston.log`，赶在 EXIT trap 的 `rm -rf` 之前，过程见 `weston-copy-trace.txt`。最终 `weston.log` 1921B（与上一轮相同）。

## 未使用的绕行

未加 `--disable-gpu`，无全局节流，未改 `apps/desktop/src/main.ts`（含第 536 行）。
