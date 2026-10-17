# PERF_TCP · T-P2-05 · P7

同机、同一次采集。代码提交 `9bd36089`（perf provenance `gitDirty=false`）。2026-10-16T14:03:59Z–14:09:49Z。`--model-ms 200`，n=30。场景 `pure_text`、`single_tool`、`sidecar_live_model_stream_chars_50`。传输 `native` 与 `tcp`。

```bash
export PILOTDECK_RUST_SIDECAR_BIN="$PWD/rust-core/target/rust-core-proof/pilotdeck-agent-loop"
python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --scenarios pure_text,single_tool,sidecar_live_model_stream_chars_50 \
  --model-ms 200 \
  --iterations 30 \
  --transports native,tcp \
  --pilotdeck-tcp-sidecar-cmd tools/agent-loop-parity/rust-tcp-sidecar.sh \
  --output /tmp/tp205/perf
# EXIT:0
```

perf 的 `rustSidecarBin` 字段只在 stdio 命令路径填写，本趟是 TCP，所以 provenance 里该字段为 null。环境变量已导出，wrapper `:6` 使用它。`tcpSidecarCommand=tools/agent-loop-parity/rust-tcp-sidecar.sh`。`baseSha=d740abe1330bbc4a7ca9e2264fed0dad72b9a866`。

数字取 `comparisonBaseline.*.model_iter_ms_net_of_model_ms.p95` 与 `turn_ms_net_of_model_ms.p95`。Q2 上限 = `max(native model 净 P95 × 10%, 100ms)`。D4 = `max(native turn 净 P95 × 10%, 5ms)`。差 = tcp − native。

| 场景 | native model 净 P95 | tcp model 净 P95 | 差 | Q2 上限 | Q2 |
|---|---:|---:|---:|---:|---|
| pure_text | 31.610 | 26.500 | -5.110 | 100 | PASS |
| single_tool | 28.416 | 34.798 | 6.382 | 100 | PASS |
| sidecar_live_model_stream_chars_50 | 39.785 | 69.122 | 29.337 | 100 | PASS |

| 场景 | native turn 净 P95 | tcp turn 净 P95 | 差 | D4 | 差/D4 |
|---|---:|---:|---:|---:|---:|
| pure_text | 629.304 | 639.833 | 10.529 | 62.930 | 0.167 |
| single_tool | 714.870 | 780.670 | 65.800 | 71.487 | 0.920 |
| sidecar_live_model_stream_chars_50 | 830.707 | 888.761 | 58.054 | 83.071 | 0.699 |

**Q2 PASS**（三场景差都 ≤ 上限）。D4 只记录，不作为失败条件。三场景差/D4 都小于 1。stdio 旧表不作为比较基准。**不关闭 PC2。** PC1#3 与 PC3 仍 open，本表不覆盖它们。
