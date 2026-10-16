# ADOPT_NOTES · T-P2-04

## 合箱与 workspace

合箱选 **选项 A**：`pilotdeck-protocol` / `pilotdeck-tokenizer` / `pilotdeck-agent` / `pilotdeck-transport` 四个 crate 分立，不合并，不自写 transport 壳。

Workspace 选 **方案 B**：`rust-core/` 独立嵌套 workspace。根 `Cargo.toml`、`Cargo.lock`、`rust-toolchain.toml`、`.github/workflows/rust-hello.yml` 相对 `2238c7ba` 为 0 diff，根 workspace 不加 `exclude`。方案 A（把根 workspace 升到 1.99）未采用。这不是 T-P2-07 的 7 crate workspace。`PLAN.md` 只改了 D-CORE 注脚、T-P2-04 行、T-P2-08 行。

## 默认路径未切

产品默认仍是探针 / native。证据在 `raw/p4-p6-e1.txt`：

- `git diff --stat 2238c7ba -- apps/ tools/ src/ ui/ crates/ packages/` 无输出
- `apps/desktop/scripts/rust-hello.mjs:8` 仍是 `pilotdeck-agent-loop-hello`
- `rust-stdio-sidecar.sh:12` 与 `rust-tcp-sidecar.sh:8` 的默认路径仍是仓根 `target/release/pilotdeck-agent-loop`（探针）
- `src/cli/AgentLoopDeploymentProfile.ts:139` 在 `readTransport` 未设置时返回 `"native"`
- P3 构建之后 `ls target/release/pilotdeck-agent-loop-sidecar` 不存在。随后的根 1.83 release 构建产物是 `pilotdeck-agent-loop` 与 `pilotdeck-agent-loop-hello`，仍然没有这个 sidecar 文件名

对拍用的符号链接只在 `rust-core/target/rust-core-proof/pilotdeck-agent-loop`。`CARGO_TARGET_DIR` 未指向共享目录。

## PC*

- PC2 仍 open。本 PR 的 stdio 数字不能关闭它，也不能拿去对常驻 TCP。
- PC1#3、PC3 仍 open。T-P2-04 合入后旧数字作废，必须重采。本 PR 不重采、不关闭。
- 未做 TCP / D7（T-P2-05）。全量与性能都是 stdio。`tcpSidecarCommand` 为 null。

## 协议同步门

未改 `protocol.ts`，未改 `evidence/protocol-sync-gate.md`。检查 5 的证据：四 crate `cargo +1.99.1 test --locked` 696 项通过，探针 `cargo +1.83.0 test --locked` 通过。其余检查 N/A，协议面没有改动。

覆盖缺口：门禁触发路径只有 `crates/`。以后只改 `rust-core/pilotdeck-protocol` 的 PR 不会触发检查 5。已写进 `PLAN.md` T-P2-08 行（protocol-sync-gate 触发路径加 `rust-core/**`），本 PR 不改门禁文件。

## 已知项

1. rustup 按 cwd 选工具链。编 rust-core 必须在 `rust-core/` 下，或显式 `+1.99.1`。在仓根用 `--manifest-path` 会选中 1.83.0 然后失败。`CARGO_TARGET_DIR` 不要指到共享目录，否则 sidecar 会落到仓根 `target/`。
2. `tools/agent-loop-parity/README.md` 里 `target/release/pilotdeck-agent-loop-sidecar` 的 TCP 示例，在方案 B 下不会出现在该路径。交给 T-P2-05，本 PR 不改 `tools/**`。
3. `pilotdeck-transport/build.rs` 在有 `.git` 时把 `--version` 的 source 写成 HEAD。本次为 `87b2d6b4e6fc193d6970de73466be5711b3d494c`。不是误标，不改 `build.rs`。证据提交之后重新构建会印新的 HEAD，源码字节不变。
4. 全量 53 在同一二进制上连续两次，`summary.failed` 的名单不一致。见 `GATES.md` P8。两条都不是 `profile_gap`，不在本 PR 修。
5. P9 的 D4：`single_tool` 差/D4 = 1.459，`sidecar_live_model_stream_chars_50` = 1.221。按规格只记录，不因此判 FAIL。Q2 未超标。
