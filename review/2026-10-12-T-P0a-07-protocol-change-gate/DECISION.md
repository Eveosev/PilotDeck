# T-P0a-07 决策包：协议变更同步门禁（文档先行，草稿，2026-10-12 19:40）

- 基线：`rust_standalone_alpha1@1da663a2`。负责：Arch+QA；粗估 0.5–1 人天（TASK_PLAN.md:43、:290）。
- 原则：同步，不冻结（TASK_PLAN.md:43）。协议可以改，但必须同 PR 同步。

## 规则（任一 PR 触及 `src/agent/modules/protocol.ts` 即适用）
1. schema：重跑 `scripts/generate-module-protocol-schema.mjs`，提交更新后的 `evidence/schema/module-protocol.schema.json`（及 `docs/pilotdeck-module-protocol-v2.schema.json`）；二次生成 diff 为空。
2. replay：`scripts/replay-module-protocol-schema.mjs` 通过，可表达错配=0，不可表达规则单列。
3. 负样本/边角：A3 样本更新，放宽 schema 对照组仍 FAIL。
4. parity：`tools/agent-loop-parity` 相关场景复跑并附结果。
5. Rust adapter：T-P1-01 起，`crates/` 中对应校验/处理同 PR 更新，Rust 测试通过。
6. 版本号：改动契约须评估 protocolVersion / capabilitiesVersion（protocol.ts :212、:118/:216）是否升级并写明。
7. 证据：干净树、gitSha、gitDirty=false。

## 交付物
- `evidence/protocol-sync-gate.md`：上述规则 + 检查清单 + 命令。
- 可选：CONTRIBUTING 片段（指向上文）。
- CI check / git hook：**本任务不做**，另立任务（改业务仓 CI 需 Payne 开绿灯，可并入 T-P0a-04）。

## 已知局限（必须在文档写明）
- F-5：schema 结构是在 `scripts/lib/module-protocol-schema.mjs` 里手写映射的，只有版本常量、MODULE_CALL_TARGETS、isOutcome 枚举从源码抽取，加源码锚点断言（REVIEW_RESULT.md:58、:85；R2 :52）。所以 validator 新增规则时，生成器不一定会报错，漂移防护靠 replay + 人工审查。
- R2-1：仓库内 reject 方向只有手挑样本（20 负样本 + 9 个应拒边角）；建议在 replay 加确定性字段变异（逐键删除/替换为 10 种值），报告变异总数、拒数、错配数（REVIEW_RESULT_R2.md:102-105）。本任务把它写为门禁的**建议项**，实现放 T-P0a-04 或单独切片。
- R2-3：schema 里"Generated from"措辞残留，文档统一称"hand-mapped + source anchors + replay"。

## 验收
- A1 `evidence/protocol-sync-gate.md` 覆盖规则 1–7，每条有可执行命令与通过判据。
- A2 F-5、R2-1 局限写明，且给出责任任务。
- A3 用 PR#5 回溯演练一次清单（逐项打勾/说明），证明可执行。
- A4 只改文档，不动 `src/`、CI、依赖。

## 待 Payne 决定
1. R2-1 变异阶段放本任务实现，还是 T-P0a-04？（建议 T-P0a-04）
2. 是否需要 CONTRIBUTING 片段？
3. CI 自动检查（路径触发）何时开绿灯？

## 2026-10-12 20:23 Payne 拍板（已锁定）
5. R2-1 字段变异移到 T-P0a-04。
6. 加 CONTRIBUTING 片段。
7. 协议文件改动自动 CI 检查：门禁文档过 Reviewer 后再开绿灯；本任务只出文档 + 两次空跑证据。
