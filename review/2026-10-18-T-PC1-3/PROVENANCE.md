# PROVENANCE · T-PC1-3

- 基线：`rust_standalone_alpha1` @ `04e04ae33217288b226c13cec56ba1203f1ba333`（#64 merge，T-P2-09；tip `5bccc465`）
- 分支：`cursor/t-pc1-3-pc3-recollect-e277`
- PR：draft。ready / merge 仍等真 Payne。
- D0（`86e87682`）只改 `docs/rust_rebuild/PLAN.md`，相对 `04e04ae3` 的第一个 commit。
- 采集时 HEAD：`e6566d45aed490aa36386569b0548e83130ab02c`。JSON 里 `gitSha` = `collectSha` = 该 commit，`gitDirty=false`。
- `provenance.baseSha` = `04e04ae33217288b226c13cec56ba1203f1ba333`。采集命令传入 `--base-sha`。`tools/agent-loop-perf/run.py` 里该开关已经存在，本切片没有再改 E1 逻辑。
- 证据 commit 在采集之后。JSON 写在 `/tmp/tpc13/perf`，再原样拷进 `evidence/p2/pc1-3-pc3/`。没有覆盖 `evidence/p1/*.json`。
- 默认 transport 仍是 **native**。本分支没有翻转 `AgentLoopDeploymentProfile`，没有改 `apps/**`，没有关 PC2，没有开 Track C。

## 权威文件

- `TASK_DEF.md` sha256 `8618956b5545d3d5d7fc70f96cc13c0a6b06bb0c26ddd561e4ca95a301257be6`（与冻结稿一致，未改字节）
- `UNLOCK.md` sha256 `cda56d3f9c25997ab5a45de586fc2d2a72401293cf1715afa8de7f2233670e43`（与冻结稿一致，未改字节）
- `unlocked=true`（standing「其余全做」）

## 身份

| 项 | 值 |
|---|---|
| `PILOTDECK_RUST_SIDECAR_BIN` | `/workspace/rust-core/target/rust-core-proof/pilotdeck-agent-loop` |
| symlink | `../release/pilotdeck-agent-loop-sidecar` |
| `readlink -f` | `/workspace/rust-core/target/release/pilotdeck-agent-loop-sidecar` |
| 二进制 sha256 | `47a5239179068f3d3a5a9caf0b5dbed4c89398b631ac6cbecad94664bf8285f6` |
| wrapper 实测 cmdline | `/workspace/rust-core/target/rust-core-proof/pilotdeck-agent-loop --listen 127.0.0.1:50792` |
| `/proc/<pid>/exe` | `/workspace/rust-core/target/release/pilotdeck-agent-loop-sidecar` |

不是仓根探针 `target/release/pilotdeck-agent-loop`。证明在 `raw/identity/proof.txt`。符号链接在 `rust-core/.gitignore` 里，不入库。

perf JSON 的 `rustSidecarBin` 字段只在 stdio 路径填写。本趟是 TCP，该字段为 null。wrapper 进程自己的环境仍带 `PILOTDECK_RUST_SIDECAR_BIN`。`tcpSidecarCommand=tools/agent-loop-parity/rust-tcp-sidecar.sh`。`tcp.json` 的 `transport` 字段是 `rust-tcp`（文件名仍是 harness 的 `tcp.json`）。

## 为何 adapter 环境去掉这个变量

T-P2-06 起，`PILOTDECK_RUST_SIDECAR_BIN` 非空会让产品 supervisor 再 bind 同一端口。harness 已经用 `rust-tcp-sidecar.sh` 拉起 listener 时，两次 bind 得到 `Address already in use (os error 98)`，turn 没有 `handshake_completed`。

`e6566d45` 只在 harness **已经 spawn** TCP listener 时，从 gateway adapter 环境去掉 `PILOTDECK_RUST_SIDECAR_BIN` 和 `PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND`，并写 `PILOTDECK_AGENT_LOOP_TCP_SUPERVISE=0`。wrapper 进程仍保留该变量。只给 host/port、不 spawn 的 reuse 路径不改环境。产品默认 transport 仍是 native。`rust-tcp-sidecar.sh` 的默认探针路径没有改。

