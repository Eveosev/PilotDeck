# PC1#3 · after-first · T-PC1-3

口径（`tools/agent-loop-perf/METRICS.md`）：`stream_chunk_ms[0]` 含 mock `modelMs=200`。after-first = 每个样本的 `[1:]`，再把 30 个 turn 的间隔池在一起取 P50/P95。after-first **不再**减 200。D4 = `max(native after-first P95×10%, 5ms)`。差 = rust-core TCP after-first P95 − native after-first P95。差/D4 = 差 / D4。

探针旧数字 1.394 / 1.822 **不是**本轮结果。

数据：`evidence/p2/pc1-3-pc3/{native,tcp}.json` 的 `stream_chunk_ms_after_first` 与每条 sample 的 `n_chunks`。live 布尔见 `raw/stream/stream-chunks-live-*.json`。

## 前置（chars 1 / 50 / 500）

| chars | 路径 | firstDeltaBeforeProviderCompletion | harness n_chunks | perf_n_chunks | n=30 perf_n_chunks |
|---:|---|---|---:|---:|---|
| 1 | native | true | 98 | 98 | 30/30 为 98 |
| 1 | rust-core TCP | true | 98 | 98 | 30/30 为 98 |
| 50 | native | true | 22 | 22 | 30/30 为 22 |
| 50 | rust-core TCP | true | 22 | 22 | 30/30 为 22 |
| 500 | native | true | 4 | 4 | 30/30 为 4 |
| 500 | rust-core TCP | true | 4 | 4 | 30/30 为 4 |

`firstDeltaBeforeProviderCompletion` 与 harness `n_chunks` 来自每个 chars、每条路径 **1** 次 live turn（`collect_stream_chunks.py --run-gateway`）。`perf_n_chunks` 在这 1 次里与 harness 相等，并且 n=30 perf 样本全部落在同一计数上。没有出现 `perf_n_chunks=1` 或空间隔。rust-core TCP 有 `stream_next` 拉流。

每个 turn 的间隔数 = `n_chunks - 1`（chars 1 → 97，chars 50 → 21，chars 500 → 3）。after-first 再去掉 interval[0]，所以每个 turn 的 after-first 条数是 96 / 20 / 2。池化 n = 30 × 该条数 = 2880 / 600 / 60。

## after-first

native after-first P95 的 10% 都低于 5ms，所以三行 D4 都是 **5ms**。

| chars | turns | after-first n | native P50 | native P95 | rust-tcp P50 | rust-tcp P95 | 差 | D4 | 差/D4 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 30 | 2880 | 1.547 | 4.727 | 3.051 | 5.204 | 0.477 | 5 | **0.095** |
| 50 | 30 | 600 | 1.741 | 6.313 | 3.432 | 5.796 | -0.517 | 5 | **-0.103** |
| 500 | 30 | 60 | 5.537 | 9.696 | 4.172 | 5.490 | -4.206 | 5 | -0.841 |

差/D4 保留 3 位小数：`0.477/5=0.0954`，`-0.517/5=-0.1034`，`-4.206/5=-0.8412`。

## 判定

关门钉是 chars **1** 与 chars **50** 的 after-first 差/D4 都 ≤ 1。

- chars 1：0.095 ≤ 1
- chars 50：-0.103 ≤ 1
- chars 500：-0.841，如实记录。样本间隔 n=60（30 turn × 2）。它不是这颗关门钉。

**建议关闭 PC1#3。** 本 PR 的 PLAN **不**把该项标成已关。关闭权归 QA Formal / 真 Payne。

PC2 仍 open。model / turn 的 Q2 与 D4 在 `PC3_TABLE.md`，只记录。
