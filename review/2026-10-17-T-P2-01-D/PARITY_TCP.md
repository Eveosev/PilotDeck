# PARITY_TCP · T-P2-01-D · P1–P5

代码提交 `66c2334be75c725e910887f55cd4297c35eb7219`。盖章二进制上的门禁采集于 2026-10-16T21:05Z–21:16:44Z。

身份与 #55 Formal 相同：`PILOTDECK_RUST_SIDECAR_BIN` → rust-core-proof symlink → `rust-core/target/release/pilotdeck-agent-loop-sidecar`。见 `PROVENANCE.md` 与 `raw/p1-p3.txt`。

TCP 观察器仍把 `sidecarImplementation` 标成 `ts`（`rustFingerprint=missing`，`rustSidecarIntended=false`）。按 TASK_DEF 忽略该标签。sidecar 日志首行是 `listening 127.0.0.1:<port>`，来自本次 release 二进制。

## P1 构建 — PASS

```bash
cd rust-core && cargo +1.99.1 build --release --locked -p pilotdeck-transport --bin pilotdeck-agent-loop-sidecar
# EXIT:0
```

产物：`rust-core/target/release/pilotdeck-agent-loop-sidecar`。sha256 `452b69c52257d51886e8402a12dd7e27d3bc39285241b9ad3ec0950e9f8558ac`。

## P2 单测 — PASS

```bash
cd rust-core && cargo +1.99.1 test --locked -p pilotdeck-transport
# EXIT:0
```

`raw/p2-cargo-test.txt`。各测试二进制 `test result` 相加 **186 passed / 0 failed**（lib 17、bin 2、bounded_capture 18、context_boundary 6、deadline_terminal 5、error_boundaries 11、factory_payload 21、host_contract 52、launch 1、server_owner 11、system_clock 35、tcp_listen 7、doc 0）。`deadline_terminal` 含本 PR 的 grace 内取消回复测例。未改 `pilotdeck-agent`。

## P3 身份 — PASS

```text
readlink -f "$PILOTDECK_RUST_SIDECAR_BIN"
# /workspace/rust-core/target/release/pilotdeck-agent-loop-sidecar
```

## P4 TCP 快速门 ×30 — PASS

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

## P5 TCP full-53 ×2 — PASS

期望 **51 pass / 2 trace_diff / 0 profile_gap / 0 BLOCKED**（分母 53）。failed 名只有 `deadline` 与 `sidecar_budget_limit`。

```bash
python3 tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --sidecar-transport tcp \
  --pilotdeck-tcp-sidecar-cmd tools/agent-loop-parity/rust-tcp-sidecar.sh \
  --scenario all \
  --output /tmp/tp201d/final/full1
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
  sidecar_budget_limit/PilotDeck: 1 semantic difference(s)
```

不在 `failed` 里的场景是 51。trace_diff 名 2 个。profile_gap 0。BLOCKED 0。`deadline_during_tool` 不在 `failed` 里（`PASS: no semantic differences after projection.`）。

同一二进制再跑一次（`/tmp/tp201d/final/full2`，`raw/full53-rerun-summary.txt`，EXIT:1）。`failed` 名单与第一次相同。`blocked`、`oracleFailures`、`knownGaps`、`expectedExtensions` 仍空。两次都是 **51/2/0/0**。

- `deadline`：仍是 3 semantic（额外 `gateway_submit_failed` + `durableStopReason` null + `resultType` null），所以是 contract mismatch，不是「verified 2 declared」。allowlist 内。`raw/deadline-pilotdeck.txt`、`raw/deadline-rerun-pilotdeck.txt`。
- `sidecar_budget_limit`：native 金额句 vs rust `max_budget_reached`。allowlist 内。`raw/sidecar_budget_limit-pilotdeck.txt`、`raw/sidecar_budget_limit-rerun-pilotdeck.txt`。
- `deadline_during_tool`：两次都没有 semantic diff。`raw/deadline_during_tool-pilotdeck.txt`、`raw/deadline_during_tool-rerun-pilotdeck.txt`。
