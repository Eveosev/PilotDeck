# PARITY_TCP · T-P2-05 · P6 / P10

代码提交 `9bd36089e4695410d6210e8d85f17873f23c6452`。采集 2026-10-16T13:55:11Z–14:09:49Z。

```bash
export PILOTDECK_RUST_SIDECAR_BIN="$PWD/rust-core/target/rust-core-proof/pilotdeck-agent-loop"
echo "$PILOTDECK_RUST_SIDECAR_BIN"
# /workspace/rust-core/target/rust-core-proof/pilotdeck-agent-loop
readlink -f "$PILOTDECK_RUST_SIDECAR_BIN"
# /workspace/rust-core/target/release/pilotdeck-agent-loop-sidecar
```

不是仓根探针 `target/release/pilotdeck-agent-loop`。

## ① cargo test — PASS

```bash
cd rust-core && cargo +1.99.1 test --locked -p pilotdeck-transport
# EXIT:0
```

`raw/p6-cargo-test.txt`。各测试二进制 `test result` 相加 **185 passed / 0 failed**（含本 PR 的 tcp 单测与 `tests/tcp_listen.rs`）。

## ② 身份

`PILOTDECK_RUST_SIDECAR_BIN` 指向 proof symlink，`readlink -f` 到 release sidecar。wrapper 是 `tools/agent-loop-parity/rust-tcp-sidecar.sh`（`:6` 读该变量，`:8` 默认仍是探针）。

`PARITY_RUST_SIDECAR_PROOF`：`run.py:659` 只在设置了 stdio sidecar 命令时写入环境变量；adapter `adapters/pilotdeck_gateway_impl.mjs:139` 读取它。TCP 快速门 / 全量没有 stdio 命令，因此没有生成 `*.rust-exec.jsonl`。P10 stdio 有，见下。

TCP 观察器只用 `context.budget` 先于 `model.request` 的 fingerprint 标 rust（`trace.py`）。rust-core 的顺序与 native 相同（先 `model.request` 再 `context.budget`），所以 `sidecarImplementation=ts`、`rustFingerprint=missing`。`rustSidecarIntended=false`，因为启动命令是 `rust-tcp-sidecar.sh`，字符串里没有 `pilotdeck-agent-loop`（`run.py` 的既有判定）。缺 fingerprint 时因此不 BLOCKED。语义比较照常进行。本 PR 不改 harness。sidecar 日志首行是 `listening 127.0.0.1:<port>`，来自本次 release 二进制。

## ③ 快速门 ×30 — PASS

`pure_text`、`single_tool` 各 30 次。命令：

```bash
python3 tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --sidecar-transport tcp \
  --pilotdeck-tcp-sidecar-cmd tools/agent-loop-parity/rust-tcp-sidecar.sh \
  --scenario <pure_text|single_tool> \
  --output <run-dir>
```

60/60 退出码 0。`failed`、`blocked`、`oracleFailures` 皆空。逐次在 `raw/quick-index.txt`。**0 semantic diff**。

## ④ 全量 53

期望文案保持 **51 pass / 2 trace_diff / 0 profile_gap / 0 BLOCKED**（分母 53）。允许的 trace_diff 名只有 `deadline` 与 `sidecar_budget_limit`。不把 `deadline_during_tool` 写入 allowlist。

```bash
python3 tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --sidecar-transport tcp \
  --pilotdeck-tcp-sidecar-cmd tools/agent-loop-parity/rust-tcp-sidecar.sh \
  --scenario all \
  --output /tmp/tp205/full
# EXIT:1
```

`raw/full53-summary.txt`：

```text
scenarios 53
gateScenarioCount 53
blocked []
oracleFailures []
knownGaps []
expectedExtensions []
failed:
  deadline/PilotDeck: transport contract mismatch (3 semantic difference(s))
  deadline_during_tool/PilotDeck: 1 semantic difference(s)
  sidecar_budget_limit/PilotDeck: 1 semantic difference(s)
```

不在 `failed` 里的场景是 50。trace_diff 名 3 个。profile_gap 0。BLOCKED 0。

- `sidecar_budget_limit`：native 金额句 vs rust `max_budget_reached`。allowlist 内。报告 `raw/sidecar_budget_limit-pilotdeck.txt`。
- `deadline`：除基线差额外，多了一条 `gateway_submit_failed`（`result_unknown` / host reconciliation found no final result），于是变成 3 diff 的 contract mismatch，而不是「verified 2 declared」。报告 `raw/deadline-pilotdeck.txt`。
- `deadline_during_tool`：同一句 `gateway_submit_failed`。**Track D**。不扩 allowlist，本 PR 不修。报告 `raw/deadline_during_tool-pilotdeck.txt`。

本趟没有落在锁定的 51/2 名单上。期望文案不改成 50/3。

同一二进制再跑一次全量（`/tmp/tp205/full2`，`raw/full53-rerun-summary.txt`，EXIT:1）。`failed` 名单与第一次相同：`deadline`（3 diff contract mismatch）、`deadline_during_tool`（Track D）、`sidecar_budget_limit`。`blocked` 与 `oracleFailures` 仍空。不是单次抖动换位；本 tip 上这两次都是 50/3/0/0。allowlist 仍只有 `deadline` 与 `sidecar_budget_limit`。

## P10 stdio — PASS

`PILOTDECK_RUST_SIDECAR_BIN` 同上。`pure_text` ×5，stdio，0 diff，`sidecarImplementation=rust`，`sidecarImplementationSource=exec-proof`。

再在 `PILOTDECK_AGENT_LOOP_TCP_TOKEN=production-token` 下跑同一门 ×5，仍 0 diff，身份仍是 exec-proof。

`PARITY_RUST_SIDECAR_PROOF` 路径形如：

```text
/tmp/tp205/stdio/01/pure_text.pilotdeck-current-sidecar.jsonl.rust-exec.jsonl
/tmp/tp205/stdio-token/01/pure_text.pilotdeck-current-sidecar.jsonl.rust-exec.jsonl
```

样例内容（`realpath -s`，不跟随最后的 symlink，因此 `resolved` 仍以 `pilotdeck-agent-loop` 结尾）：

```json
{"pid":18528,"bin":"/workspace/rust-core/target/rust-core-proof/pilotdeck-agent-loop","resolved":"/workspace/rust-core/target/rust-core-proof/pilotdeck-agent-loop"}
```
