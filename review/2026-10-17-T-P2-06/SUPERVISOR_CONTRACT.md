# SUPERVISOR_CONTRACT · T-P2-06

产品 TS 进程里的 AgentLoop TCP sidecar supervisor。实现：`src/cli/AgentLoopTcpSidecarSupervisor.ts`。接线：`resolveAgentLoopDeploymentProfile` / `createAgentLoopDeploymentFactory` / `createLocalGateway`。

不实现 Module Protocol。不把 Session / Gateway 状态放进 sidecar。client 仍不重放 in-flight execute（`agentLoopSidecarClient.ts` 的 reconnect 语义不改）。

## 1. Opt-in（锁定 A）

只在 `PILOTDECK_AGENT_LOOP_TRANSPORT=tcp` 时考虑 supervisor。

| 条件 | 行为 |
|---|---|
| `PILOTDECK_AGENT_LOOP_TCP_SUPERVISE` 为 `1` / `true` / `yes` / `on` | 产品拉起 sidecar |
| `PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND` 非空 | 产品拉起 sidecar（不必再设 SUPERVISE） |
| `PILOTDECK_RUST_SIDECAR_BIN` 非空 | 产品拉起 sidecar（不必再设 SUPERVISE） |
| 以上皆空，只有 `TCP_HOST` + `TCP_PORT` | 继续连已有 listener（harness reuse） |
| 未设 `PILOTDECK_AGENT_LOOP_TRANSPORT` | 仍是 `native`。SUPERVISE 或 bin 不能把默认切到 tcp |
| transport 是 `stdio` | 不启用本 supervisor。子进程环境仍删除 `TCP_HOST` / `TCP_PORT` / `TCP_TOKEN` |

`SUPERVISE` 的其他非空值直接报错：`PILOTDECK_AGENT_LOOP_TCP_SUPERVISE must be 1 or 0.`

注入 `createLocalGateway({ agentLoopFactory })` 时，调用方拥有 transport，本进程不再另起 supervisor。

YAML `module-tcp-v2` binding 仍按 binding 的 host/port 去连，不因进程环境里的 SUPERVISE 改走本 supervisor。

## 2. 二进制（高 → 低）

1. `PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND`（可选 `PILOTDECK_AGENT_LOOP_SIDECAR_ARGS`：JSON 字符串数组，或按空白拆开的 token）
2. `PILOTDECK_RUST_SIDECAR_BIN`
3. 相对 cwd 的 `rust-core/target/release/pilotdeck-agent-loop-sidecar`（Windows：同名 `.exe`），文件存在才用
4. 都没有：抛错，文案含 `Refusing to fall back to native`。不静默回退 native

相对路径（含 `/` 或 `\`）相对 cwd 解析。`node` 这种 PATH 命令保持原样。

### rust-listen

命令不是 `node` / `nodejs`，也不是 `.js` / `.mjs` / `.cjs`，且没有把 `PILOTDECK_AGENT_LOOP_SIDECAR_PATH` 指到脚本时，走 rust argv：

```text
<bin> [...SIDECAR_ARGS] --listen <HOST:PORT>
```

`HOST` 为 `localhost` 时 argv 写成 `127.0.0.1`。IPv6 写成 `[::1]:PORT`。`--listen` 由 supervisor 追加，不要在 ARGS 里再写一份。

### ts-env-listen

命令是 node，或路径以 `.js` / `.mjs` / `.cjs` 结尾，或设置了脚本型 `PILOTDECK_AGENT_LOOP_SIDECAR_PATH`。不传 `--listen`。子进程环境写入：

```text
PILOTDECK_AGENT_LOOP_TCP_HOST=<loopback>
PILOTDECK_AGENT_LOOP_TCP_PORT=<port>
```

`PORT=0` 表示由 TS sidecar 自己 bind 临时端口。`src/cli/pilotdeck-agent-loop-sidecar.ts` 接受 `0`，并在 stderr 打与 rust 相同的 `listening HOST:PORT`。

## 3. 端口

| 配置 | 行为 |
|---|---|
| 设置了 `PILOTDECK_AGENT_LOOP_TCP_PORT`（1–65535） | 每次拉起都 bind 这个固定端口 |
| 未设置，或在 supervise 下显式为 `0` | argv / env 使用 `:0`，从子进程 stdout 或 stderr 解析第一行 `listening HOST:PORT` |
| 未 supervise | `TCP_PORT` 仍必填，范围 1–65535。缺端口的错误文案与原来相同 |

Bind 只允许 loopback：`localhost`、`::1`、`127.0.0.0/8`。supervise 下其它 host 报错。解析到的 `listening` 行若不是 loopback，或端口不在 1–65535，不当作就绪。

连接工厂在每次 connect 时向 supervisor 要**当前**地址。临时端口在重启后会变；固定端口保持不变。client 自己的 reconnect 仍用建连时记下的地址，不在 client 层重放 execute。

## 4. 子进程环境

TCP 子进程**保留** `PILOTDECK_AGENT_LOOP_TCP_TOKEN`（trim 后的值）。这和 stdio 部署删除 TOKEN 的行为分开。

同时从子进程环境删除：

- `PILOTDECK_AGENT_LOOP_TRANSPORT`（避免子进程再把自己当成要去 connect 的 host）
- `PILOTDECK_AGENT_LOOP_TCP_SUPERVISE`（避免套娃再起一个 supervisor）

未设置 token 时不发明 token，子进程走 rust-core 已有的开放 loopback。错 token / 缺 hello 仍由 sidecar 返回 `UNAUTHENTICATED`，响应不回显 token。supervisor 不重写这套认证。日志和 `outputTail()` 会把 token 换成 `[redacted]`。

## 5. 重启与停止

| 项 | 值 |
|---|---|
| 就绪超时 | `5000` ms（`AGENT_LOOP_TCP_SUPERVISOR_READY_TIMEOUT_MS`）。`start()` 在这个窗口内失败则拒绝，不回退 native |
| 第一次重启等待 | `50` ms |
| 退避 | 每次翻倍，上限 `1000` ms |
| 崩溃后续上的验收窗口 | `5000` ms（`AGENT_LOOP_TCP_SUPERVISOR_RESTART_LIMIT_MS`）。supervisor 不会在 5s 后停止重试 |
| 停止 | `SIGTERM` 进程组，`500` ms 后 `SIGKILL`。`stop()` 之后不再重启 |

意外退出（exit / spawn error）记一条日志：`sidecar exited ... restarting in Nms`。`spawn` 使用 `detached: true`，停止时对进程组发信号（`process.kill(-pid)`），失败再退回 `child.kill`。

`createLocalGateway` 在 tcp 且 supervisor 启用时调用 `start()`，把 supervisor 交给现有 TCP connection factory。`dispose()` 先停 supervisor，再走原来的 gateway 关闭顺序。bootstrap 失败时 rollback 也会 `stop()`。

## 6. 打包（本 PR 不改 `apps/**`）

未来桌面文件名：`pilotdeck-agent-loop-sidecar`（Windows：`pilotdeck-agent-loop-sidecar.exe`）。落点倾向 `apps/desktop/resources/rust/`，对齐 hello 的 `resources/rust/` 模式。启动契约仍是 `<bin> --listen 127.0.0.1:<port>`，可选环境变量 `PILOTDECK_AGENT_LOOP_TCP_TOKEN`。本任务不把 desktop hello 换成 sidecar，也不改 `spawnRuntime`。
