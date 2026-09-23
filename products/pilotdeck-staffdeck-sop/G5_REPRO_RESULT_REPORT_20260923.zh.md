# G5 真实复现结果报告（2026-09-23）

## 结论

本轮已完成 G5 完整验收交付。使用全新 StaffDeck SQLite、同一 `APP_SECRET` 启动 discovery 与 lifecycle 服务，并通过真实 public API 创建、校验和发布 SOP；真实模型链路完成 discovery、lifecycle、handoff、reload、human resume、duplicate replay 和 terminal completion，G5 acceptance 为 **PASS**。

## 真实复现证据

- 新复现 trace：`/tmp/g5-repro-20260923-1790138839/trace.json`
- 配置：`http://127.0.0.1:16224/api/v1`，`discoveryTimeoutMs=120000`；首个 ordinary turn 在 discovery 请求超时，返回 `agent_invalid_state`。
- 该 trace 的 `service=[]` 是旧取证缺口，不能证明请求未发出。对应日志只显示主 API `16224` 与 Harness capability MCP 随机端口 `58955` 启动；超时后主进程进入 background-task shutdown waiting，未留下完成的 route access 记录。
- 已补充 runner 取证：连接拒绝样本 `/tmp/g5-fetch-refused-trace-20260923.json` 记录约 `3ms` 的 `outcome=error`；不响应样本 `/tmp/g5-fetch-timeout-trace-20260923.json` 记录 `50ms` 配置、约 `53ms` 的 `outcome=aborted`。两者都保留脱敏 URL/端口、timeout、耗时、请求体和错误。
- 完整成功 trace：`/tmp/g5-full-repro-rerun-20260923-140951/g5-full-trace-2.json`。真实 discovery `POST /api/v1/agents/.../sops:route` 返回 HTTP 200 并选择 `project_delivery_plan`；lifecycle `healthz`、`prepare`、`submit` 均被实际调用。
- 成功链路最终节点为 `build_plan -> confirm_scope -> finalize_plan`；handoff wait id 为 `6bbfa7e3-8cae-4ffa-b4b3-ddee5a9164f5`，重载后 wait id 保持不变，人工 resume accepted，重复 resume 被识别为 duplicate，最终状态为 `completed`。

## 可行动诊断

- 原先复用隔离 SQLite 的 replay 使用了不同的 `APP_SECRET`。StaffDeck 日志明确显示请求已进入 `POST /api/v1/agents/.../sops:route`，随后 `TurnPlanner().plan` 在解密 `model_configs.api_key_encrypted` 时抛出 `Secret cannot be decrypted with current APP_SECRET`，返回 HTTP 500。该失败样本位于 `/Users/a1/Documents/Codex/2026-09-23/g5-runtime-independent-capture/staffdeck-capture.log`；它解释 replay 阻塞，不解释最初的真实 timeout 或旧 trace 的两次 422。
- 使用全新 SQLite、同一固定 `APP_SECRET` 写入并启动 StaffDeck，route-only 最小复现通过：`/tmp/g5-minimal-route.rBPHQI/staffdeck.sqlite3` 与 `/tmp/g5-minimal-route.rBPHQI/staffdeck.log`。`POST /sops:route` 返回 HTTP 200，选中 `project_delivery_plan`；SQLite `api_audit_logs` 记录该 route `duration_ms=16277.7598`。这证明主 API route、TurnPlanner/provider 调用和模型配置解密在一致密钥下均能开始并结束。
- 复用隔离库时的 `APP_SECRET` 不一致仍保留为失败诊断；本次成功复现使用全新 SQLite，并在写入模型配置和启动 StaffDeck 时保持同一 secret，避免复用旧加密凭据。

## 已有 proposal / 422 定位

来自版本化旧 trace `products/pilotdeck-staffdeck-sop/evidence/g5-agentloop-natural-discovery-1.2.1.json`（该文件的顶层成功样本仍对应 `f52ae6fc`，不是本次新复现）：

1. `n1_collect` 上，模型提交 `status=completed`，但没有提交必填 `slotUpdates`。原生返回 HTTP `422` / `REQUIRED_SLOT_MISSING`，缺少 `project_goal`、`current_stage`、`known_blockers`。
2. `confirm_scope` 上，模型提交 `status=completed` 且 `nextStepId=build_plan`。当前节点不允许该转移，原生返回 HTTP `422` / `INVALID_TRANSITION`。
3. 本次成功 trace 的节点路径为 `build_plan -> confirm_scope -> finalize_plan`，并记录了 handoff wait reload、human approval duplicate replay 和 terminal completion。真实模型还产生过被原生 validator 拒绝的中间 proposal（HTTP 422），随后在同一会话内修正并完成；这些 422 保留在 service trace 中，没有被 runner 隐藏或改写。

## 原生语义对照

- StaffDeck 原生 validator 保留两类约束：非法节点转移拒绝；`completed` 结果缺少必填 slots/capabilities 拒绝。
- 原生允许 `awaiting_user` 携带 `next_step_id`，也允许出现在声明 handoff 的节点或未声明 `expected_user_info` 的节点。
- 因此已撤回 `WAIT_STATUS_CANNOT_ADVANCE`、`HANDOFF_REQUIRED`、`WAIT_INPUT_NOT_REQUIRED` 等非原生限制；PD `303d06a8` 与 SD `e7f540fe` 对齐该语义。上述两次 422 是 proposal/图转移错误，不是这些已撤回限制造成的。

## 状态与 refs

| 范围 | 状态 | 说明 |
| --- | --- | --- |
| StaffDeck 原生语义 | **PASS** | `e7f540feeaa92dba338e30f0ff6a343f0ac8fae4` |
| PilotDeck 等价等待语义 | **PASS** | `303d06a8286e912749199e7d5f8d73206066637b` |
| PilotDeck 失败取证 | **PASS** | `e1c07521de07dbafe8fe6f2ce59677f9b49263cd` |
| 真实 discovery 新复现 | **PASS** | HTTP 200，选择 `project_delivery_plan`，进入 lifecycle |
| G5 完整验收 | **PASS** | handoff、reload、resume、duplicate、completion 均在新 trace 中闭环 |

当前最终分支 refs：

- PD：`codex/g5-sop-agent-pd`，包含本次 runner 提示词修正（其父链含 `e1c07521`、`303d06a8`）。
- SD：`codex/g5-sop-agent-sd`，包含 `e7f540feeaa92dba338e30f0ff6a343f0ac8fae4`。

本报告只记录复现和判定；未修改独立验收活动树，未借用 `16400–16429` 服务，也未执行自动集成。
