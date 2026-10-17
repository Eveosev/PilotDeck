# PROVENANCE · T-P2-01-D2

- 基线：`rust_standalone_alpha1` @ `fbcfa7a9471045354de1dd33fefe9fc27bfd856b`（#60）
- 分支：`cursor/t-p2-01-d2-track-d-rest`
- 代码提交：`fcf765b51360cafe27242943b8003738bb8f4336`（tools）。D0 文档提交在它之前。
- 本文件与 `raw/` 是证据提交，不改产品代码。
- M-1：E1 在 fetch `origin/rust_standalone_alpha1` 之后重采，显式 `--base-sha fbcfa7a9471045354de1dd33fefe9fc27bfd856b`。`provenance.baseSha` 与 `git merge-base HEAD origin/rust_standalone_alpha1` 都是该 SHA。无参 `resolve_base` 返回同一值。
- PR 保持 **draft**。ready / merge 仍等真 Payne。
- 默认 transport 仍是 native。supervisor 仍是 opt-in。53 分母与 allowlist 未改。未改 `rust-core/**`。

## 权威文件

- `TASK_DEF.md` sha256 `3e24747f94bc43105c5cb933843db8bbbe91f0c884bca15b73a9811213bdd2c6`（与冻结稿一致）
- `UNLOCK.md` 一并落入本目录，未改

## 七项

| 项 | 状态 | path:line | 测试 |
|---|---|---|---|
| m2 | fix | `tools/agent-loop-perf/run.py:302` `label_perf_transport`；JSON `transport` 在 `:848` / `:881`；`rustCoreIdentity` 在 `:323` | `test_transport_label_distinguishes_native_ts_tcp_rust_tcp_rust_stdio` |
| m4 | fix | `tools/agent-loop-parity/collect_stream_chunks.py:357` `run_gateway`（先删残留，再用 mtime 认本轮文件；非零退出不读旧 trace） | `test_m4_nonzero_exit_does_not_read_stale_trace`；`test_m4_old_mtime_is_not_a_fresh_trace` |
| m5 | fix | `tools/agent-loop-parity/run.py:672` `command_names_rust_sidecar`；`:695` `rust_sidecar_intended`。匹配 `rust-tcp-sidecar.sh` 与 proof symlink `pilotdeck-agent-loop`，不再把 TS `pilotdeck-agent-loop-sidecar.js` 当成 Rust。`go-nogo.md` 历史数字不改 | `test_rust_intent_matches_tcp_wrapper_and_proof_symlink_not_ts_js` |
| m6 | fix | `evidence/p1/go-nogo.md:134` 列名，`:140` 脚注。`(p50)` 从 harness 列挪到 perf 列。数字未改 | 无单测；只改列名/脚注 |
| E1 | fix | `tools/agent-loop-perf/run.py:224` `resolve_base`。优先 `origin/<branch>`，显式 `--base-sha` 优先于两者。不在函数里 fetch | `test_resolve_base_prefers_origin_over_stale_local_branch` |
| n1 | fix | `tools/agent-loop-perf/run.py:176` `annotate_d4`，写入 `comparisonBaseline` 的 `d4` / `netP95DiffMs` / `diffOverD4` | `test_comparison_baseline_records_d4_and_diff_over_d4` |
| n3 | fix | `tools/agent-loop-parity/mock_backend.py:18` `configured_model_delay_ms`；`:130` 使用它。`int(delays.get("modelMs"))` 已不存在 | `test_fractional_model_ms_is_not_truncated` |

## G-GHA

**WAIVER-PENDING**。仓库 Actions 自 2026-10-15 02:40 CST 起 0 run。不得写成 PASS。本地等效证据是下面的 `raw/*`。

## 本地证据

