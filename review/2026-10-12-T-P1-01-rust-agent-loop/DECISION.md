# T-P1-01 决策包：最小 Rust agent loop（草稿，2026-10-12 19:40）

- 基线：`rust_standalone_alpha1@1da663a2`（含 PR#1–#5）。目标分支同上，draft PR。
- 依据：TASK_PLAN.md:76（hello/capabilities/execute/cancel/status，无 resume/ack；"能按 sidecar 协议对话"）；P1 入口已满足（T-P0a-00/01/02/03 已合，T-G0-05/D4 于 10-10 接受，TASK_PLAN.md:7）。
- 负责：Arch；验收口径：QA；粗估 5–7 人天。

## 范围
- 协议唯一来源：`src/agent/modules/protocol.ts`（validateModuleMessage :264；execute :277、cancel :299、status :306、hello/capabilities :323；resume :311 / ack :317 不做）。
- 契约：`evidence/schema/module-protocol.schema.json`（T-P0a-01，PR#5）。
- crate 位置：复用 T-P0a-05 的 cargo workspace（根 `Cargo.toml` members=`crates/pilotdeck-agent-loop-hello`）。新增 `crates/pilotdeck-agent-loop/`（lib + bin），hello crate 保持不动（Desktop 冒烟依赖它）。不建 `pilotdeck-rs/`（那是 T-P2-07，TASK_PLAN.md:98）。
- 传输：D7=TCP 常驻（DECISION.md:20；TASK_PLAN.md:7）；宿主 TCP 只 connect 不拉起（DECISION.md:27，`AgentLoopDeploymentProfile.ts:52-58`）。本任务：核心与传输解耦，**先 stdio JSONL**（沿用 hello crate 做法，便于单测/对拍），S4 加 `--listen 127.0.0.1:0` TCP 监听，供 T-P1-02 harness 使用。
- serde：协议消息用 `serde_json::Value` 先解析再做手写校验，与 TS validateModuleMessage 判定对齐；typed struct 放 T-P1-07。

## 切片
| 切片 | 内容 | 验收 |
|---|---|---|
| S0 | crate 骨架 + hello/capabilities 握手（迁移 hello crate 逻辑）；Rust 侧 `validate_module_message` | 握手请求/响应按 schema 往返对拍（Rust 输出经 ajv strict 校验 PASS；TS validateModuleMessage accept） |
| S1 | execute pure_text：stub/mock model（固定回放，不真调模型），出 event 流 + final response（final⇒outcome，protocol.ts:337） | execute 请求/事件/响应各自 schema 往返；条件规则负样本（禁 attemptId/stepId :285、禁 moduleInstanceId/connectionGeneration :340）Rust 也拒 |
| S2 | cancel / status（含 cancel 正在执行的 execute） | cancel/status 往返对拍；cancel 后 outcome 与 TS sidecar 一致 |
| S3 | R2-2 七项 serde 风险用例（T-P0a-01 DECISION.md:34-43） | 每项 1 个 Rust 测试（1.0、-0、指数、>2^53、1e400、重复键、ajv strict 对照），期望值 = TS JSON.parse+validate 结果；分歧须在报告中逐条写明处理 |
| S4 | TCP 监听模式（环回临时端口）+ 最小 TS 宿主连通冒烟 | 用宿主 TCP 连接跑通 hello→execute→status；不含 harness 自动化 |

## 通用验收（QA 定稿）
- 五个消息逐一 schema 往返对拍（T-P0a-01 schema + TS validator 双判定，错配 0）。
- 锁定类测试附 base（1da663a2）上 FAIL 的对照组。
- 证据在干净树：gitSha + gitDirty=false；`cargo test` / `cargo clippy -D warnings` 通过；放 `evidence/t-p1-01/`。
- 不改 `src/`、`package.json`/lockfile、CI。

## 不做
resume/ack；真实模型调用（P3）；T-P1-02 harness；性能测量（T-P1-03/05）；TCP 认证（T-P2-05/06）；Rust 类型生成（T-P1-07）；协议改动（如需改走 T-P0a-07 门禁）。

## 风险
1. serde 与 JSON.parse 解析分歧（R2-2）——S3 前置为测试，必要时自定义数字反序列化。
2. stub model 输出形状与 TS sidecar 不一致导致 T-P1-03 才暴露——S1 用 parity 场景 trace 作期望。
3. cancel 并发语义（R7 cancel，T-P0a-02）——S2 需对照 TS `agentLoopSidecarServer.ts`。
4. 工期 5–7 人天，S0–S2 为首个可评审切片。

## 待 Payne 决定
1. 是否接受"先 stdio、S4 再加 TCP"，还是要求首切片即 TCP？
2. 新建 crate 还是直接扩展 hello crate？（建议新建）
3. 重复键策略：对齐 JSON.parse 取后值，还是 Rust 拒、TS 侧补拒（后者属协议改动）？
4. 分 PR（S0–S2 一个、S3–S4 一个）还是单 PR？（建议两个）

## 2026-10-12 19:45 补充（分析师/QA 意见）
- 重复键若选「照 JSON.parse」：Rust 必须先解析为 `serde_json::Value`（后者覆盖）再转结构体，或自定义 Deserialize；禁止直接 serde derive（默认 duplicate field 拒）。用例用多字段消息（execute payload）证明取后一个值。
- 评审目录统一为本目录；QA 验收口径见 QA-ACCEPTANCE.md（S0–S4 映射）。

## 2026-10-12 Payne：F-4 / F-5（Round-2 前）

- **F-4：本轮 PR-A（#8）必修。** 运行期 deadline 计时 + ISO `±HH:MM` 解析，对齐 TS `agentLoopSidecarServer.ts:223-253` / `:697-702`。
  - stub sleep（`sleep_cancellable`）持续比较 `operationDeadline` / `attemptDeadline`；未到期定期检查，到期自行置 `deadline_exceeded` 并走与 cancel 同类中断，产出 `result_unknown` / `DEADLINE_EXCEEDED`。不得只靠 host cancel。
  - 验收：`operationDeadline = now+100ms` + `delayMs = 500` → Rust 必须 `result_unknown`/`DEADLINE_EXCEEDED`，不能 `completed`。
  - `parse_iso_ms` 认 `Z`、`+00:00`/`+08:00` 等 `±HH:MM`，以及 Date.parse 能认的无后缀时间。已过期带偏移时间必须当已过期 deadline，不能当“没有 deadline”。
- **F-5：显式延至 PR-B**，列为 **B4 前置必过项**（stub final payload 补 `sessionId`/`turnId`；cancelled 给出 `type:"aborted"` shape）。**本轮代码不改 F-5。**