## 主机与工具链

| 项 | 值 |
|---|---|
| 主机 | Linux 6.12.94+，x86_64，4 vCPU Intel Xeon，15 GiB RAM，无 swap |
| 采集窗口 | `2026-10-18T07:59:29Z` – `2026-10-18T08:08:55Z` |
| rustc / cargo | `1.99.1`（`58cf8f9c3 2026-10-13` / cargo `5f94df478 2026-08-27`） |
| Node | `v22.23.3` |
| Python | `3.12.3` |
| 构建 | `cd rust-core && cargo +1.99.1 build --locked --release --bin pilotdeck-agent-loop-sidecar`（EXIT 0，`raw/build/cargo-build.txt`） |
| 宿主 | `pnpm install --frozen-lockfile` 与 `pnpm build`（EXIT 0）。`dist/src/cli/pilotdeck-agent-loop-sidecar.js` 存在。这是 native / TS 宿主，不是 rust-core 二进制 |

## 采集命令

```bash
export PILOTDECK_RUST_SIDECAR_BIN="$PWD/rust-core/target/rust-core-proof/pilotdeck-agent-loop"
python3 tools/agent-loop-perf/run.py \
  --pilotdeck-root "$PWD" \
  --scenarios pure_text,single_tool,sidecar_live_model_stream_chars_1,sidecar_live_model_stream_chars_50,sidecar_live_model_stream_chars_500 \
  --model-ms 200 \
  --iterations 30 \
  --transports native,tcp \
  --pilotdeck-tcp-sidecar-cmd tools/agent-loop-parity/rust-tcp-sidecar.sh \
  --base-sha 04e04ae33217288b226c13cec56ba1203f1ba333 \
  --output /tmp/tpc13/perf
```

EXIT 0。场景比 PC3 三场景多了 chars 1 与 500，用来同一次跑出 after-first。日志：`raw/perf-run.txt`。

流块布尔与 harness `n_chunks` 另用一次 live `collect_stream_chunks.py`（`PARITY_PERF=1`，`--run-gateway`）。native 用 `--trace-source native --transport native`。rust-core TCP 用 `--sidecar-transport tcp --pilotdeck-tcp-sidecar-cmd tools/agent-loop-parity/rust-tcp-sidecar.sh --transport rust-tcp --trace-source sidecar`。输出在 `raw/stream/`。每个 chars 是 **1** 次 live turn；n=30 的间隔与 `perf_n_chunks` 在 perf JSON。

rust-tcp 的 parity summary 对三个 chars 都是 exit 2：`rust sidecar fingerprint missing: context.budget did not precede model.request`。这是 budget 顺序指纹，trace 仍是当次新鲜文件。collector 读到了 `firstDeltaBeforeProviderCompletion=true`，且 harness `n_chunks` = `perf_n_chunks`。见 `raw/stream-rust-fingerprint.txt`。n=30 perf 的每一次 iteration 都是 PASS。

## G-GHA

**WAIVER-PENDING**。仓库 Actions 自 2026-10-15 02:40 CST 起 0 run。真 Payne 裁定用本地等效证据。本文件与 `raw/*` 是这份证据。不得写成 Actions PASS。

## 本地命令摘要

| 命令 | 结果 | 文件 |
|---|---|---|
| `cargo +1.99.1 build --locked --release --bin pilotdeck-agent-loop-sidecar` | EXIT 0 | `raw/build/cargo-build.txt` |
| `pnpm install --frozen-lockfile` / `pnpm build` | EXIT 0 | `raw/build/pnpm-install.txt`、`pnpm-build.txt` |
| perf n=30 native + rust-core tcp | EXIT 0，`gitDirty=false`，`baseSha` 匹配 | `evidence/p2/pc1-3-pc3/`、`raw/perf-run.txt` |
| `collect_stream_chunks.py` native / rust-tcp | 六个 live JSON 写出 | `raw/stream/` |
| parity unittest | 107 tests OK | `raw/unittest-parity.txt` |
| perf unittest | 25 tests OK | `raw/unittest-perf.txt` |
