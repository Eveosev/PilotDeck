# T-P0a-03 性能基线证据

本目录的 `{native,stdio,tcp}.json` 由下列命令生成（≥30 次/transport，默认 `pure_text` + `single_tool`，`delays.*=0`）：

```bash
python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --iterations 30 \
  --output evidence/perf-baseline
```

口径见 [`tools/agent-loop-perf/METRICS.md`](../../tools/agent-loop-perf/METRICS.md)，运行说明见 [`tools/agent-loop-perf/README.md`](../../tools/agent-loop-perf/README.md)。

产品默认 transport 仍是 native。本目录只记录测量结果，不设 Rust 性能门禁。
