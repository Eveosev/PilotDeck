# PilotDeck AgentLoop 性能基线 harness

对同一场景在 `native` / TS-stdio / TS-tcp 下各跑 ≥30 次，采集 `turn_ms`、`model_iter_ms[]`、`non_model_ms`、`segments.*`、`stream_chunk_ms[]`，写出 P50/P95 JSON。

复用 [`../agent-loop-parity/`](../agent-loop-parity/) 的 gateway adapter、mock backend 和 T-P0a-00 TCP bootstrap。**不改变产品默认 transport（仍为 native）。**

口径见 [METRICS.md](./METRICS.md)。

## 一键命令

仓库根目录，Node 22 且已 `pnpm build`：

```bash
source ~/.nvm/nvm.sh
nvm use 22
pnpm build

python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --iterations 30 \
  --output evidence/perf-baseline
```

产出：

- `evidence/perf-baseline/native.json`
- `evidence/perf-baseline/stdio.json`
- `evidence/perf-baseline/tcp.json`
- `evidence/perf-baseline/summary.json`（命令与 provenance）

默认场景：`pure_text,single_tool`。默认会把 `delays.*` / `toolDelays.*` 置 0。提交证据前必须在干净工作树上采集（`gitDirty=false`，`gitSha`/`collectSha` = 当时 HEAD）；脏树会直接拒绝，除非 `--allow-dirty`。

T-P1-05 对照（三条路径同一套 `modelMs:200`，同时报 raw 与 net-of-delay）：

```bash
python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --transports native \
  --scenarios pure_text,single_tool,sidecar_live_model_stream_chars_50 \
  --model-ms 200 \
  --iterations 30 \
  --output /tmp/t-p1-05/native

python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --transports tcp \
  --scenarios pure_text,single_tool,sidecar_live_model_stream_chars_50 \
  --model-ms 200 \
  --iterations 30 \
  --output /tmp/t-p1-05/ts-tcp

python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --transports tcp \
  --pilotdeck-tcp-sidecar-cmd tools/agent-loop-parity/rust-tcp-sidecar.sh \
  --scenarios pure_text,single_tool,sidecar_live_model_stream_chars_50 \
  --model-ms 200 \
  --iterations 30 \
  --output /tmp/t-p1-05/rust-tcp
```

`--model-ms 200` 场景 `delay_injected=true`，不进 T-P0a-03 `primaryBaseline`；读 `comparisonBaseline` 以及 `*_net_of_model_ms`。D4 用净 P95。delay-0 的 `evidence/perf-baseline/*.json` 只作形态参考。

T-P2-03 stdio（每 turn 拉起；**不要**对本二进制加 TCP 参数，rust-core 会 exit 2）：

```bash
# native，以及同样每 turn 拉起的 TS-stdio（不设 PARITY_STDIO_SIDECAR_COMMAND）
python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --transports native \
  --scenarios pure_text,single_tool,sidecar_live_model_stream_chars_50 \
  --model-ms 200 \
  --iterations 30 \
  --output /tmp/t-p2-03/native

python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --transports stdio \
  --scenarios pure_text,single_tool,sidecar_live_model_stream_chars_50 \
  --model-ms 200 \
  --iterations 30 \
  --output /tmp/t-p2-03/ts-stdio

# rust-core：包装脚本写 exec proof；PILOTDECK_RUST_SIDECAR_BIN 必须是
# 名为 pilotdeck-agent-loop 的符号链接，目标文件才是 pilotdeck-agent-loop-sidecar。
export PILOTDECK_RUST_SIDECAR_BIN=/path/to/pilotdeck-agent-loop
python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --transports stdio \
  --pilotdeck-stdio-sidecar-cmd tools/agent-loop-parity/rust-stdio-sidecar.sh \
  --scenarios pure_text,single_tool,sidecar_live_model_stream_chars_50 \
  --model-ms 200 \
  --iterations 30 \
  --output /tmp/t-p2-03/rust-stdio
```

`--pilotdeck-stdio-sidecar-cmd` 与 `--pilotdeck-tcp-sidecar-cmd` / `--transports tcp` 同时出现会直接拒绝。Rust 身份看每轮 `execProof`（wrapper 文件与 trace 里的 `rust_sidecar_exec`），不看 `--version`。

## 抽样复跑（QA）

```bash
python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --transports native \
  --scenarios pure_text \
  --iterations 30 \
  --output /tmp/pilotdeck-perf-qa-native
```

只跑一种 sidecar：

```bash
python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --transports tcp \
  --scenarios pure_text,single_tool \
  --iterations 30 \
  --output /tmp/pilotdeck-perf-tcp
```

TCP 复用已在听的 listener（含未来 Rust sidecar）与 parity 相同：

```bash
python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --transports tcp \
  --pilotdeck-tcp-host 127.0.0.1 \
  --pilotdeck-tcp-port 9345 \
  --output /tmp/pilotdeck-perf-tcp-reuse
```

## 单元测试

```bash
python3 -m unittest discover -s tools/agent-loop-perf -p 'test_*.py'
node --test tools/agent-loop-perf/collector.test.mjs
```

## JSON 形状

每个 transport 文件包含 raw 样本、按场景的 P50/P95、`non_model_ms` / `segments`、`delay_injected`、以及 provenance（`gitSha`/`collectSha` = 采集时 HEAD，`gitDirty`，`baseSha`=merge-base、node/python、命令里的 root 记为 `$PWD`）。证据提交后，该 commit 的 parent 应等于 `collectSha`；`evidenceCommit` 是加证据的那次 commit，不能写进 JSON（SHA 依赖文件内容）。`primaryBaseline` 只含 `delay_injected=false` 的场景。默认 parity 路径不再 import collector（只有 `PARITY_PERF=1` 才动态加载）。
