# D7_CONTRACT · T-P2-05

桌面 sidecar 联调是后续独立任务。本 PR 不改 `apps/**`，不创建打包文件。当前 chrome smoke 不走 sidecar；合入后 smoke 流程不变，不强制 sidecar。

## 传参名字（TASK_DEF §2.4）

| 角色 | 名字 | 谁读 | 本 PR |
|---|---|---|---|
| 仓内产物（开发/对拍） | 路径 `rust-core/target/release/pilotdeck-agent-loop-sidecar` | 构建 / Formal | 已钉死。release 构建落在该路径 |
| Harness 覆盖 bin | `PILOTDECK_RUST_SIDECAR_BIN` | `tools/agent-loop-parity/rust-tcp-sidecar.sh:6`、`rust-stdio-sidecar.sh:10` | 沿用。对拍显式指向 `rust-core/target/rust-core-proof/pilotdeck-agent-loop` |
| Listen 地址（harness 注入） | `PILOTDECK_AGENT_LOOP_TCP_HOST`（默认 `127.0.0.1`）、`PILOTDECK_AGENT_LOOP_TCP_PORT` | wrapper 转成 `--listen`；`run.py` 注入 | 沿用。二进制不读这两个变量 |
| Auth | `PILOTDECK_AGENT_LOOP_TCP_TOKEN` | rust-core TCP（仅 `--listen`）与 TS host profile | rust-core 已实现。stdio 不读 |
| Host 选 tcp | `PILOTDECK_AGENT_LOOP_TRANSPORT=tcp` | `AgentLoopDeploymentProfile.ts` | 不改 TS。`:139` 默认仍是 native |
| 未来桌面打包落点（仅文档） | `apps/desktop/resources/rust/pilotdeck-agent-loop-sidecar` | 后续桌面任务 | 本 PR 不创建、不改 `apps/**`。Win 文件名带 `.exe`，与 `apps/desktop/scripts/rust-hello.mjs` 的 `rustHelloDestName`（`:13`，win32 → `${RUST_HELLO_BIN}.exe`）同一套 |
| 未来桌面启动 | 子进程 argv：`<packaged-bin> --listen 127.0.0.1:<port>`；若启用 auth，env 带 `PILOTDECK_AGENT_LOOP_TCP_TOKEN` | T-P2-06 / 桌面联调 | 本 PR 不接线 |

## 实现契约

- CLI：`--listen HOST:PORT` 与 `--listen=HOST:PORT`。`!ip.is_loopback()` 时 stderr 为 `--listen must bind a loopback address`，退出码 2。无 `--listen` 时保持 stdio（含忽略单个 sidecar-path 占位参数）。
- 绑定成功后 stderr 一行 `listening HOST:PORT`（ephemeral 端口打印实际端口），并 flush。接受循环是阻塞 `incoming()`，没有探针的 10ms `recv_timeout` 轮询。
- 每个 TCP 连接有自己的 `ExecutionServer`。hello 成功会把进程级认证标志置上，之后的连接放行。这是为了 P5 态 C：`send_line` 每次新建 socket，hello 与随后的 `capabilities` 不在同一连接。错 token / 缺 token 不置位，连接保持，响应 `ok: false`、`code: UNAUTHENTICATED`，body 不含 token 原文。认证前的非 hello method 回 `kind: error`、`code: UNAUTHENTICATED`。比较是字节级常量时间，长度不等也扫完。
- token 只从 `PILOTDECK_AGENT_LOOP_TCP_TOKEN` 读取，trim 后空字符串视为未设置（开放 loopback）。读取只发生在 `--listen` 分支。stdio 入口不调用该函数。
- `PILOTDECK_AGENT_LOOP_TCP_PORT` 不再导致 exit 2。`PILOTDECK_AGENT_LOOP_FACTORY` 非空仍 exit 2。不接 factory。
- `rust-tcp-sidecar.sh:8` 默认仍是仓根探针 `target/release/pilotdeck-agent-loop`。
