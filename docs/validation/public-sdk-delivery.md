# 已授权公开 SDK / StaffDeck 有界 facade：本批交付

授权依据：`/Users/a1/Documents/Codex/2026-09-27/g0-g7-acceptance-preparation/PUBLIC_SDK_AUTHORIZATION.md`。本批只在公开/runtime owner 隔离树实现，供唯一整合者按固定提交接入同一 G0–G7 候选；不是生产已启用或业务验收 PASS。PD browser 继续只走现有模块网关，不 import SD backend 或持账户 key。SD `public_api/staffdeck_facade.py` 只调用原正式 owner 函数，不改业务核心。PD `ui/server/staffdeck-public-capabilities.mjs` 为逐名 server SDK/planner，`.d.mts` 提供对应输入类型，未知操作拒绝；整合者独占 `modules.js` 中真实 owner transport、固定授权列表、公开网关/SSE 转发。

## 固定操作表

相对 SD `/api/v1/`；路径参数由 SDK URI 编码，body 中 tenant/agent/actor 由 principal/path 决定，不接受调用方覆盖。下面权限列是 SD scope 的第一道门，原函数的 admin/owner/branch/resource PEP 仍执行。`202 APIJob` 会**持久化 draft**；`202 preview job` 使用原 transient stream job，**不写 APISOPDraft**。APIJob SSE 以 `id` / `Last-Event-ID` 恢复；preview 原 SSE 在 `data.seq` 中有序号，续流用 `after_seq`，不能凭空转成同一 ID 命名空间。

| SDK operation | Method + route | 输入 → 原响应 | Scope / 原边界 |
|---|---|---|---|
| `list_tools` | GET `agents/{agent}/tools` | 无 → `data[]` 掩码 | `tools:read`，scoped目录 |
| `list_general_skills` | GET `agents/{agent}/general-skills` | 无 → `data[]` | `skills:read`，scoped目录 |
| `create_tool` | POST `agents/{agent}/tools` | 原 ToolCreate body → 掩码 tool | `tools:write`，原 owner/agent PEP |
| `update_tool` | PUT `agents/{agent}/tools/{tool}` | 原 ToolUpdate body → 掩码 tool | `tools:write`；拒绝 `********` 回写 |
| `test_tool` | POST `agents/{agent}/tools/{tool}:test` | 已存 tool ID+test body → 原结果 | `tools:test`；不代 unsaved probe |
| `import_general_skill` | POST `agents/{agent}/general-skills` | 原 import body → skill | `skills:write` |
| `publish_general_skill` | POST `agents/{agent}/general-skills/{slug}:publish` | slug → skill | `skills:write` |
| `archive_general_skill` | POST `agents/{agent}/general-skills/{slug}:archive` | slug → skill | `skills:write`；不代 Remove |
| `test_general_skill` | POST `agents/{agent}/general-skills/{slug}:test` | slug+body → 原结果 | `skills:test` |
| `generate_sop` | POST `agents/{agent}/sops:generate` | `title/raw_content/business_domain?/model_config_id?` → 202 APIJob | `sops:write`；成功结果是服务分配的持久 draft，不再 create |
| `rewrite_saved_sop` | POST `agents/{agent}/sops/{sop}:rewrite` | `instruction/target_paths?/model_config_id?/draft_id?` → 202 APIJob | `sops:write`；仅已存 draft/published，dirty/current_skill/conversation 直接拒绝 `PUBLIC_PREVIEW_REQUIRED` |
| `get_job` | GET `jobs/{job}` | job ID → APIJob | job kind 的 `sops:read` 等原 `_require_job_scope` |
| `get_job_result` | GET `jobs/{job}/result` | job ID → `{job,result,error}` | 同上；未终态原 409，不造结果 |
| `job_events` | GET `jobs/{job}/events` | job ID、`Last-Event-ID?` → 原 SSE id/event/data | 同上，AbortSignal 原传 |
| `cancel_job` | POST `jobs/{job}:cancel` | job ID → APIJob `cancel_requested`/原终态 | SOP job 仅账户 `sops:cancel`；不加 `jobs:cancel`，仍 `_owned_job` |
| `preview_generate_sop` | POST `agents/{agent}/sops:preview-generate` | 原 SkillDistillRequest 去 tenant/agent 后的 title/raw/context fields → 202 `{job_id}` | `sops:write` + 原 manager/模型上下文；transient，不创建 draft |
| `preview_rewrite_sop` | POST `agents/{agent}/sops/{sop}:preview-rewrite` | 原 current_skill/instruction/model_config_id/target_path/target_paths/target_label/conversation/available_tools/available_sops → 202 `{job_id}` | `sops:write` + 原 manager；path skill ID 必须等于 `current_skill.skill_id`，dirty 原样送模型，不偷 save |
| `get_preview_job` | GET `agents/{agent}/sop-preview-jobs/{job}` | preview ID → 原 job status/last_seq | `sops:read` + 原 tenant/user job owner；与 APIJob ID 分开 |
| `preview_job_events` | GET `agents/{agent}/sop-preview-jobs/{job}/events` | preview ID、`after_seq?` → 原 token/status SSE `data.seq` | `sops:read` + 原 job owner；不伪 `id`，decoder 另暴露真实 `sequence` |
| `cancel_preview_job` | POST `agents/{agent}/sop-preview-jobs/{job}:cancel` | preview ID → `cancel_requested` | 仅账户 `sops:cancel` + 原 tenant/user job owner |
| `move_to_draft_sop` | POST `agents/{agent}/sops/{sop}:move-to-draft` | SOP ID → SkillRead | `sops:write`，原 overall+admin、原对象改 draft；非 create{} |
| `remove_sop` | DELETE `agents/{agent}/sops/{sop}` | SOP ID → hidden/deleted | `sops:write`，原员工 branch+binding deleted、overall/admin语义；非 archive |
| `sync_sop_from_overall` | POST `agents/{agent}/sops/{sop}:sync-from-overall` | SOP ID → synced/head_version | `sops:write`，原员工管理+published trunk 限制 |
| `promote_sop_to_overall` | POST `agents/{agent}/sops/{sop}:promote-to-overall` | SOP ID → promoted/version | `sops:publish`，原 admin/branch/validate 限制 |
| `delete_sop_version` | DELETE `agents/{agent}/sops/{sop}/versions/{version}` | 精确 version → deleted | `sops:publish`，原 overall/admin+active version 409；非 rollback |
| `probe_unsaved_tool` | POST `agents/{agent}/tools:probe` | 原 ToolProbeRequest 去 tenant → ToolProbeResponse | `tools:test` + agent manager，未写工具；非已存 :test |
| `remove_tool` | DELETE `agents/{agent}/tools/{tool}` | tool ID → hidden/deleted | `tools:write`，原 branch/overall 管理；非 archive |
| `extract_sop_text` | POST `agents/{agent}/sops:extract-file` | `{filename,content_base64}` → `{filename,text}` | `sops:write` + manager，复用原 5MiB/类型/400/413，不建 KB |
| `list_model_catalog` | GET `agents/{agent}/model-catalog` | 无 → `data[]` id/name/model/provider/enabled/is_default | `sops:read` + agent view，只给元数据，无 key/base URL；实际有效模型仍须配置+modelwire |
| `list_handoff_users` | GET `agents/{agent}/handoff-users` | 无 → `data[]` 本地 web 用户最小 metadata | `agents:read` + agent view；外部 control identity source 无公开目录 reader 时明确 503，不回退 shadow rows |

