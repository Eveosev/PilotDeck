# G5 真实复现结果报告（2026-09-23）

## 结论

本轮没有完成 G5 完整验收交付。原生语义修复和失败取证改进已入版本；新的真实模型复现在 discovery 阶段超时，未进入 lifecycle，因此端到端闭环状态为 **BLOCKED**，不能宣称 G5 acceptance PASS。

## 真实复现证据

- 新复现 trace：`/tmp/g5-repro-20260923-1790138839/trace.json`
- 新复现结果：首个 ordinary turn 在 StaffDeck SOP discovery 请求超时，返回 `agent_invalid_state`；`nodeTransitions`、`wait`、`reload`、`resume`、`duplicate` 和 lifecycle `service` 均为空。
- 该次 discovery 服务日志：`/tmp/g5-repro-20260923-1790138839/discovery.log`。服务在超时后进入 background-task shutdown waiting，未产生 lifecycle 流量。

## 已有 proposal / 422 定位

来自版本化旧 trace `products/pilotdeck-staffdeck-sop/evidence/g5-agentloop-natural-discovery-1.2.1.json`（该文件的顶层成功样本仍对应 `f52ae6fc`，不是本次新复现）：

1. `n1_collect` 上，模型提交 `status=completed`，但没有提交必填 `slotUpdates`。原生返回 HTTP `422` / `REQUIRED_SLOT_MISSING`，缺少 `project_goal`、`current_stage`、`known_blockers`。
2. `confirm_scope` 上，模型提交 `status=completed` 且 `nextStepId=build_plan`。当前节点不允许该转移，原生返回 HTTP `422` / `INVALID_TRANSITION`。
3. 正常旧成功样本的节点路径是 `n1_collect -> build_plan -> confirm_scope -> finalize_plan`，并记录了 handoff wait reload、human approval duplicate replay 和 terminal completion；这只能证明旧样本，不证明本次复现已闭环。

## 原生语义对照

- StaffDeck 原生 validator 保留两类约束：非法节点转移拒绝；`completed` 结果缺少必填 slots/capabilities 拒绝。
- 原生允许 `awaiting_user` 携带 `next_step_id`，也允许出现在声明 handoff 的节点或未声明 `expected_user_info` 的节点。
- 因此已撤回 `WAIT_STATUS_CANNOT_ADVANCE`、`HANDOFF_REQUIRED`、`WAIT_INPUT_NOT_REQUIRED` 等非原生限制；PD `303d06a8` 与 SD `e7f540fe` 对齐该语义。上述两次 422 是 proposal/图转移错误，不是这些已撤回限制造成的。

## 状态与 refs

| 范围 | 状态 | 说明 |
| --- | --- | --- |
| StaffDeck 原生语义 | **PASS** | `e7f540feeaa92dba338e30f0ff6a343f0ac8fae` |
| PilotDeck 等价等待语义 | **PASS** | `303d06a8286e912749199e7d5f8d73206066637b` |
| PilotDeck 失败取证 | **PASS** | `e1c07521de07dbafe8fe6f2ce59677f9b49263cd` |
| 真实 discovery 新复现 | **BLOCKED** | discovery timeout，未进入 lifecycle |
| G5 完整验收 | **BLOCKED / NOT PASS** | handoff、reload、resume、duplicate、completion 未在本次新 trace 中重新闭环 |

当前最终分支 refs：

- PD：`codex/g5-sop-agent-pd`，包含 `e1c07521`（其父链含 `303d06a8`）。
- SD：`codex/g5-sop-agent-sd`，包含 `e7f540fe`。

本报告只记录复现和判定；未修改独立验收活动树，未借用 `16400–16429` 服务，也未执行自动集成。

