# PROVENANCE · T-P2-02

对拍执行时的工作树是 `3c3050dbd5a5af3e98a72ed09783d62e76e8798c`（父提交 `3f7dd8f75c7f2db6da9764a79795f07164183f2a`，#48）。该提交只改 `tools/agent-loop-parity/rust-stdio-sidecar.sh`。历史从 `3f7dd8f7` 线性延伸，没有从 `main` 合并。

## rust-core 源树

- 附件：`agentcpm-rust-core-src.tgz`
- tarball sha256：`ef4235c2027f8eb58f5356a107826debb503946f1e81fd0976eaa830f420956d`
- 解压位置（仓外，未进入本仓 workspace）：`/tmp/agentcpm-rust-core-src/agentcpm-rust-core-src`
- 源树没有 `.git`。`pilotdeck-transport/build.rs` 因此把 `--version` 的 source 写成 `unregistered-build`。抽取说明里的来源仍是 `zhengdaqi/pilotdeck-rs` @ `1440be0`（见该树 `PROVENANCE.md`）。
- 工具链文件：该树 `rust-toolchain.toml` channel `1.99`，components `rustfmt`/`clippy`。workspace `edition = "2024"`，`rust-version = "1.93"`。
- 实际编译器：`rustc 1.99.1 (58cf8f9c3 2026-10-13)`（在源树目录里由 rustup 按 `rust-toolchain.toml` 选中）。本仓根目录的 `rust-toolchain.toml` 仍是 `1.83.0`，没有用来编这个二进制。

tarball 未带 `vendor/tiktoken-rs/assets/`（`include_str!` 需要 `o200k_base.tiktoken` 等）。构建前只把这些资源放回仓外源树，来自 crates.io `tiktoken-rs` 0.12.0，crate sha256 `027853bbf8c7763b77c5c595f1c271c7d536ced7d6f83452911b944621e57fc2`，与 rust-core `PROVENANCE.md` 记录的官方包哈希一致。没有把四 crate 或这些资源写进本仓。

## 二进制

```
cargo build --release -j 2 --bin pilotdeck-agent-loop-sidecar
```

工作目录：`/tmp/agentcpm-rust-core-src/agentcpm-rust-core-src`。`CARGO_EXIT:0`。

| 项 | 值 |
|---|---|
| 文件 | `/tmp/agentcpm-rust-core-src/agentcpm-rust-core-src/target/release/pilotdeck-agent-loop-sidecar` |
| sha256 | `f16b9e76c6f707f736e4befca7d232f85353c2afbaf35266c9f42c36693ba867` |
| `--version` | `pilotdeck-agent-loop-sidecar 0.1.0 implementation=rust wire=2.0 source=unregistered-build` |
| 身份链接 | 同目录 `pilotdeck-agent-loop` → 上述文件（符号链接） |

`PILOTDECK_RUST_SIDECAR_BIN` 指向符号链接。包装脚本对这个 basename 使用 `realpath -s`，proof 的 `resolved` 以 `pilotdeck-agent-loop` 结尾，不跟到 `*-sidecar`。`exec` 仍由内核跟随链接。产品协议未改。

全量 `pure_text` sidecar 轨迹中的 exec proof（`logs/sample-exec-proof.json`）：

```json
{
  "state": "rust_sidecar_exec",
  "pid": 11205,
  "bin": "/tmp/agentcpm-rust-core-src/agentcpm-rust-core-src/target/release/pilotdeck-agent-loop",
  "resolved": "/tmp/agentcpm-rust-core-src/agentcpm-rust-core-src/target/release/pilotdeck-agent-loop"
}
```

## 对拍命令

Node `v22.23.3`，Python `3.12.3`。先在本仓根目录完成 `pnpm build`（`dist/src/cli/pilotdeck-agent-loop-sidecar.js` 存在；这是 native/host 侧，不是被测 sidecar）。

```bash
export PATH="/home/ubuntu/.nvm/versions/node/v22.23.3/bin:$PATH"
export PILOTDECK_RUST_SIDECAR_BIN=/tmp/agentcpm-rust-core-src/agentcpm-rust-core-src/target/release/pilotdeck-agent-loop
python3 tools/agent-loop-parity/run.py \
  --pilotdeck-root /workspace \
  --comparison same-version \
  --surface gateway \
  --sidecar-transport stdio \
  --pilotdeck-stdio-sidecar-cmd tools/agent-loop-parity/rust-stdio-sidecar.sh \
  --scenario <pure_text|single_tool|all> \
  --output <run-dir>
```

快速门对 `pure_text`、`single_tool` 各跑 30 次（2026-10-15T19:20:00Z 至 19:23:19Z）。全量 `--scenario all` 一次（结束 2026-10-15T19:27:34Z，进程退出码 1）。summary 里 `scenarios=53`，`gateScenarioCount=53`，`sidecarImplementation=rust`，`sidecarImplementationSource=exec-proof`。

原始摘要：`logs/full53-summary.json`、`logs/quick-index.jsonl`、`logs/parity-run.log`。两处语义失败的报告原文：`logs/deadline-pilotdeck.md`、`logs/sidecar_budget_limit-pilotdeck.md`。
