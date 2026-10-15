# PROVENANCE · T-P2-03

采集时工作树干净。`gitSha` = `collectSha` = `428858d99dc581cd0da9081a36512d4cb28dcdc9`，`gitDirty=false`。该提交的父提交是 T-P2-02 tip `028cef88d20f70cee46bac25bdcbc0a911f73ddb`。`baseSha` 是采集时 `git merge-base HEAD origin/rust_standalone_alpha1` 的结果：`3f7dd8f75c7f2db6da9764a79795f07164183f2a`（`origin/rust_standalone_alpha1` 当时的 tip，#48）。#50 尚未合入该分支，所以 `baseSha` 不是 `028cef88`。

JSON 里的 `gitSha` / `collectSha` / `baseSha` / `gitDirty` 以 `raw/*.json` 的 `provenance` 为准。加证据的这次提交不能写进 JSON。

## rust-core 源树

- 附件：`agentcpm-rust-core-src.tgz`
- tarball sha256：`ef4235c2027f8eb58f5356a107826debb503946f1e81fd0976eaa830f420956d`（与 T-P2-02 `review/2026-10-16-T-P2-02/PROVENANCE.md` 记录的指纹相同）
- 解压位置（仓外，未进入本仓 workspace）：`/tmp/agentcpm-rust-core-src/agentcpm-rust-core-src`
- 源树没有 `.git`。`pilotdeck-transport/build.rs` 因此把 `--version` 的 source 写成 `unregistered-build`。抽取说明里的来源仍是 `zhengdaqi/pilotdeck-rs` @ `1440be0`。
- 工具链文件：该树 `rust-toolchain.toml` channel `1.99`，components `rustfmt` / `clippy`，profile `minimal`。workspace `edition = "2024"`，`rust-version = "1.93"`。
- 实际编译器：`rustc 1.99.1 (58cf8f9c3 2026-10-13)`（在源树目录里由 rustup 按该树的 `rust-toolchain.toml` 选中）。本仓根目录的 `rust-toolchain.toml` 仍是 `1.83.0`，没有用来编这个二进制。

tarball 未带 `vendor/tiktoken-rs/assets/`（`pilotdeck-tokenizer` 的 `include_str!` 需要 `o200k_base.tiktoken`）。构建前只把这些资源放回仓外源树，来自 crates.io `tiktoken-rs` 0.12.0，crate sha256 `027853bbf8c7763b77c5c595f1c271c7d536ced7d6f83452911b944621e57fc2`，与 rust-core `PROVENANCE.md` 记录的官方包哈希一致。没有把四 crate 或这些资源写进本仓。

## 二进制

```
cd /tmp/agentcpm-rust-core-src/agentcpm-rust-core-src
cargo build --release -j 2 --bin pilotdeck-agent-loop-sidecar
```

`CARGO_EXIT:0`。`Finished release profile [optimized] target(s) in 31.74s`。

| 项 | 值 |
|---|---|
| 文件 | `/tmp/agentcpm-rust-core-src/agentcpm-rust-core-src/target/release/pilotdeck-agent-loop-sidecar` |
| sha256 | `f16b9e76c6f707f736e4befca7d232f85353c2afbaf35266c9f42c36693ba867` |
| `--version` | `pilotdeck-agent-loop-sidecar 0.1.0 implementation=rust wire=2.0 source=unregistered-build` |
| 身份链接 | 同目录 `pilotdeck-agent-loop` → `pilotdeck-agent-loop-sidecar`（相对符号链接） |

sha256 与 T-P2-02 记录的二进制哈希相同。本轮身份不以 `--version` 或这个哈希为准，以每轮 exec proof 为准（见下）。

`PILOTDECK_RUST_SIDECAR_BIN` 只在 rust-stdio 那一次采集里指向符号链接。包装脚本 `tools/agent-loop-parity/rust-stdio-sidecar.sh` 对 basename `pilotdeck-agent-loop` 使用 `realpath -s`，proof 的 `resolved` 以 `pilotdeck-agent-loop` 结尾，不跟到 `*-sidecar`。内核在 `exec` 时跟随链接。产品协议未改。

