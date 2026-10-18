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

Rust sidecar over **stdio** (host spawns the crate via the wrapper; TS host still appends `SIDECAR_PATH`, which the wrapper drops):

```bash
cargo build -p pilotdeck-agent-loop --release
python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --sidecar-transport stdio \
  --pilotdeck-stdio-sidecar-cmd tools/agent-loop-parity/rust-stdio-sidecar.sh \
  --scenario pure_text \
  --output /tmp/pilotdeck-agent-loop-parity-stdio-rust
```

`sidecarImplementation` is **observed**, not inferred from the command string. The adapter **does not rewrite** traces (no budget/request reorder, no invented `requestEvidence`, no forged fingerprint).

**stdio** (host WS delivery of `context.budget` is TS-shaped; fingerprint is **N/A**):

- **Sole PASS criterion for Rust = exec proof.** Wrapper `rust_sidecar_exec` (`pid` + resolved `pilotdeck-agent-loop`) is the only observation that can label stdio `sidecarImplementation=rust` or BLOCK when Rust was requested (`--pilotdeck-stdio-sidecar-cmd`).
- `module_call` raw `sequence` (`budget.evaluate_request_budget` before `model.prepare` / `model.stream`) is **side evidence only**. It may appear in `sidecarImplementationSource` as `exec-proof+module-call`; it must not PASS or BLOCK by itself.
- Handshake `capabilities.transport` is **not recorded** (host observer emits `handshake_completed` with `moduleId` + `capabilitiesVersion` only). The dead reader was removed; do not treat handshake capabilities as a Rust criterion.
- Missing exec proof when Rust was requested is **BLOCKED**. Host `context.budget` vs `model.request` order never PASSes or BLOCKs stdio Rust and must not be rewritten.

**tcp**: the budget≺request fingerprint (raw `sequence`) still applies. TCP reuse (no start command) is not intended-rust by itself.

**TCP rust-label risk (R3 M4, documented, not changed):** TCP `observe_sidecar_implementation` still labels rust from the fingerprint without command-string intent. A TS TCP sidecar whose host WS happens to deliver `context.budget` before `model.request` can be labeled rust. Adding intent would also drop legitimate TCP-reuse Rust (S4 listen-then-connect, no start command). Leave the fingerprint rule; do not re-collect the TCP evidence tip (`98c88232`).

`traceDigest.rust` is written only when the observed implementation is rust.

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

指向已经在听的 sidecar（包括 rust-core 二进制）：进程必须带 `--listen HOST:PORT`（只绑 loopback）。
仓内产物是 `rust-core/target/release/pilotdeck-agent-loop-sidecar`，不在仓根 `target/release/`。
包装脚本 `tools/agent-loop-parity/rust-tcp-sidecar.sh` 把 harness 注入的
`PILOTDECK_AGENT_LOOP_TCP_HOST` / `PILOTDECK_AGENT_LOOP_TCP_PORT` 转成 `--listen`。
脚本默认仍指向仓根探针 `target/release/pilotdeck-agent-loop`；对拍 rust-core 时显式设置
`PILOTDECK_RUST_SIDECAR_BIN` 指向 `rust-core/target/rust-core-proof/pilotdeck-agent-loop`
（符号链接到 `../release/pilotdeck-agent-loop-sidecar`）。

```bash
./rust-core/target/release/pilotdeck-agent-loop-sidecar --listen 127.0.0.1:9345

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

或者让 harness 代为启动。它会注入 HOST/PORT；必须走 wrapper（或自行加 `--listen`），不要把裸二进制当命令。T-P2-06 起，`PILOTDECK_RUST_SIDECAR_BIN` 非空会让产品 supervisor 再 bind 同一端口。harness 已经拉起 listener 时，adapter 环境会去掉这个变量和 `PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND`，并写 `PILOTDECK_AGENT_LOOP_TCP_SUPERVISE=0`。wrapper 进程仍保留该变量。reuse（只给 host/port、不 spawn）不改环境。

```bash
PILOTDECK_RUST_SIDECAR_BIN="$PWD/rust-core/target/rust-core-proof/pilotdeck-agent-loop" \
python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --sidecar-transport tcp \
  --pilotdeck-tcp-sidecar-cmd tools/agent-loop-parity/rust-tcp-sidecar.sh \
  --scenario all \
  --output /tmp/pilotdeck-agent-loop-parity-tcp-rust
