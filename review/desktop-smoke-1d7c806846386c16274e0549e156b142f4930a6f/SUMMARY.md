# Desktop chrome smoke @ 1d7c806846386c16274e0549e156b142f4930a6f

证据专用。产品代码未改。issue #14（Wayland File-click hang）**未声称已修复**。每个后端 N=1，不是 file-click relaunch gate（该门禁 Wayland 为 N=300）。

基线是 PR #37 的合并提交，分支 `rust_standalone_alpha1`，HEAD 以 `1d7c8068` 开头。

## 结果

| backend | exit | seconds | stdout passed | screenshots | file-click timeout | file-click stable | sites |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| X11 | 0 | 22.875 | true | 9 | 0 | 1 | 3 |
| Wayland | 0 | 21.345 | true | 9 | 0 | 1 | 3 |

计数定义与 PR #35（smoke @30883a13，同一入口 `run-linux-chrome-smoke.sh`，N=1）相同，**不是**按每个 File.click 的日志行计算，也**不是** relaunch gate。套件通过，且 stdout/stderr 里没有 Playwright 对 File 的超时，且外层 timeout 没有杀掉进程，则 `file_click_timeout=0`、`file_click_stable=1`、`file_click_sites_completed=3`。#35 的外层是 `timeout 300`；这次外层是 `timeout 600`，两次都没触发（exit 0）。

X11 `basis`：`x11-smoke.out.txt:1` 的 `PASS: compact caption and rich About dialog, version copy and project link`，以及 `:2` 的 `passed:true`。stderr 只有 `org.a11y.Bus` 激活，没有 Playwright timeout。Wayland 对应 `wayland-smoke.out.txt:1` 和 `:2`，stderr 同样只有 a11y。

下面这一节**不参与**上面的计数。L161、L243、L339 三个 `File.click()` 都没有自己的日志行，所以 X11 和 Wayland 都是 `per-site log line: absent`。不能从 exit 0 反推某一站点的日志。N=1，不声称 #14 已修复。

## GHA

两次 dispatch 都是 HTTP **403** `Resource not accessible by integration`（需要 `actions=write`），因此改为本地跑。

- `desktop-smoke.yml` @ `1d7c806846386c16274e0549e156b142f4930a6f`：403。原文见 `gha/desktop-smoke.dispatch.http`。
- `desktop-linux.yml`：`gh workflow run` 先返回 404（该文件是 `workflow_call`，默认分支上不是可独立 dispatch 的 workflow）。随后对同一 SHA 的 dispatch POST 返回 **403**。原文见 `gha/desktop-linux.dispatch.http` 与 `gha/desktop-linux.dispatch.err`。

## Weston 日志

`apps/desktop/scripts/run-linux-chrome-smoke.sh` 未改。脚本把日志写到临时目录的 `weston.log`，并在 EXIT trap 里 `rm -rf` 该目录。外部复制进程在脚本运行期间每 20ms 轮询 `/tmp/tmp.*/weston.log`，拷到本目录的 `weston.log`。最后一次成功拷贝是 `2026-10-15T07:42:39.615Z`，1973 字节，内容包含 weston 收到 signal 15 后的收尾行。来源路径是 `/tmp/tmp.GA4LLj4t3Z/weston.log`。过程见 `weston-copy-trace.txt`。

inotify 的 delete 事件行没有写进 trace（watcher 没有把 delete 行刷出来）。日志文件本身已经留下，并且包含清理开始时的 SIGTERM 记录。

## 未使用的绕行

未加 `--disable-gpu`，未加全局节流，未改 `apps/desktop/src/main.ts`（含第 536 行）。每个命令外面有一层 600 秒的 `timeout` 看守，只为了卡住时还能留下退出码；两次都在约 22 秒自行退出，看守没有触发。

## 主机

Ubuntu 24.04.5，Node v22.14.0，pnpm 10.32.1，Electron 42.11.1，Weston 13.0.0。这是 cloud-agent VM，不是 GitHub-hosted runner。Electron 二进制在两条冒烟命令之前已经装好，耗时不含 Electron 下载。
