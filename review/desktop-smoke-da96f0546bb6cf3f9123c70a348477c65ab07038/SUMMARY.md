# Desktop chrome smoke @ da96f0546bb6cf3f9123c70a348477c65ab07038

证据专用，产品代码未改。issue #14（Wayland File-click hang）**未声称已修复**。每个后端 N=1，不是 N=300 的 relaunch gate。基线是 PR #62 合入后的 `rust_standalone_alpha1` tip（#62 merge = tip `da96f054`，merged_by `Eveosev`（Payne_Wu），merged_at 2026-10-18 07:16:26 CST；first parent `fbcfa7a9`；head tip `f71bd5a7`）。相对先前 smoke tip `fbcfa7a9`（post-#60），`apps/desktop` / `ui` / `packages` / `crates` **0 文件变更**；相对 first parent `fbcfa7a9` 为 T-P2-01-D2（28 files changed, 3983 insertions(+), 28 deletions(-)，集中 `tools/agent-loop-{parity,perf}` + `docs/rust_rebuild/PLAN.md` + `evidence/p1/go-nogo.md` + `review/2026-10-17-T-P2-01-D2`），无桌面 chrome 变更。默认 native transport，未开 sidecar opt-in。

## 结果

| backend | exit | seconds | stdout passed | screenshots | file-click timeout | stable | sites |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| X11 | 0 | 25.348 | true | 9 | 0 | 1 | 3 |
| Wayland | 0 | 25.202 | true | 9 | 0 | 1 | 3 |

计数定义同 PR #35（套件级，不按 per-site 日志行）。#35 外层 `timeout 300`，本次 `timeout 600`，均未触发。L161/L243/L339 均为 `per-site log line: absent`。stderr 两个后端均为空（0B）。

## 与 post-#60（`fbcfa7a9`）对比

| backend | post-#60 | post-#62 | Δ |
| --- | ---: | ---: | ---: |
| X11 | 26.078 | 25.348 | −0.730s（−2.8%） |
| Wayland | 23.206 | 25.202 | +1.996s（+8.6%） |

差异在 N=1 噪声范围内，不判为回归。9 张截图文件名一致；`linux-settings.png` / `linux-light-popup.png`（两后端）及若干 popup 字节与上一轮完全相同，其余相差 <1%。入口脚本与 `ui/e2e/desktop-chrome.smoke.mjs` 的 sha256 与上一轮相同。

## GHA

dispatch `Desktop` workflow (`.github/workflows/desktop-smoke.yml`) 返回 HTTP **422** `Actions has been disabled for this repository`，原文见 `gha/`。改为本地跑官方入口。

## 运行环境

本地 Grok Bot box（Debian 13，Node v20.19.2，Weston 14.0.2），不是 GitHub runner，也不是 CloudAgent VM。`make` / `g++` / `weston` 已从 post-#60 那轮 apt 保留，本轮无需重装。`pnpm install --frozen-lockfile` 与 `pnpm compile`（`apps/desktop`）一次通过（`pnpm-install-compile.log`）。smoke 本身每个后端只跑了一次，没有失败重跑。

## Weston 日志

脚本未改。外部进程在 Wayland 运行期间每 20ms 把 `/tmp/tmp.*/weston.log` 拷到 `weston.log`，赶在 EXIT trap 的 `rm -rf` 之前，过程见 `weston-copy-trace.txt`。最终 `weston.log` 1921B（与上一轮相同）。

## 未使用的绕行

未加 `--disable-gpu`，无全局节流，未改 `apps/desktop/src/main.ts`（含第 536 行）。