```

Rust sidecar 必须遵守与 TS `pilotdeck-agent-loop-sidecar` 相同的 Module Protocol。
rust-core 二进制不读取 `PILOTDECK_AGENT_LOOP_TCP_HOST` / `PORT`；监听地址只来自 `--listen`。

harness 启动 TCP sidecar 时把 stdout/stderr **合并写入** `<output>/tcp-sidecar.log`，并在 `summary.json` 的 `tcpSidecarLog` 记录该路径。不要用 PIPE 捕获长期 sidecar 输出，以免管道缓冲区填满后死锁。启动失败或因 listener 退出而 BLOCKED 时，错误信息会带上该日志末尾约 16 行。正常 `stop_process` 只结束进程，日志留在磁盘上供检查。

## T-P1-04 stream chunk size (`scenarios[].streamChunkChars`)

Chunk unit is **Unicode code points (chars)**, not tokens. The only parameter
entry is the top-level scenario field **`scenarios[].streamChunkChars`** with
values **`1 | 50 | 500`**. There is no env overlay and no tokenizer.

| Path | Field | Adapter yields |
|---|---|---|
| Default gate `sidecar_live_model_stream` | field **omitted** | `STREAM_PREFIX::` (before provider completion) + **one** remainder `text_delta` for the whole mock body (today’s 2-delta shape) |
| `sidecar_live_model_stream_chars_1` | `streamChunkChars: 1` | prefix + **one code point per** post-provider chunk. `1` is **not** “one chunk of the whole body”. |
| `sidecar_live_model_stream_chars_50` | `streamChunkChars: 50` | prefix + body sliced every 50 chars (≥2 body deltas; variant `q` is padded) |
| `sidecar_live_model_stream_chars_500` | `streamChunkChars: 500` | prefix + body sliced every 500 chars. If a body is shorter than 500 chars this collapses to prefix + one remainder; the `chars_500` variant pads `q` so the mock body is >500. |

Variants live in `scenarios.json` under suite `sidecar-stream-chunks` and are
**outside** the 53-scenario production gate. `run.py --scenario all --suite all`
loads exactly those 53 and **raises** `unexpected PilotDeck gate scenarios` for
any extra `pairs:["pilotdeck"]` scenario that is not in suite
`sidecar-stream-chunks`. Select variants by id or `--suite sidecar-stream-chunks`.
Default `sidecar_live_model_stream` (field omitted) stays **STREAM_PREFIX + one
body remainder = 2 deltas**, including an empty body (`n_chunks: 2`).

Reproducible collect (writes `evidence/p1/stream-chunks-{1,50,500}.json`):

```bash
# Planned n_chunks from the scenario fixtures (no Gateway / dist required)
python3 tools/agent-loop-parity/collect_stream_chunks.py \
  --output evidence/p1

# Optional live Gateway collect (needs `pnpm build`, fills stream_chunk_ms).
# T-P1-04-FU does not run this; it is deferred to T-P1-05.
PARITY_PERF=1 python3 tools/agent-loop-parity/collect_stream_chunks.py \
  --pilotdeck-root "$PWD" \
  --output evidence/p1 \
  --run-gateway \
  --sidecar-transport tcp \
  --pilotdeck-tcp-sidecar-cmd tools/agent-loop-parity/rust-tcp-sidecar.sh \
  --transport rust-tcp \
  --trace-source sidecar
```

`--run-gateway` forwards `--sidecar-transport` / `--pilotdeck-tcp-*` /
`--pilotdeck-stdio-sidecar-cmd` to `run.py`. Invalid `--transport` exits 2.
`--trace-source sidecar` (default) labels sidecar traces `source=sidecar`
(never `gateway`); `--trace-source native` labels native traces
`source=native`. Missing the chosen trace exits with error and writes no
artifact. Live runs write `stream-chunks-live-{transport}-{chars}.json` and
do **not** overwrite planned `stream-chunks-{1,50,500}.json`.
Planned-mode `firstDeltaBeforeProviderCompletion` /
`outputContainsSTREAM_PREFIX` are `null` (not evaluated). Each artifact has a
`transport` field (`native` | `ts-tcp` | `rust-tcp` | `stdio`, or `null` when planned).
Live artifacts also record `configuredModelMs` and
`stream_chunk_ms_net_of_model_ms` (interval[0] minus modelMs).

Equivalent `run.py` commands:

```bash
python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --scenario sidecar_live_model_stream_chars_1 \
  --output /tmp/p1-stream-chunks-1

python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --scenario sidecar_live_model_stream_chars_50 \
  --output /tmp/p1-stream-chunks-50

python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --scenario sidecar_live_model_stream_chars_500 \
  --output /tmp/p1-stream-chunks-500
