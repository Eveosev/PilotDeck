# STDIO_PERF · T-P2-03

同机、`--model-ms 200`、n=30、场景 `pure_text` / `single_tool` / `sidecar_live_model_stream_chars_50`。三条路径都是分开的采集命令（见 `PROVENANCE.md`）：native、每 turn 拉起的 TS-stdio、每 turn 拉起的 rust-core stdio。`delay_injected=true`，下表来自各 JSON 的 `scenarios`（与 `comparisonBaseline` 的 P50/P95 一致）。净数 = raw − `configuredModelMs` × 该样本的 model 次数；model 迭代净数按每次迭代扣 200ms。

rust-core 身份是 exec proof（90/90，`resolved` 以 `pilotdeck-agent-loop` 结尾），不是 `--version`。

单位毫秒。`single_tool` 的 model 行 n=60（每 turn 两次 model），其余 model 行 n=30；turn / non_model 都是 n=30。

## turn_ms

| 场景 | 路径 | P50 | P95 | 净 P50 | 净 P95 |
|---|---|---:|---:|---:|---:|
| pure_text | native | 800.488 | 873.610 | 600.488 | 673.610 |
| pure_text | TS-stdio | 1158.312 | 1227.163 | 958.312 | 1027.163 |
| pure_text | rust-stdio | 798.023 | 828.843 | 598.023 | 628.843 |
| single_tool | native | 1082.983 | 1143.789 | 682.983 | 743.789 |
| single_tool | TS-stdio | 1665.389 | 1728.819 | 1265.389 | 1328.819 |
| single_tool | rust-stdio | 1123.812 | 1158.663 | 723.812 | 758.663 |
| chars_50 | native | 968.022 | 1074.860 | 768.022 | 874.860 |
| chars_50 | TS-stdio | 1440.523 | 1459.246 | 1240.523 | 1259.246 |
| chars_50 | rust-stdio | 1023.213 | 1063.572 | 823.214 | 863.572 |

## model_iter_ms（净 / raw）

| 场景 | 路径 | 净 P50 | 净 P95 | raw P50 | raw P95 |
|---|---|---:|---:|---:|---:|
| pure_text | native | 18.489 | 26.272 | 218.489 | 226.272 |
| pure_text | TS-stdio | 20.349 | 23.997 | 220.350 | 223.997 |
| pure_text | rust-stdio | 20.948 | 22.573 | 220.948 | 222.573 |
| single_tool | native | 23.323 | 28.244 | 223.323 | 228.244 |
| single_tool | TS-stdio | 24.915 | 30.920 | 224.915 | 230.920 |
| single_tool | rust-stdio | 25.746 | 30.931 | 225.746 | 230.931 |
| chars_50 | native | 37.168 | 46.277 | 237.167 | 246.277 |
| chars_50 | TS-stdio | 58.913 | 62.231 | 258.913 | 262.231 |
| chars_50 | rust-stdio | 60.465 | 79.536 | 260.465 | 279.536 |

## non_model_ms 与相关 segments（P95）

| 场景 | 路径 | non_model | pre_model | post_model | handshake |
|---|---|---:|---:|---:|---:|
| pure_text | native | 653.003 | 639.852 | 16.497 | — |
| pure_text | TS-stdio | 1003.218 | 977.901 | 29.526 | 417.324 |
| pure_text | rust-stdio | 606.725 | 581.881 | 25.343 | 89.886 |
| single_tool | native | 694.696 | 596.883 | 17.556 | — |
| single_tool | TS-stdio | 1277.937 | 963.595 | 233.607 | 429.140 |
| single_tool | rust-stdio | 710.258 | 588.325 | 25.235 | 84.614 |
| chars_50 | native | 823.718 | 784.587 | 40.927 | — |
| chars_50 | TS-stdio | 1198.619 | 1106.164 | 142.032 | 418.454 |
| chars_50 | rust-stdio | 795.568 | 765.393 | 38.436 | 87.888 |

native 没有 sidecar handshake。TS-stdio 的 handshake P95 约 417–429ms，单工具的 post_model P95 是 233.607ms，整 turn 净差因此远大于 rust-stdio。rust-stdio 的 handshake P95 约 85–90ms，整 turn 净 P95 与 native 同量级。三条路径的 pre_model 都在数百毫秒，整 turn 的大头在宿主侧，不在 model 迭代净时间。

## Q2（单次 model 迭代）

阈值 = `max(native model 净 P95 × 10%, 100ms)`。本机 native model 净 P95 为 26.272 / 28.244 / 46.277，10% 都小于 100，所以三场景阈值都是 **100ms**。下表是候选 model 净 P95 − native model 净 P95。

| 场景 | rust-stdio 差 | 超过 Q2 | TS-stdio 差 | 超过 Q2 |
|---|---:|---|---:|---|
| pure_text | −3.699 | 否 | −2.275 | 否 |
| single_tool | +2.687 | 否 | +2.676 | 否 |
| chars_50 | +33.259 | 否 | +15.954 | 否 |

## 整 turn 与 D4

D4 = `max(native turn 净 P95 × 10%, 5ms)`，只看净数。本机 native turn 净 P95 是 673.610 / 743.789 / 874.860，10% 为 67.361 / 74.379 / 87.486，都高于 5ms 地板，所以本轮 D4 取这三个 10% 值。差 = 候选 turn 净 P95 − native turn 净 P95。

| 场景 | rust-stdio 差 | 差/D4 | TS-stdio 差 | 差/D4 |
|---|---:|---:|---:|---:|
| pure_text | −44.767 | −0.665 | +353.553 | 5.249 |
| single_tool | +14.874 | 0.200 | +585.030 | 7.866 |
| chars_50 | −11.288 | −0.129 | +384.386 | 4.394 |

这个 D4 被本机 native 的 pre_model 抬高，和书面上 5ms 地板不是同一个数。TS-stdio 整 turn 超过本轮 D4，多出来的时间在 handshake / pre_model / post_model，model 净差仍在几毫秒到十几毫秒。

## 归因

探针书面上的 model 净 P95 相对 native 多 13–21ms，在本轮 rust-core stdio 的 `pure_text` / `single_tool` 上没有出现（−3.699 / +2.687ms），同形态 TS-stdio 的 model 净差也是 −2.275 / +2.676ms；这一截不像 rust-core stdio 的 model 迭代地板，更像探针路径上的开销。本轮是每 turn 拉起的 stdio，不能据此关闭 PC2，也不能拿去对 #37 的 Rust-tcp 表。

## 快速门读数（只用于是否排期 T-P2-04）

rust-core stdio 三场景的 model 净 P95 差都没有超过 Q2（100ms）。整 turn 净差/D4 为 −0.665 / 0.200 / −0.129，没有超过 1。按这个快速读数，可以把 T-P2-04 排进日程。本 PR 不自动开 T-P2-04，也不把四 crate 引进仓库。PC2 仍 open，见 `PC2_NOTE.md`。
