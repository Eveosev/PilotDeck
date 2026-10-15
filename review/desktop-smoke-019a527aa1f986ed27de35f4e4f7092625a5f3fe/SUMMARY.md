# Desktop chrome smoke @ 019a527aa1f986ed27de35f4e4f7092625a5f3fe

证据专用，产品代码未改。issue #14（Wayland File-click hang）**未声称已修复**。每个后端 N=1，不是 N=300 的 relaunch gate。基线是 PR #40（FT-1）的合并提交，分支 `rust_standalone_alpha1`。

## 结果

| backend | exit | seconds | stdout passed | screenshots | file-click timeout | stable | sites |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| X11 | 0 | 21.674 | true | 9 | 0 | 1 | 3 |
| Wayland | 0 | 25.751 | true | 9 | 0 | 1 | 3 |

计数定义同 PR #35（套件级，不按 per-site 日志行）。#35 外层 `timeout 300`，本次 `timeout 600`，均未触发。L161/L243/L339 均为 `per-site log line: absent`。stderr 只有 `org.a11y.Bus` 激活。

## GHA

dispatch `Desktop` workflow 返回 HTTP **422** `Actions has been disabled for this repository`（不是 403），原文见 `gha/`。因此按约定改为本地跑官方入口。

## 运行环境与异常

- 本地 Grok Bot box（Debian 13，Node v20.19.2 而非 CI 的 22，Electron 42.11.1，Weston 14.0.2），不是 GitHub runner，也不是 CloudAgent VM。
- 第一次尝试（attempt0）两个后端都在 `firstWindow` 30s 超时失败：worktree 没有编译 `apps/desktop/dist`。`pnpm compile` 后重跑，两个后端都通过。attempt0 原始输出保留在 `attempt0-precompile/`，不计入结果。

## Weston 日志

脚本未改。外部进程在 Wayland 运行期间每 20ms 把 `/tmp/tmp.*/weston.log` 拷到 `weston.log`，赶在 EXIT trap 的 `rm -rf` 之前，过程见 `weston-copy-trace.txt`。

## 未使用的绕行

未加 `--disable-gpu`，无全局节流，未改 `apps/desktop/src/main.ts`（含第 536 行）。
