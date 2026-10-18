# PROVENANCE · T-P2-09

- 基线：`rust_standalone_alpha1` @ `da96f0546bb6cf3f9123c70a348477c65ab07038`（#62 merge，T-P2-01-D2；tip `f71bd5a7`）
- 分支：`cursor/t-p2-09-agent-status-kind-text`
- PR：draft。ready / merge 仍等真 Payne。
- 代码提交在证据提交之前。D0 只改 `docs/rust_rebuild/PLAN.md`。D1 只改 `rust-core/pilotdeck-agent` 的 status 投影。
- 本文件、`TASK_DEF.md`、`UNLOCK.md`、`WIRE_KIND_TEXT.md` 与 `raw/` 是证据，不改产品行为。
- 默认 transport 仍是 native。本分支没有改 supervisor，也没有改 transport 选择。
- 符号链接 `rust-core/target/rust-core-proof/pilotdeck-agent-loop` 指向 release 二进制，被 `rust-core/.gitignore` 忽略，不入库。未设置 `CARGO_TARGET_DIR`。

## 权威文件

- `TASK_DEF.md` sha256 `2f5244d07355cad7eeb0e1bc87deb640d41318a2c8472a2518d8153a4aec9f62`（与冻结稿一致，未改字节）
- `UNLOCK.md` sha256 `eed7e959bcc5c70b8f6581adde901b3bd5cf0dbe838673b3e8d1ef42656ba9e3`（与冻结稿一致，未改字节）

## 投影

缺字段已补。`agent_status` 两臂都写出 `kind` 与非空 `text`。对照表见 `WIRE_KIND_TEXT.md`。

budget 终端 `text` 是 Gateway 金额句，不再是事件名 `max_budget_reached`。两次 full-53 的 durable.status 都是：

`statusKind=error`，`text=Reached Gateway-owned maxBudgetUsd ($0.500000) after spending $1.000000.`

这与 native 金额句相同，所以 `sidecar_budget_limit` 语义 0 diff。若以后仍有 status **文案**差，要和「缺 kind/text」分开记。本轮 budget 没有文案差。

## G-GHA

**WAIVER-PENDING**。仓库 Actions 自 2026-10-15 02:40 CST 起 0 run。不得写成 PASS。本地等效证据是下面的 `raw/*`。

## 本地证据

工具链：`rustc 1.99.1 (58cf8f9c3 2026-10-13)`，`cargo 1.99.1`。工作目录 `rust-core/`。

| 命令 | 结果 | 文件 |
|---|---|---|
| `cargo +1.99.1 fmt --check` | EXIT 0 | `raw/cargo-fmt.txt` |
| `cargo +1.99.1 clippy --workspace --all-targets --locked -- -D warnings` | EXIT 0 | `raw/cargo-clippy.txt` |
| `cargo +1.99.1 test --workspace --all-targets --locked` | 全部 `test result: ok`，EXIT 0 | `raw/cargo-test.txt` |
| `cargo +1.99.1 build --locked --release --bin pilotdeck-agent-loop-sidecar` | Finished release，EXIT 0。产物 `rust-core/target/release/pilotdeck-agent-loop-sidecar` | `raw/cargo-build.txt` |
| `readlink -f "$PILOTDECK_RUST_SIDECAR_BIN"` | `/workspace/rust-core/target/release/pilotdeck-agent-loop-sidecar` | `raw/readlink.txt` |
| stdio `pure_text` / `single_tool` | 两次 EXIT 0，`failed` 为空。报告均为 `PASS: no semantic differences after projection.` `sidecarImplementation=rust`，`sidecarImplementationSource=exec-proof` | `raw/stdio-quick.txt`，`raw/stdio-pure_text-pilotdeck.txt`，`raw/stdio-single_tool-pilotdeck.txt` |
| stdio full-53，第一次 | 分母 53。`blocked` / `oracleFailures` / `knownGaps` 为空。`failed` 为空。`deadline` 在 `expectedExtensions`：2 个已声明终态差（`durableStopReason`、`resultType`）。没有 `gateway_submit_failed`。`sidecar_budget_limit` 语义 0 diff。进程 EXIT 0 | `raw/full53.txt`，`raw/full53-counts.txt`，`raw/deadline-run1-pilotdeck.txt`，`raw/sidecar_budget_limit-pilotdeck.txt` |
| stdio full-53，第二次 | 分母 53。`blocked` / `oracleFailures` / `knownGaps` 为空。`failed` 只有 `deadline`（3 semantic：多一条 `gateway_submit_failed`，外加同样两个终态字段）。`sidecar_budget_limit` 仍是语义 0 diff。进程 EXIT 1 | `raw/full53-rerun.txt`，`raw/full53-rerun-counts.txt`，`raw/deadline-run2-pilotdeck.txt`，`raw/sidecar_budget_limit-rerun-pilotdeck.txt` |

两次身份都是 exec-proof。`profile_gap` 0，BLOCKED 0。

相对 #62 后主线的 51/2/0/0：两次都不差。稳定变绿的是 `sidecar_budget_limit`（两次复现，text 为金额句）。`deadline` 没有被修成语义 0。第一次它落在已声明扩展里，第二次它仍是 trace_diff。多出来的 `gateway_submit_failed` 与终态字段不是缺 `kind` / `text`，本切片不把它写成已修。

## P1–P9

| # | 结果 |
|---|---|
| P1 | `git log --reverse da96f054..HEAD` 的第一个 commit 是 D0，只改 PLAN。tip 记到 `da96f054`（#62，含 T-P2-01-D2；tip `f71bd5a7`；G-GHA 真 Payne 豁免，本地等效证据）。T-P2-09 写的是进行中 / 本 PR / 未合 |
| P2 | 路径 ⊆ `docs/rust_rebuild/PLAN.md`、`rust-core/pilotdeck-agent/**`、`review/2026-10-18-T-P2-09/**`。无 `apps/**`、`ui/**`、`packages/**`，没有删 TS `kind` / `text` |
| P3 | `turn_wire::tests` 锁定 `AgentStatus` 与 `AgentStatusText` 都含 `kind` 与 `text` |
| P4 | budget 终端 `text` 为 `Reached Gateway-owned …`。过时「AgentLoop omits text」注释已改写 |
| P5 | fmt / clippy `-D warnings` / `test --locked` 绿，见 `raw/*` |
| P6 | release sidecar + exec-proof。stdio `pure_text` / `single_tool` 语义 0 diff。full-53 分母 53，两次都不差于 51/2/0/0。budget 变绿已两次复现。deadline 仍可有终态差 / 多事件 |
| P7 | 缺字段已补。budget 文案已对齐。deadline 余差与缺字段分开记 |
| P8 | G-GHA = **WAIVER-PENDING**，加上 P5–P6 的 `raw/*`。不是 PASS |
| P9 | 只追加普通 commit。无 force-push / rebase / amend。PR draft。默认 transport 仍 native |
