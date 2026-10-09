# PilotDeck AgentLoop 对拍工具

这是 PilotDeck 仓库内的 PilotDeck-only 对拍工具，只比较当前（或指定 baseline）的 native 与 sidecar AgentLoop。它不包含 StaffDeck Harness、TaskFrame、SOP、lease、fencing 或其他宿主状态机。

## 目录

- `run.py`：只运行 PilotDeck pair 的 orchestrator；
- `scenarios.json`：共享确定性场景 fixture，runner 只选择 `pairs` 含 `pilotdeck` 的场景；
- `mock_backend.py`：确定性 mock model/tool provider；
- `trace.py`：canonical trace、oracle 和语义比较器；
- `adapters/`：PilotDeck native、sidecar 和 gateway adapter。

StaffDeck fork 仍维护跨宿主 orchestrator、StaffDeck adapter 和真实 Harness 对拍。两边的 PilotDeck adapter 应保持协议和 trace 契约一致，但不复制宿主业务代码。

## 运行

在 PilotDeck 仓库根目录完成 Node 22 构建后，从本目录运行：

```bash
source ~/.nvm/nvm.sh
nvm use 22
pnpm build

python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --scenario all \
  --output /tmp/pilotdeck-agent-loop-parity
```

对照 `origin/main` 的产品版本漂移：

```bash
python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --pilotdeck-baseline origin/main \
  --comparison both \
  --surface gateway \
  --scenario all \
  --output /tmp/pilotdeck-agent-loop-parity-baseline
```

`same-version` 是 sidecar parity gate；`baseline`/`both` 的 baseline drift 单独报告，不计入 sidecar 语义结论。缺少 Node、构建产物、adapter 入口、依赖或 trace 时返回 `BLOCKED`，不合成成功结果。

Gateway sidecar adapter 必须设置 `PILOTDECK_AGENT_LOOP_TRANSPORT=stdio` 或 `tcp` 并进入正式 deployment profile 和
`createAgentLoopSidecarRuntimeFactory`。产品默认 transport 仍是 `native`。trace 中必须存在 transport selection
（`stdio` 或 `tcp`）、sidecar handshake/binding，以及场景声明的 host module-call 证据；缺失时 runner 直接分类为
`BLOCKED`。禁止通过自建 runner 或 `__testAgentLoopFactory` 绕过生产 factory。当前完整 PilotDeck gate 为 **53** 个场景
（以 `summary.json` 的 `scenarios` / `gateScenarioCount` 为准，必须等于 53），其中包含 host-owned plan-mode 四 turn、
budget、elicitation、live steer、durable compaction、完整及 projected-request compaction budget、sidecar seed read
state、live model streaming、model metadata、empty SDK system prompt 和 additional working directories。production
proof 记录 module 与 operation；例如增量流场景必须实际出现 `model.stream_next`，只有 `model` 模块名不足以通过 oracle。

## Sidecar transport

默认 sidecar transport 是 `stdio`：host 通过 `PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND` 按 turn 拉起 TS sidecar。
`tcp` 模式下 host **只连接** `PILOTDECK_AGENT_LOOP_TCP_HOST` / `PILOTDECK_AGENT_LOOP_TCP_PORT`，不会再 spawn sidecar。
因此 harness 必须自己启动（或复用）TCP listener。

选择 TCP（harness 在 loopback 上分配空闲端口并启动 TS sidecar）：

```bash
python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --sidecar-transport tcp \
  --scenario all \
  --output /tmp/pilotdeck-agent-loop-parity-tcp
```

等价环境变量：`PARITY_SIDECAR_TRANSPORT=tcp`（也接受 `PILOTDECK_PARITY_SIDECAR_TRANSPORT`）。

指向已经在听的 sidecar（包括未来的 Rust 二进制）：先让该进程监听
`PILOTDECK_AGENT_LOOP_TCP_HOST` / `PILOTDECK_AGENT_LOOP_TCP_PORT`，再复用 host/port：

```bash
PILOTDECK_AGENT_LOOP_TCP_HOST=127.0.0.1 PILOTDECK_AGENT_LOOP_TCP_PORT=9345 \
  ./target/release/pilotdeck-agent-loop-sidecar

python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --sidecar-transport tcp \
  --pilotdeck-tcp-host 127.0.0.1 \
  --pilotdeck-tcp-port 9345 \
  --scenario all \
  --output /tmp/pilotdeck-agent-loop-parity-tcp-rust
```

或者让 harness 代为启动自定义二进制（会注入同样的 HOST/PORT 环境变量）：

```bash
python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --sidecar-transport tcp \
  --pilotdeck-tcp-sidecar-cmd ./target/release/pilotdeck-agent-loop-sidecar \
  --scenario all \
  --output /tmp/pilotdeck-agent-loop-parity-tcp-rust
```

Rust sidecar 必须遵守与 TS `pilotdeck-agent-loop-sidecar` 相同的 Module Protocol，并在
`PILOTDECK_AGENT_LOOP_TCP_HOST`（默认 `127.0.0.1`）和 `PILOTDECK_AGENT_LOOP_TCP_PORT` 上监听。

## Negative control

以下两条路径都必须以 `BLOCKED` 结束（`PARITY_MODE=native` 无法提供 sidecar transport/handshake proof）：

```bash
# stdio
python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --scenario pure_text \
  --sidecar-transport stdio \
  --pilotdeck-sidecar-cmd "env PARITY_MODE=native node tools/agent-loop-parity/adapters/pilotdeck_gateway_impl.mjs" \
  --output /tmp/pilotdeck-parity-negative-stdio

# tcp
python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --scenario pure_text \
  --sidecar-transport tcp \
  --pilotdeck-sidecar-cmd "env PARITY_MODE=native node tools/agent-loop-parity/adapters/pilotdeck_gateway_impl.mjs" \
  --output /tmp/pilotdeck-parity-negative-tcp
```

## 比较和验收

比较规则以 [PilotDeck Native / Sidecar 对拍 SOP](../../docs/pilotdeck-agent-loop-parity-sop.zh.md) 和 [Module Communication SOP](../../docs/pilotdeck-module-communication-sop.zh.md) 为准。只忽略随机身份、时间戳、transport envelope 和 canonical image block 的派生 `bytes`；消息、图片 MIME/data、tool、permission、checkpoint、终态、错误码和用户输出必须严格比较。

退出码：`0` 表示通过，`1` 表示 oracle 或语义差异，`2` 表示环境或 adapter 阻塞。trace、日志、SQLite 和 mock 记录应输出到临时目录，不提交到 Git。

mock model/tool 只作为正式 host dispatcher 的确定性依赖，不代表真实 provider 或完整 deployment E2E。修改
production proof 时必须同时运行 harness negative-control：fake runner 或缺少 handshake 证据必须得到 `BLOCKED`。stdio 与 tcp 都有等价的 CLI 负控制，见上文。