单独观察（不是性能轮）：同一二进制在 `PILOTDECK_AGENT_LOOP_TCP_PORT=9` 时退出码 2，stderr 为 `Rust candidate does not yet support the PILOTDECK_AGENT_LOOP_TCP_PORT deployment profile.`；`--listen` 也是退出码 2。本轮 perf 命令没有 TCP 参数，`tcpSidecarCommand` 在三份 JSON 里都是 `null`。

## 宿主

Node `v22.23.3`（`/home/ubuntu/.nvm/versions/node/v22.23.3/bin`），Python `3.12.3`。采集前在本仓根目录完成 `pnpm build`（`dist/src/cli/pilotdeck-agent-loop-sidecar.js` 存在）。这是 native / TS-stdio 的宿主与 TS sidecar，不是 rust-core 二进制。

三条命令分开跑，避免把 TS-stdio 标成 Rust。输出先落在 `/tmp/t-p2-03/`，再原样拷进 `raw/`。`--model-ms 200` 使 `delay_injected=true`，`primaryBaseline` 为空；读 `comparisonBaseline` 和 `scenarios.*.*_net_of_model_ms`。

### native

环境：未设置 `PILOTDECK_RUST_SIDECAR_BIN`，未设置 `PARITY_STDIO_SIDECAR_COMMAND`，未设置 TCP 变量。

```bash
python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --scenarios pure_text,single_tool,sidecar_live_model_stream_chars_50 \
  --model-ms 200 \
  --iterations 30 \
  --transports native \
  --output /tmp/t-p2-03/native
```

`2026-10-15T20:49:19.225784+00:00` 至 `2026-10-15T20:51:50.059918+00:00`。文件：`raw/native.json`、`raw/native-summary.json`。

### TS-stdio

同样不设置 Rust bin 与 stdio 覆盖。默认 stdio 由宿主按 turn 拉起 `dist/src/cli/pilotdeck-agent-loop-sidecar.js`。这是和 rust-core 相同的「每 turn 拉起」形态，不是常驻 TCP。

```bash
python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --scenarios pure_text,single_tool,sidecar_live_model_stream_chars_50 \
  --model-ms 200 \
  --iterations 30 \
  --transports stdio \
  --output /tmp/t-p2-03/ts-stdio
```

`2026-10-15T20:51:50.219414+00:00` 至 `2026-10-15T20:55:22.832375+00:00`。文件：`raw/ts-stdio.json`、`raw/ts-stdio-summary.json`。`stdioSidecarCommand` 为 `null`，`stdioSidecarActive` 为 false。

### rust-core stdio

```bash
export PILOTDECK_RUST_SIDECAR_BIN=/tmp/agentcpm-rust-core-src/agentcpm-rust-core-src/target/release/pilotdeck-agent-loop
python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --scenarios pure_text,single_tool,sidecar_live_model_stream_chars_50 \
  --model-ms 200 \
  --iterations 30 \
  --transports stdio \
  --pilotdeck-stdio-sidecar-cmd tools/agent-loop-parity/rust-stdio-sidecar.sh \
  --output /tmp/t-p2-03/rust-stdio
```

该 CLI 把命令传给 parity adapter，由 adapter 设置 `PARITY_STDIO_SIDECAR_COMMAND`，并为每一轮 trace 设置 `PARITY_RUST_SIDECAR_PROOF=<trace>.rust-exec.jsonl`。包装脚本在 `exec` 前追加 `{pid,bin,resolved}`。gateway 再把这些行刷进 trace 的 `harness.proof` / `rust_sidecar_exec`。临时 proof 文件随运行目录删除；保留下来的是 JSON 里每一轮的 `execProof.wrapper` 与 `execProof.trace`。

`2026-10-15T20:55:23.000322+00:00` 至 `2026-10-15T20:58:24.878115+00:00`。文件：`raw/rust-stdio.json`、`raw/rust-stdio-summary.json`。

汇总：`execProof.iterationsWithProof=90`（3 场景 × 30）。`bin` 与 `resolved` 都只有

`/tmp/agentcpm-rust-core-src/agentcpm-rust-core-src/target/release/pilotdeck-agent-loop`

90 个 pid 互不相同。wrapper 与 trace 一致。`pure_text` 第 1 轮摘录：`raw/sample-exec-proof.json`（pid 9854）。

JSON `provenance` 同时写了 `rustSidecarTarget`（`realpath` 跟随链接后的 `pilotdeck-agent-loop-sidecar`）和 `rustSidecarSha256`。proof 本身停在符号链接路径上。
