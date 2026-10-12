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

## Provenance（已校正）

在干净工作树上采集（`git status` 无改动），再单独提交本目录：

| 字段 | 值 |
|---|---|
| `gitSha` / `collectSha` | `248d7fbbc639fc461baa503b3d3d41a17c6ad6b5`（采集时 HEAD / harness commit） |
| `gitDirty` | `false` |
| `baseSha` | `5fa81190680a6cf5728045148ccdf5c7315fc0be`（`merge-base HEAD rust_standalone_alpha1`） |
| `delayPolicy` | `zero` |
| `command` | `python3 tools/agent-loop-perf/run.py --pilotdeck-root $PWD --iterations 30 --output evidence/perf-baseline` |

JSON 采于干净树 `248d7fbb`（`gitDirty=false`）。加 JSON 的 evidence commit 是 `812b8da3`（当时 parent = `collectSha`）。此后 tip 上可以只有文档 commit，此时 **`HEAD^ == collectSha` 不必再成立**。核对 JSON 时看 `gitSha == collectSha == 248d7fbb` 且 `gitDirty=false`，不要用后来的 tip。`evidenceCommit` 不能写进 JSON（SHA 依赖文件内容）。

上一轮 committed 证据误标 `gitSha=da859d43` / `gitDirty=true`（脏树采集后才提交）。本轮已作废并重采。

## 本机 30×3（干净树重跑）

`delay_injected=false`，全部进入主基线表。`stream_chunk_ms` 在这两个场景为空。`command` 里的 root 记为 `$PWD`。

形态仍是 **stdio ≫ native ≈ tcp**。绝对值随机器波动；P1 必须同机同跑。

### `turn_ms` / `model_iter_ms` / `non_model_ms`

| transport | scenario | n | turn P50 | turn P95 | model P50 | non_model P50 |
|---|---|---|---|---|---|---|
| native | pure_text | 30 | 562.539 | 635.265 | 14.593 | 548.566 |
| native | single_tool | 30 | 657.619 | 710.911 | 21.056 | 620.132 |
| stdio | pure_text | 30 | 1034.601 | 1072.259 | 18.263 | 1016.452 |
| stdio | single_tool | 30 | 1560.990 | 1667.653 | 23.755 | 1517.247 |
| tcp | pure_text | 30 | 626.612 | 683.733 | 19.218 | 605.715 |
| tcp | single_tool | 30 | 699.232 | 788.391 | 22.027 | 655.355 |

### 构成（P50，R1）

| transport | scenario | pre_model | handshake | between | tool | post_model | outside turn |
|---|---|---|---|---|---|---|---|
| native | pure_text | **536** | — | — | — | 14 | 694 |
| native | single_tool | 522 | — | 76 | 2 | 13 | 1059 |
| stdio | pure_text | 971 | **495** | — | — | 43 | 1114 |
| stdio | single_tool | 997 | **502** | 89 | 2 | **431** | 738 |
| tcp | pure_text | 591 | 80 | — | — | 15 | 1176 |
| tcp | single_tool | 555 | 77 | 89 | 2 | 14 | 1146 |

- native ~530ms 非 model = **冷进程首 turn** 的 `pre_model_ms`。主体是进程内第一次 host `context.try_auto_compact`（sidecar marks：tcp 约 430–470ms，stdio 约 404ms；第二次约 36ms），**不是** `SessionRouter` 冷 session 创建。`SessionRouter` 仍可能出现在窗口内，但不是主因。不是 harness `post("/control/state")`。
- stdio `single_tool − pure_text` ≈ +526ms ≈ `post_model` 431ms（P95 435），不是二次 spawn（handshake 两边都是 ~500ms）。**不是** host `Promise.race(next, sleep(500))` 加时（长寿 host 里 `next` 先到就赢）。更可能是窗内 **child exit wait**（`close → closeChild → waitForExit`），退出被约 500ms 定时器量化（相位依赖，跨机可能双峰；定时器身份 TBD）。
- tcp 热 listener，handshake ~77–80ms；stdio 每 turn 冷 spawn。
- `gateway_outside_turn_ms` 是 Gateway 启停，不在 `turn_ms` 里。

native「宿主开销」= `turn_ms(native)` 本身（冷进程首 turn，含首次 `try_auto_compact`）。P1 相对开销用 `(candidate_P95 - native_P95)` 对照 `max(native_P95×10%, 5ms)`，并同时看 `non_model_ms`。P1 可另加同进程第 2 turn（热）当稳态锚（本关不实现）。
