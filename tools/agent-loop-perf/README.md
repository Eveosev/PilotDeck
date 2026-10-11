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

默认场景：`pure_text,single_tool`。默认会把 `delays.*` / `toolDelays.*` 置 0。

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

每个 transport 文件包含 raw 样本、按场景的 P50/P95、`non_model_ms` / `segments`、`delay_injected`、以及 provenance（`gitSha`、`gitDirty`、`baseSha`=merge-base、node/python、命令里的 root 记为 `$PWD`）。`primaryBaseline` 只含 `delay_injected=false` 的场景。默认 parity 路径不再 import collector（只有 `PARITY_PERF=1` 才动态加载）。