| 命令 | 结果 | 文件 |
|---|---|---|
| `python3 -m pytest tools/agent-loop-perf tools/agent-loop-parity -q` | 132 passed，EXIT 0 | `raw/pytest.txt` |
| `node --test` | 本分支没有改 `.mjs`，P5 不适用。字面命令把目录当成模块，EXIT 非 0（`raw/node-test.txt`）。既有 `*.test.mjs` 为 16 pass / 0 fail（`raw/node-test-mjs.txt`） | 同上 |
| `cd rust-core && cargo +1.99.1 build --release --locked --bin pilotdeck-agent-loop-sidecar` | Finished，EXIT 0 | `raw/cargo-build.txt` |
| `readlink -f "$PILOTDECK_RUST_SIDECAR_BIN"` | `/workspace/rust-core/target/release/pilotdeck-agent-loop-sidecar` | `raw/readlink.txt` |
| stdio `pure_text` / `single_tool` | 两次 EXIT 0，`failed` 为空；报告均为 `PASS: no semantic differences after projection.` `sidecarImplementation=rust`，`rustSidecarIntended=true` | `raw/stdio-quick.txt`，`raw/stdio-pure_text-pilotdeck.txt`，`raw/stdio-single_tool-pilotdeck.txt` |
| stdio full-53 | 进程 EXIT 1（两条 trace_diff 使 run.py 非 0，与 #56 后的门一致）。53 分母。`blocked` / `oracleFailures` / `knownGaps` 为空。failed 只有 `deadline`（3 semantic）与 `sidecar_budget_limit`（1 semantic）。51/2/0/0 | `raw/full53.txt`，`raw/full53-counts.txt`，`raw/deadline-pilotdeck.txt`，`raw/sidecar_budget_limit-pilotdeck.txt` |
| E1 perf 产物 | `provenance.baseSha` = `fbcfa7a9471045354de1dd33fefe9fc27bfd856b`，与 fetch 后的 `git merge-base HEAD origin/rust_standalone_alpha1` 相同。`productDefaultTransport=native`。native 行 `d4=66.569`，`diffOverD4=0.0` | `raw/e1-base-sha.txt` |
| rust-core fmt / clippy / test | 未改 `rust-core/**`，P7 不适用，未跑 | — |

符号链接 `rust-core/target/rust-core-proof/pilotdeck-agent-loop` 指向 release 二进制，被 `rust-core/.gitignore` 忽略，不入库。

## P1–P10

| # | 结果 |
|---|---|
| P1 | D0 是 `fbcfa7a9..HEAD` 的第一个 commit。PLAN 把 T-P2-08 写成已合 #60 `fbcfa7a9`（tip `31a462e6`，G-GHA 真 Payne 豁免）。m2/m4 债务仍在 `:89` `:90`。T-P2-01 D 指向 T-P2-01-D2，进行中，未合 |
| P2 | 路径见 `git diff --name-only fbcfa7a9...HEAD`，外加本目录。无 `apps/**` `ui/**` `src/**` `packages/**` `crates/**` `.github/**`，无根 Cargo 文件 |
| P3 | 上表 7 行，每行有状态、path:line、测试名 |
| P4 | pytest 132 passed。E1、n1、m2、m4 各有新测例 |
| P5 | 未改 `.mjs`。既有 mjs 测例 16 pass |
| P6 | release sidecar EXIT 0。身份是 proof symlink 的 `readlink -f`。stdio 两场景 0 semantic diff。full-53 = 51/2/0/0，名仅 `deadline` 与 `sidecar_budget_limit` |
| P7 | 未改 rust-core，不适用 |
| P8 | `TRIAGE_53.md` + `raw/*`。perf `baseSha` = `fbcfa7a9471045354de1dd33fefe9fc27bfd856b`，与 fetch 后的 `git merge-base HEAD origin/rust_standalone_alpha1` 一致。显式 `--base-sha` 与无参 `resolve_base` 相同 |
| P9 | G-GHA = **WAIVER-PENDING**，不是 PASS |
| P10 | 只追加普通 commit。无 force-push / rebase / amend。PR draft。默认 transport 仍 native |
