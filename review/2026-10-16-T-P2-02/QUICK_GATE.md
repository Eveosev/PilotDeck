# QUICK_GATE · T-P2-02

**结果：PASS。** `pure_text`、`single_tool` 各 30 次，same-version，stdio。每一次 harness 退出码 0，`failed` / `blocked` / `oracleFailures` 皆空，`sidecarImplementation=rust`，`sidecarImplementationSource=exec-proof`。身份来自包装脚本写入的 `rust_sidecar_exec`（pid + `resolved` 以 `pilotdeck-agent-loop` 结尾），不是 `--version`。

逐次记录在 `raw/quick-index.jsonl`（60 行）。运行日志在 `raw/parity-run.txt`。

| 场景 | n | 退出码 | 语义差 | BLOCKED | oracle | exec proof |
|---|---:|---|---:|---:|---:|---|
| `pure_text` | 30 | 全 0 | 0 | 0 | 0 | 30/30 `exec-proof` |
| `single_tool` | 30 | 全 0 | 0 | 0 | 0 | 30/30 `exec-proof` |

## 格式警告（不改变退出码）

harness 把 envelope / 下标错位记成 format warning，并写明它们不改变退出状态。语义投影仍是 0 diff，所以快速门按这个口径通过。没有把分母从 30 缩小。

| 场景 | formatWarningCount | 非零类别 |
|---|---|---|
| `pure_text` | 30 次都是 16 | 只有 `envelope`（`invocationId`、`sequence`） |
| `single_tool` | 52×1，60×4，71×20，90×1，92×4 | 每次都有 `envelope` 和 `kind`。多数还有 `modelView` / `request` / `attempt`；5 次另有 `budget` / `state` / `source` |

`single_tool` 的 `kind` / `text` 警告是 raw 下标错开（rust 多了记录，同一条 `durable.status` 不在同一个 `trace[i]`）。对齐后的语义比较没有差。`text=context_budget`、`statusKind=status` 在两侧的 `durable.status` 上都在。这不是 T-P2-09 的缺字段，也不把快速门判红。

## 和 T-P2-03

快速门通过。可以排期 T-P2-03。本 PR 不开那个任务，也不做性能对照。全量 53 的两个 `trace_diff` 见 `FULL_53_CLASSIFICATION.md`，不挡这次排期结论。
