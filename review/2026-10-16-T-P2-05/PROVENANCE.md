# PROVENANCE · T-P2-05

## 父提交

解锁基线与采集时的 `origin/rust_standalone_alpha1` tip 都是 `d740abe1330bbc4a7ca9e2264fed0dad72b9a866`（#53）。tip 没有前进。

```bash
git rev-parse origin/rust_standalone_alpha1
# d740abe1330bbc4a7ca9e2264fed0dad72b9a866

git diff --stat d740abe1330bbc4a7ca9e2264fed0dad72b9a866 d740abe1330bbc4a7ca9e2264fed0dad72b9a866
# （空）
```

代码提交 `9bd36089e4695410d6210e8d85f17873f23c6452`。P1–P10 命令在该提交的干净工作树上跑（perf provenance `gitDirty=false`，`gitSha=9bd36089e4695410d6210e8d85f17873f23c6452`）。本证据目录是之后的提交，不改 `rust-core` 源码，因此没有为了证据再编一次 release。

## 权威文件

- `TASK_DEF.md` sha256 `8716b0236133db164a90f2f93fd539c3cbc60fadc1e60434100c8bfabaec3dee`（与 UNLOCK 一致）
- `UNLOCK.md` 一并落入本目录

## 工具链与产物

工作目录 `rust-core/`。未设置 `CARGO_TARGET_DIR`。

```bash
cargo +1.99.1 build --release --locked -p pilotdeck-transport --bin pilotdeck-agent-loop-sidecar
# Finished release profile [optimized] target(s) in 22.18s
# EXIT:0
```

```text
pilotdeck-agent-loop-sidecar 0.1.0 implementation=rust wire=2.0 source=9bd36089e4695410d6210e8d85f17873f23c6452
sha256 2a0439fc29f22c59b00bf9dd0cf97461b9093a6627e48efc18d5ee80891f2c9d
```

`--version` 的 `source=` 是 build.rs 在有 `.git` 时写入的 HEAD，即上面的代码提交。

符号链接（对拍前创建，不入库）：

```text
rust-core/target/rust-core-proof/pilotdeck-agent-loop -> ../release/pilotdeck-agent-loop-sidecar
readlink -f → /workspace/rust-core/target/release/pilotdeck-agent-loop-sidecar
```

仓根 `target/release/pilotdeck-agent-loop-sidecar` 不存在。

采集环境：Python 3.12.3；harness 调到的 `node --version` 为 `v22.14.0`。rustc `1.99.1 (58cf8f9c3 2026-10-13)`。

## 范围

产品默认路径未切。`apps/**` `ui/**` `packages/**` `crates/**` 无 diff。`rust-tcp-sidecar.sh:8` 仍指向仓根探针。PC2 / PC1#3 / PC3 仍 open。本目录只记录 TCP 性能，不关闭 PC2。