```

Each artifact records `n_chunks` / `n_text_deltas` and, when `PARITY_PERF=1`,
`stream_chunk_ms` from the existing collector. **T-P1-05** consumes these files
for Rust-tcp vs native / vs TS-tcp attribution. This task does **not** write
go-nogo.

Unit / smoke:

```bash
cd tools/agent-loop-parity
python3 -m unittest -v test_trace.SubagentTraceNormalizationTests.test_full_gateway_gate_counts_53_scenarios
python3 -m unittest -v test_trace.SubagentTraceNormalizationTests.test_full_gateway_gate_raises_on_unregistered_non_exempt_scenario
python3 -m unittest -v test_trace.SubagentTraceNormalizationTests.test_stream_chunk_variants_are_selectable_outside_the_gate
python3 -m unittest -v test_collect_stream_chunks.py
node --test stream-chunks.test.mjs
node --test ../agent-loop-perf/collector.test.mjs
```

## Negative control

G3 names must match the transport/mode they exercise. Keep one spawn-mode native twin per transport (stdio / tcp). Do **not** also inject `PARITY_MODE=native` as `--pilotdeck-tcp-sidecar-cmd` under a reuse-looking name — that is the same TCP-native crash as the tcp spawn case.

```bash
# g3-stdio-native-mode — stdio spawn + PARITY_MODE=native must BLOCKED
python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --scenario pure_text \
  --sidecar-transport stdio \
  --pilotdeck-sidecar-cmd "env PARITY_MODE=native node tools/agent-loop-parity/adapters/pilotdeck_gateway_impl.mjs" \
  --output /tmp/pilotdeck-parity-negative-stdio

# g3-tcp-native-mode — tcp spawn + PARITY_MODE=native must BLOCKED (listener never comes up)
python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --scenario pure_text \
  --sidecar-transport tcp \
  --pilotdeck-tcp-sidecar-cmd "env PARITY_MODE=native node tools/agent-loop-parity/adapters/pilotdeck_gateway_impl.mjs" \
  --output /tmp/pilotdeck-parity-negative-tcp
```

Reuse-mode injection is a separate case: bind a fake sidecar on `127.0.0.1:0`, then connect-only. Names stay `g3-reuse-*`.

```bash
# g3-reuse-fake-sidecar — listen-then-connect against a malformed sidecar shape
python3 tools/agent-loop-parity/fake_sidecar.py > /tmp/fake-sidecar.out &
# fake_sidecar prints `listening 127.0.0.1:PORT`
python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --scenario single_tool \
  --sidecar-transport tcp \
  --pilotdeck-tcp-host 127.0.0.1 \
  --pilotdeck-tcp-port "$PORT" \
  --output /tmp/pilotdeck-parity-negative-reuse-fake
```

## 比较和验收

比较规则以 [PilotDeck Native / Sidecar 对拍 SOP](../../docs/pilotdeck-agent-loop-parity-sop.zh.md) 和 [Module Communication SOP](../../docs/pilotdeck-module-communication-sop.zh.md) 为准。只忽略随机身份、时间戳、transport envelope 和 canonical image block 的派生 `bytes`；消息、图片 MIME/data、tool、permission、checkpoint、终态、错误码和用户输出必须严格比较。

退出码：`0` 表示通过，`1` 表示 oracle 或语义差异，`2` 表示环境或 adapter 阻塞。trace、日志、SQLite 和 mock 记录应输出到临时目录，不提交到 Git。

mock model/tool 只作为正式 host dispatcher 的确定性依赖，不代表真实 provider 或完整 deployment E2E。修改
production proof 时必须同时运行 harness negative-control：fake runner 或缺少 handshake 证据必须得到 `BLOCKED`。stdio 与 tcp 各保留一条 spawn-mode native 负控制；reuse 模式另用 `g3-reuse-fake-sidecar`（假 sidecar 占 listen 端口），不要再复制一条 TCP-native crash twin。

比较摘要写入 `summary.json` 的 `comparatorVersion`、`formatWarningNote` / `formatWarningTaxonomy`（按 envelope + budget + modelView.* + request/requestEvidence/response/state/kind/source/attempt 分类）以及每条 same-version 对拍的 `traceDigest.ts` / `traceDigest.rust`，便于在省略 raw traces 时离线复核。

## QA Formal evidence

When collecting Formal evidence for this harness, run the **correct unittest class with `-v`** so the log names each case (do not paste a silent `unittest` run as proof):

```bash
cd tools/agent-loop-parity
python3 -m unittest -v test_trace.ObserveSidecarImplementationTests
```

stdio Rust Formal PASS is **only** exec proof. `module_call` order and handshake are side evidence / not recorded. TCP Formal still uses the fingerprint; cite the existing tip, do not re-collect unless the crate or observer changes.
