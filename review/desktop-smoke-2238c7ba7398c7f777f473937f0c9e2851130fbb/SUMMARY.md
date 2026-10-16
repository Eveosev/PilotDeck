# Desktop chrome smoke @ 2238c7ba7398c7f777f473937f0c9e2851130fbb

证据专用，产品代码未改。issue #14（Wayland File-click hang）**未声称已修复**。每个后端 N=1，不是 N=300 的 relaunch gate。基线是 PR #50+#51 合入后的 `rust_standalone_alpha1` tip（#50 merge `113c16d9`，#51 merge = tip）。相对先前 smoke tip `3f7dd8f7`（post-#48），`apps/desktop` / `ui` / `packages/sdk` / `src` **0 文件变更**；相对 first parent `113c16d9` 为 T-P2-03 stdio perf 证据/工具（13 files, +63153/-1），无桌面 chrome 变更。

## 结果

| backend | exit | seconds | stdout passed | screenshots | file-click timeout | stable | sites |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| X11 | 0 | 25.523 | true | 9 | 0 | 1 | 3 |
| Wayland | 0 | 25.138 | true | 9 | 0 | 1 | 3 |

计数定义同 PR #35（套件级，不按 per-site 日志行）。#35 外层 `timeout 300`，本次 `timeout 600`，均未触发。L161/L243/L339 均为 `per-site log line: absent`。stderr 只有 `org.a11y.Bus` 激活。

## GHA

dispatch `Desktop` workflow (`.github/workflows/desktop-smoke.yml`) 返回 HTTP **422** `Actions has been disabled for this repository`，原文见 `gha/`。改为本地跑官方入口。

## 运行环境

本地 Grok Bot box（Debian 13，Node v20.19.2，Electron 42.11.1，Weston 14.0.2），不是 GitHub runner，也不是 CloudAgent VM。`pnpm compile` 在第一次尝试前完成，一次通过，没有失败的尝试。

## Weston 日志

脚本未改。外部进程在 Wayland 运行期间每 20ms 把 `/tmp/tmp.*/weston.log` 拷到 `weston.log`，赶在 EXIT trap 的 `rm -rf` 之前，过程见 `weston-copy-trace.txt`。

## 未使用的绕行

未加 `--disable-gpu`，无全局节流，未改 `apps/desktop/src/main.ts`（含第 536 行）。
