# PROVENANCE · T-P2-01-D

## 与 #55 的关系

本分支从 #55 tip `54633c3e27f4ce2ddb9504fb9269865ac8b0a7c4` 拉出，堆在 #55 上。没有改写、强推或 rebase 该 tip。

主线仍是 `d740abe1330bbc4a7ca9e2264fed0dad72b9a866`。

代码提交 `66c2334be75c725e910887f55cd4297c35eb7219`。P1–P5 在该提交的干净工作树上采集。本证据目录是之后的提交，不改 `rust-core` 源码。

本 PR **不**放宽 #55 allowlist。允许的 trace_diff 仍只有 `deadline` 与 `sidecar_budget_limit`。没有把期望改成 50/3。

## 权威文件

- `TASK_DEF.md` sha256 `b146ef93168aa1648ffbac6fc85a5cf194bca48d1e1e118fbad644e1ec5e3e4b`
- `UNLOCK.md` 一并落入本目录

## 工具链与产物

工作目录 `rust-core/`。未设置 `CARGO_TARGET_DIR`。

```bash
cargo +1.99.1 build --release --locked -p pilotdeck-transport --bin pilotdeck-agent-loop-sidecar
# Finished release profile [optimized] target(s) in 11.24s
# EXIT:0
```

这次 release 在 `66c2334b` 已提交之后重编，`--version` 的 `source=` 就是该提交。

```text
pilotdeck-agent-loop-sidecar 0.1.0 implementation=rust wire=2.0 source=66c2334be75c725e910887f55cd4297c35eb7219
sha256 452b69c52257d51886e8402a12dd7e27d3bc39285241b9ad3ec0950e9f8558ac
```

符号链接（对拍前创建，不入库）：

```text
rust-core/target/rust-core-proof/pilotdeck-agent-loop -> ../release/pilotdeck-agent-loop-sidecar
readlink -f → /workspace/rust-core/target/release/pilotdeck-agent-loop-sidecar
```

`raw/p1-p3.txt`。仓根 `target/release/pilotdeck-agent-loop-sidecar` 不存在。wrapper 仍是 `tools/agent-loop-parity/rust-tcp-sidecar.sh`（`:6` 读 `PILOTDECK_RUST_SIDECAR_BIN`，`:8` 默认仍是探针）。

采集环境：Python 3.12.3；harness 记录的 `node` 为 `v22.14.0`。rustc `1.99.1 (58cf8f9c3 2026-10-13)`。

## 范围

只动 `rust-core/pilotdeck-transport/**` 与 `docs/rust_rebuild/PLAN.md` 里 T-P2-01 D 的状态格。`apps/**` `ui/**` `src/**` `packages/**` `crates/**` 无 diff。产品默认路径未切。tools 缺口与其余 Track D 仍 open。
