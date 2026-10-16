# PROVENANCE · T-P2-04

测试与采集时的源码提交是 `87b2d6b4e6fc193d6970de73466be5711b3d494c`，父提交 `2238c7ba7398c7f777f473937f0c9e2851130fbb`（`origin/rust_standalone_alpha1` 当时的 tip）。`git diff --stat 2238c7ba origin/rust_standalone_alpha1` 为空。本目录是其后的证据提交，不改 `rust-core/` 源码。`git status --porcelain` 在快速门、全量和性能采集开始前都是 0。

## 源包

- 附件：`agentcpm-rust-core-src.tgz`（未进仓；根 `.gitignore` 忽略 `*.tgz`）
- sha256：`ef4235c2027f8eb58f5356a107826debb503946f1e81fd0976eaa830f420956d`
- 上游记录：`zhengdaqi/pilotdeck-rs` @ `1440be0`（tarball `PROVENANCE.md`）
- 解压对照：`/tmp/agentcpm-extract/agentcpm-rust-core-src`
- 不进仓：tarball 内的 `agentcpm-rust-core/`（嵌套 `.git` 与 `.github/workflows/ci.yml`）

逐文件 sha256 见 `raw/file-sha256.txt`（仓内 130 个文件）。与 tarball 对比（排除 `agentcpm-rust-core/` 与 `target/`）：

- tarball 124 个文件全部在 `rust-core/`，其中 123 个字节相同
- 唯一内容差异：`rust-toolchain.toml`，`channel = "1.99"` → `"1.99.1"`
- 仓内多出 6 个文件：`.gitignore`（内容 `/target/`；tarball 根目录没有 `.gitignore`）、`.gitattributes`、四个 `.tiktoken`
- 非 vendor `*.rs` 92 个，与 tarball 字节相同。`Cargo.toml`、`Cargo.lock` 字节相同

## tiktoken assets

crates.io `tiktoken-rs-0.12.0.crate` sha256：`027853bbf8c7763b77c5c595f1c271c7d536ced7d6f83452911b944621e57fc2`。四个文件从该包的 `assets/` 解出。`encoder.json`、`vocab.bpe` 未提交。

| 文件 | 字节 | sha256 | tarball PROVENANCE |
|---|---:|---|---|
| `o200k_base.tiktoken` | 3613922 | `446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d` | `:229` |
| `cl100k_base.tiktoken` | 1681126 | `223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7` | `:227` |
| `p50k_base.tiktoken` | 836186 | `94b5ca7dff4d00767bc256fdd1b27e5b17361d7b8a5f968547f9f23eb70d2069` | `:230` |
| `r50k_base.tiktoken` | 835554 | `306cd27f03c1a714eca7108e03d66b7dc042abe8c258b44c199a7ed9838dd930` | `:231` |

合计 `du -bc` = **6966788** 字节，低于 12 MB。四个哈希与 tarball `PROVENANCE.md` 记录值一致。构建使用 `include_str!`，没有在 build 时下载这些文件。`cargo build` 按 lock 从 crates.io 取了其余依赖；下载列表里没有 `tiktoken-rs`（path vendor）。

## 工具链与二进制

在 `rust-core/`：

```
rustc 1.99.1 (58cf8f9c3 2026-10-13)
cargo 1.99.1 (5f94df478 2026-08-27)
1.99.1-x86_64-unknown-linux-gnu (overridden by '/workspace/rust-core/rust-toolchain.toml')
```

Release 二进制（`cargo +1.99.1 build --release --locked -p pilotdeck-transport --bin pilotdeck-agent-loop-sidecar`，`EXIT:0`，21.26s）：

| 项 | 值 |
|---|---|
| 路径 | `rust-core/target/release/pilotdeck-agent-loop-sidecar` |
| sha256 | `b766fed5af38de89fa248b2e495e56d89eb6cddaf71f81ef8bde4d0773f1d7d1` |
| `--version` | `pilotdeck-agent-loop-sidecar 0.1.0 implementation=rust wire=2.0 source=87b2d6b4e6fc193d6970de73466be5711b3d494c` |
| 身份链接 | `rust-core/target/rust-core-proof/pilotdeck-agent-loop` → `../release/pilotdeck-agent-loop-sidecar` |

`source=` 是构建时 `git rev-parse HEAD`。仓外无 `.git` 时为 `unregistered-build`；进仓后有 `.git`，所以印的是提交 SHA。这不是误标。`build.rs` 未改。与 T-P2-02 的 `f16b9e76…` 不同，因为嵌入的 source 字符串不同。

## 宿主

Node `v22.14.0`（本环境；T-P2-02/03 记录的是 `v22.23.3`）。Python `3.12.3`。`pnpm install --frozen-lockfile` 与 `pnpm build` 退出码都是 0（`raw/pnpm-build.txt`）。`dist/src/cli/pilotdeck-agent-loop-sidecar.js` 存在。这是 native / TS 宿主，不是 rust-core 二进制。

探针 `cargo +1.83.0 test --locked`（仓根）`EXIT:0`，日志 `raw/probe-test.txt`。
