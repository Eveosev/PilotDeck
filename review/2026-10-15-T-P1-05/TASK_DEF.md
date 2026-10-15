# TASK_DEF · T-P1-05 两组对照报告（Rust-tcp vs native / Rust-tcp vs TS-tcp）

**Base：** `rust_standalone_alpha1` @ `b3399c14`（T-P1-04-FU #36 已合）  
**状态：** 已解锁（Payne 1:1）。本文件由提案定稿，并写入锁定决策。  
**Whitelist：** `tools/agent-loop-parity/**`（含 `rust-tcp-sidecar.sh`、collector、stream-chunks helper / 测试）；`tools/agent-loop-perf/**`（`--model-ms`、net-of-delay、METRICS）；`evidence/p1/**`；`review/2026-10-15-T-P1-05/**`。  
**禁止：** `crates/**`、`Cargo.lock`、`apps/desktop/**`、`ui/**`、协议 schema；不改 53 场景 gate 语义；默认 2-delta 与 `_chars` n_chunks **98 / 22 / 4** 不变。  
**Out：** go / 有条件 go / no-go 决议与签字（T-P1-06，Payne）；真模型；生产 TCP 认证（D7）；ready / merge。

来源：`TASK_DEF-PROPOSAL`（Arch 2026-10-15）+ Payne 锁定项。

## 口径表（先读）

| 本任务用语 | 含义 | 不是 |
|---|---|---|
| **Rust-tcp** | Rust sidecar 走 TCP | T-P1-03 `summary.md` 把「TS native vs Rust sidecar TCP」叫过 "TS-tcp" |
| **TS-tcp** | TS sidecar 走 TCP（`perf-baseline/tcp.json` 那条路径） | Rust |
| **native** | 产品默认 in-process AgentLoop | sidecar |
| **source=sidecar** | live sidecar trace（#36 follow-up：不再标 `gateway`） | Gateway 进程本身 |
| **source=native** | live native adapter trace | |
| **source=planned-from-scenario** | fixture 推导，不是 live | |

## Payne 锁定决策

1. **Mock delay = 方案 B。** 三条路径（Rust-tcp / native / TS-tcp）用**同一套** mock：`delays.modelMs: 200`。一套配置同时测 turn、model 迭代、流块。
2. **同时报 raw 与 net-of-delay。** net = raw − `configuredModelMs`（turn：× 该样本 model 次数；model 迭代：每次 −200；流块：只从 interval[0] 扣，后续间隔是转发）。D4 = `max(native 净 P95 × 10%, 5ms)`，**只看净数**。
3. **三条路径都在 modelMs:200 下重采。** 不拿 delay-0 的 `evidence/perf-baseline/tcp.json` 做门禁对照（可引用形态/量级）。
4. **采集机 = 本 cloud VM。** 这里 `pnpm build` 和 `--run-gateway` live；`PARITY_PERF=1`。turn / model 迭代每条路径 **≥30** 次。
5. **折入 #36 review follow-up：** sidecar trace 统一 `source=sidecar`（不再标 gateway）；`stream-chunks.test.mjs` #8 必须是行为测试（helper 坏了要红，不能只 grep 源码）。

## 验收

| ID | 项 |
|---|---|
| C0 | `dist/` 存在（本 VM `pnpm build`）；FU 已在 base `b3399c14` |
| C1 | live `stream_chunk_ms` 非空；`source=sidecar` 或 `native`（不是 gateway）；`planned` 不为 true；产物有 `transport`；live 文件不覆盖 planned `stream-chunks-{1,50,500}.json` |
| C2 | turn / model 迭代给出 P50/P95 与 n；三路径口径一致（modelMs:200）；≥30 次/路径 |
| C3 | `evidence/p1/go-nogo.md`：两组对照 × 三单位（turn / model 迭代 / 流块）；判定列只用相对 native；Rust-tcp vs TS-tcp 仅参考；**不写 go/no-go 结论** |
| C4 | 流块 interval[0] 扣除模型延迟；区分 harness `n_chunks` 与 `perf_n_chunks` |

## 回归钉

- 53-scenario gate 不变
- 默认 `sidecar_live_model_stream` = STREAM_PREFIX + 1 remainder = **2 deltas**（含空字符串）
- `_chars_{1,50,500}` n_chunks **98 / 22 / 4**
- 既有单测数量只增不减