`PUBLIC_OPERATION_CONTRACTS` / `PUBLIC_APPROVED_OPERATIONS` 是这张表的机器可读固定集合；默认客户端授权仍 `[]`。整合者以已验证 owner 给 server gateway `authorizedOperations` 赋**此集合的明确需要子集**，并为每个 operation 写固定 dispatch 与响应封套；不可把浏览器 operation、path、URL 作为任意代理透传。浏览器 adapter owner 仅消费经模块网关允许的方法与状态，不 import server-only helper。

## Knowledge PEP 与范围收紧

SD 新增 `public_api/knowledge_pep.py`，在既有 `resources.py` 的 11 个公开 Knowledge 路由显式调用原 `require_agent_scope_viewer` 或 `ensure_agent_scope_manager`，加 `ensure_public_agent`、路径 KB 的可见分支/版本核验；文档更新另核 document ID 确属路径 KB。原 enterprise route 的 `Depends` 在直接调用 Python 函数时不会自行执行，故显式补回。create/update/search/rollback 的 body tenant/agent/KB 覆盖被拒，upload/ingest 先过范围门，原异步 worker 仍用原 actor/credential。archive 复用对应 update 路由，因此同一检查适用。聚焦 HTTP 用例覆盖非 owner 403 与 owner 200；这只证明本地 PEP 回归，外部 source、团队/非目标作用域及实际 Knowledge 全操作仍需独立矩阵证据。

## 本批校验与剩余具体边界

- SD 新 facade OpenAPI 固定方法、仅账户 scope、dirty preview 输入不丢、无 create/save、preview job path 绑定、原 Remove 函数传 actor/tenant/agent、知识非 owner 403/owner 200：10 个聚焦测试通过。既有 public resource/account key 3 个测试通过；完整 G4/G5 业务未运行。
- PD 旧真实目录/job/SSE/error 测试及新固定路由/dirty preview/preview `data.seq`：10/10 聚焦 node:test 通过；`.d.mts` 单文件 typecheck 通过。不得由这些测试声称 runtime pin、真实模型或浏览器已接入。
- 外部 control identity source 的 handoff 用户目录仍无可供账户 key 调用的正式 reader，facade 给 `USER_DIRECTORY_UNAVAILABLE` 503。需要 deployment owner 提供保持原 actor/可见范围的公开目录 SDK 方法；不能换控制 token 或用本地 shadow 用户伪目录。
- Knowledge 外部来源/团队/非目标可见范围尚未在真实运行验证，必要项仍 NOT RUN。`preview` 采用原 transient stream job 存储，facade 另将原 job ID 绑定创建时的 agent path；服务重启后其 in-memory job 不支持恢复，保持原语义，不将其映射到持久 APIJob。实际模型配置与 `model_for_agent` 仍需下一完整 candidate 证明。
- 整合者接入 PD modules.js 和 adapter 固定公开响应/stream，串行 build/typecheck 后统一一个 cleanpair；独立验收 G0–G7 不因本批代码自动升 PASS。无 push/merge/deploy、AgentLoop/core/PEP 策略修改。
