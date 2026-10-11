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

## 本机 30×3（分段后重跑）

`delay_injected=false`，全部进入主基线表。`stream_chunk_ms` 在这两个场景为空。`command` 里的 root 记为 `$PWD`。`baseSha` 来自 `git merge-base HEAD rust_standalone_alpha1`。采集时若工作区有未提交改动，`gitDirty=true`。

形态仍是 **stdio ≫ native ≈ tcp**。绝对值随机器波动；P1 必须同机同跑。

### `turn_ms` / `model_iter_ms` / `non_model_ms`

| transport | scenario | n | turn P50 | turn P95 | model P50 | non_model P50 |
|---|---|---|---|---|---|---|
| native | pure_text | 30 | 581.674 | 628.928 | 15.163 | 565.359 |
| native | single_tool | 30 | 675.082 | 770.125 | 21.470 | 639.768 |
| stdio | pure_text | 30 | 1075.599 | 1599.900 | 19.249 | 1055.351 |
| stdio | single_tool | 30 | 1570.086 | 1667.800 | 23.782 | 1526.157 |
| tcp | pure_text | 30 | 619.774 | 660.345 | 18.468 | 600.784 |
| tcp | single_tool | 30 | 798.683 | 873.757 | 25.840 | 742.846 |

### 构成（P50，R1）

| transport | scenario | pre_model | handshake | between | tool | post_model | outside turn |
|---|---|---|---|---|---|---|---|
| native | pure_text | **552** | — | — | — | 14 | 723 |
| native | single_tool | 546 | — | 78 | 2 | 14 | 1068 |
| stdio | pure_text | 1029 | **508** | — | — | 27 | 1149 |
| stdio | single_tool | 1007 | **508** | 92 | 2 | **428** | 738 |
| tcp | pure_text | 587 | 81 | — | — | 15 | 1161 |
| tcp | single_tool | 619 | 85 | 101 | 3 | 15 | 1195 |

- native ~530ms 非 model = 冷 session 的 `pre_model_ms`（`SessionRouter` create），不是 harness `post("/control/state")`。
- stdio `single_tool − pure_text` ≈ +494ms ≈ `post_model` 428ms（P95 433，很紧），不是二次 spawn（handshake 两边都是 508）。
- tcp 热 listener，handshake ~80ms；stdio 每 turn 冷 spawn。
- `gateway_outside_turn_ms` 是 Gateway 启停，不在 `turn_ms` 里。

native「宿主开销」= `turn_ms(native)` 本身，不是 module_call。P1 相对开销用 `(candidate_P95 - native_P95)` 对照 `max(native_P95×10%, 5ms)`，并同时看 `non_model_ms`。
