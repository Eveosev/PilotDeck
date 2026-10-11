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

## 本机一次 30×3 结果（`turn_ms`）

采集 SHA：`df1ce0457f1b3b93e13a3b4382257486f140d149`（基线 `rust_standalone_alpha1` @ `5fa81190680a6cf5728045148ccdf5c7315fc0be`）。`delay_injected=false`，全部进入主基线表。`stream_chunk_ms` 在这两个场景为空（单块或无相邻间隔）。

| transport | scenario | n | turn P50 | turn P95 | model_iter P50 | model_iter P95 |
|---|---|---|---|---|---|---|
| native | pure_text | 30 | 546.460 | 577.818 | 13.817 | 25.126 |
| native | single_tool | 30 | 633.529 | 687.141 | 20.531 | 23.000 |
| stdio | pure_text | 30 | 1025.919 | 1073.418 | 17.761 | 21.764 |
| stdio | single_tool | 30 | 1524.191 | 1569.802 | 21.031 | 24.819 |
| tcp | pure_text | 30 | 572.678 | 616.591 | 17.788 | 20.450 |
| tcp | single_tool | 30 | 677.001 | 726.116 | 22.198 | 25.182 |

native「宿主开销」= `turn_ms(native)` 本身，不是 module_call。P1 相对开销用 `(candidate_P95 - native_P95)` 对照 `max(native_P95×10%, 5ms)`。
