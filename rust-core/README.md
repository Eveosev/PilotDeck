# PilotDeck Rust sidecar（rust-core）

把 [PilotDeck](https://github.com/OpenBMB/PilotDeck) 的 **agent 循环 sidecar** 用 Rust 重写的那部分代码，
从 [zhengdaqi/pilotdeck-rs](https://github.com/zhengdaqi/pilotdeck-rs) 里单独拎出来的独立工作区。

> **它是什么**：一个走 stdio 的 NDJSON 进程。TS gateway 通过环境变量
> `PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND` 指向它，就能把原来的 TS sidecar 换成 Rust 的，
> **TS 那一侧一行不改**。

## 为什么单独一个仓

原仓 `pilotdeck-rs` 是一个 Cargo workspace，里面对应四个阶段的产物：

| crate | 阶段 | 在本仓 |
|---|---|---|
| `pilotdeck-protocol` | C | ✅ |
| `pilotdeck-tokenizer` | C | ✅ |
| `pilotdeck-agent` | C | ✅ |
| `pilotdeck-transport` | C | ✅ |
| `pilotdeck-gateway` | A（替换 18789 上的 gateway） | ❌ 不在此 |
| `pilotdeck-yaml` | A（仅被 gateway 依赖） | ❌ 不在此 |
| `pilotdeck-cli` | A/D（`pilotdeck` 命令入口占位） | ❌ 不在此 |

本仓 = 阶段 C 的完整边界：**一个能独立编译、独立测试、独立产出的 sidecar 二进制**。

## 仓库结构

```
.
├── Cargo.toml                  # workspace：4 个成员 + exclude vendor
├── Cargo.lock                  # 锁定，随代码提交
├── rust-toolchain.toml         # channel = "1.99"
├── LICENSE                     # AGPL-3.0-only（上游许可证，必须保留）
├── PROVENANCE.md               # 来源 commit、逐文件 sha256、适配例外
├── docs/
│   ├── DEVELOPMENT.md          # ⭐ 开发文档（先读这份）
│   ├── ARCHITECTURE.md         # 四个 crate 的分层、数据流、线程模型
│   └── PROTOCOL.md             # Module 2.0 wire 契约（照抄就靠它）
├── pilotdeck-protocol/         # 线协议边界：JS 语义 JSON、信封校验、准入
├── pilotdeck-tokenizer/        # o200k tokenizer（内嵌词表，无 IO）
├── pilotdeck-agent/            # agent 循环核心（turn / 恢复策略 / 请求组装）
├── pilotdeck-transport/        # 进程与 IO 边界；产出 sidecar 二进制
└── vendor/tiktoken-rs/         # 上游 fork，exclude 出 workspace
```

## 快速开始

```bash
# 工具链：rust-toolchain.toml 已钉 1.99，rustup 会自动装
cargo build --release --bin pilotdeck-agent-loop-sidecar

# 三条闸门（与上游 CI 一致）
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets

# 确认二进制契约
./target/release/pilotdeck-agent-loop-sidecar --version
# pilotdeck-agent-loop-sidecar 0.1.0 implementation=rust wire=2.0 source=<git-commit>
```

本仓当前状态：fmt / clippy / test 三绿，测试 **696 项全过**
（agent 479 · transport 174 · protocol 27 · tokenizer 16）。

## 两条硬约束（改代码前必读）

1. **这是一个「对拍重写」产物**：一致的判据是**与 TS sidecar 的语义事件归一化后相同**，
   不是「代码更漂亮」。行为对齐优先于架构整洁；发现 TS 原版有 bug 也要**先记录再改**，
   改完登记进已接受差异清单。详见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) 第 6 节。
2. **上游许可证是 AGPL-3.0-only**，本仓作为衍生作品同样如此。`LICENSE` 与
   `vendor/tiktoken-rs/LICENSE` 都不许删。

## 来源与许可

本仓代码源自 [zhengdaqi/pilotdeck-rs](https://github.com/zhengdaqi/pilotdeck-rs) 的 `src/`
（该仓是 [OpenBMB/PilotDeck](https://github.com/OpenBMB/PilotDeck) 后端的 Rust 重写，
基线为 `standalone_alpha1` 分支的 `cc7c4e6`，2026-10-13）。上游以 **AGPL-3.0** 发布，
本仓同样以 **AGPL-3.0-only** 发布，全文见 [`LICENSE`](LICENSE)。
逐文件来源哈希与适配改动见 [`PROVENANCE.md`](PROVENANCE.md)。
