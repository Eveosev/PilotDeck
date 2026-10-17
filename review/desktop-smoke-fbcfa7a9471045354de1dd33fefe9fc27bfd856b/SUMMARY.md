# Desktop chrome smoke @ fbcfa7a9471045354de1dd33fefe9fc27bfd856b

证据专用，产品代码未改。issue #14（Wayland File-click hang）**未声称已修复**。每个后端 N=1，不是 N=300 的 relaunch gate。基线是 PR #60 合入后的 `rust_standalone_alpha1` tip（#60 merge = tip `fbcfa7a9`，merged_by `Eveosev`（Payne_Wu），merged_at 2026-10-17 20:46:59 CST；first parent `d21eb126`；head tip `31a462e6`）。相对先前 smoke tip `d21eb126`（post-#58），`apps/desktop` / `ui` / `packages` **0 文件变更**；相对 first parent `d21eb126` 为 T-P2-08 G-CI（33 files changed, 3611 insertions(+), 218 deletions(-)，集中 `.github/workflows` + `scripts/ci` + `crates/pilotdeck-agent-loop*`（6 files，342+/198-）+ `docs/rust_rebuild/PLAN.md` + `review/2026-10-17-T-P2-08`），无桌面 chrome 变更。默认 native transport，未开 sidecar opt-in。

## 结果

| backend | exit | seconds | stdout passed | screenshots | file-click timeout | stable | sites |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| X11 | 0 | 26.078 | true | 9 | 0 | 1 | 3 |
| Wayland | 0 | 23.206 | true | 9 | 0 | 1 | 3 |

计数定义同 PR #35（套件级，不按 per-site 日志行）。#35 外层 `timeout 300`，本次 `timeout 600`，均未触发。L161/L243/L339 均为 `per-site log line: absent`。stderr 两个后端均为空（0B）；上一轮的 `org.a11y.Bus` 激活行这次没出现，原因是 box 重装后环境不同（见下），不是脚本改动。

## 与 post-#58（`d21eb126`）对比

| backend | post-#58 | post-#60 | Δ |
| --- | ---: | ---: | ---: |
| X11 | 26.232 | 26.078 | −0.154s（−0.6%） |
| Wayland | 22.620 | 23.206 | +0.586s（+2.6%） |

差异在 N=1 噪声范围内，不判为回归。9 张截图文件名一致，字节数与上一轮相差 <1%（`linux-settings.png`、`linux-light-popup.png` 两轮字节完全相同）。入口脚本与 `ui/e2e/desktop-chrome.smoke.mjs` 的 sha256 与上一轮相同。

## GHA

dispatch `Desktop` workflow (`.github/workflows/desktop-smoke.yml`) 返回 HTTP **422** `Actions has been disabled for this repository`，原文见 `gha/`。仓库最近一次 Actions run 仍是 2026-10-15 02:40:50 CST。改为本地跑官方入口。

## 运行环境

本地 Grok Bot box（Debian 13，Node v20.19.2，Weston 14.0.2），不是 GitHub runner，也不是 CloudAgent VM。本轮开始时 box 已被重装（内核构建日期变了，pnpm store 为空，`make`/`g++`/`weston` 都没装）。第一次 `pnpm install --frozen-lockfile` 因缺 `make`，better-sqlite3 / node-pty 的 node-gyp 编译失败（原文 `pnpm-install-attempt1-failed-no-make.log`）。在 box 上 `apt-get install make g++ weston` 之后，第二次 install 和 `pnpm compile`（`apps/desktop`）都通过（`pnpm-install-compile.log`）。两次 install 都在任何 smoke 尝试之前；smoke 本身每个后端只跑了一次，没有失败重跑。

## Weston 日志

脚本未改。外部进程在 Wayland 运行期间每 20ms 把 `/tmp/tmp.*/weston.log` 拷到 `weston.log`，赶在 EXIT trap 的 `rm -rf` 之前，过程见 `weston-copy-trace.txt`。最终 `weston.log` 1921B（与上一轮相同）。

## 未使用的绕行

未加 `--disable-gpu`，无全局节流，未改 `apps/desktop/src/main.ts`（含第 536 行）。
