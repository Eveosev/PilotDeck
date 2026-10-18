# PC3_TABLE · T-PC1-3

同机、同一次 run。`collectSha=e6566d45aed490aa36386569b0548e83130ab02c`，`gitDirty=false`，`baseSha=04e04ae33217288b226c13cec56ba1203f1ba333`。`--model-ms 200`，n=30。路径：native 与 rust-core TCP（`rust-tcp-sidecar.sh` + proof symlink）。

数字取 `scenarios.*.turn_ms_net_of_model_ms` 与 `model_iter_ms_net_of_model_ms`。整 turn 的 D4 / 差 / 差/D4 取 rust-tcp JSON 里 harness 写好的 `comparisonBaseline`（差 = tcp 净 P95 − native 净 P95，D4 = `max(native turn 净 P95×10%, 5ms)`）。

Q2 上限 = `max(native model 净 P95×10%, 100ms)`。本表三场景的 10% 都低于 100ms，上限都是 100ms。Q2 与 turn D4 **只记录**。

**PC2 仍 open。** 本表不关闭 PC2，也不写成「换 rust-core 就会过 PC2」。

## PC3 三场景

| 场景 | native model 净 P50 | native model 净 P95 | tcp model 净 P50 | tcp model 净 P95 | model 差 | Q2 上限 |
|---|---:|---:|---:|---:|---:|---:|
| pure_text | 20.224 | 26.008 | 23.279 | 25.176 | -0.832 | 100 |
| single_tool | 26.965 | 32.712 | 27.513 | 34.383 | 1.671 | 100 |
| sidecar_live_model_stream_chars_50 | 38.975 | 43.689 | 62.558 | 68.835 | 25.146 | 100 |

`single_tool` 的 model 样本 n=60（30 turn × 2 次 model）。其余两场景 model n=30。turn 样本都是 n=30。

| 场景 | native turn 净 P50 | native turn 净 P95 | tcp turn 净 P50 | tcp turn 净 P95 | 差 | D4 | 差/D4 |
|---|---:|---:|---:|---:|---:|---:|---:|
| pure_text | 627.216 | 691.315 | 612.660 | 669.665 | -21.650 | 69.132 | -0.313 |
| single_tool | 754.687 | 820.194 | 755.165 | 862.310 | 42.116 | 82.019 | 0.513 |
| sidecar_live_model_stream_chars_50 | 794.737 | 901.738 | 818.969 | 879.397 | -22.341 | 90.174 | -0.248 |

## 同一次 run 里的流场景（不是 PC3 三场景门槛）

| 场景 | native model 净 P95 | tcp model 净 P95 | model 差 | Q2 上限 | native turn 净 P95 | tcp turn 净 P95 | turn 差 | D4 | 差/D4 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| chars_1 | 138.007 | 260.390 | 122.383 | 100 | 872.154 | 929.752 | 57.598 | 87.215 | 0.660 |
| chars_500 | 20.449 | 24.689 | 4.240 | 100 | 810.746 | 842.225 | 31.479 | 81.075 | 0.388 |

chars_1 的 model 净 P95 差 122.383ms，高于 Q2 的 100ms 地板。记在这里，**不**据此关闭或改写 PC2。PC1#3 看的是 after-first，见 `PC1_3_STREAM.md`。

JSON：`evidence/p2/pc1-3-pc3/native.json`、`tcp.json`（`transport=rust-tcp`）、`summary.json`。
