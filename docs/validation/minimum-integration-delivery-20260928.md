# 2026-09-28 最小链路公共整合交付

现行范围：[用户已接受的最小链路](/Users/a1/Documents/Codex/2026-09-27/g0-g7-acceptance-preparation/DELIVERY_SCOPE_OPTION_20260928.md)。完整领域分析引用原 owner DELIVERY；本文件只记录公共接线/构建和跨线差异。业务均 NOT RUN，不称有限版本跑通或原 G0–G7 全通过。

## 已接固定实现

| 固定源 | 本树应用与行为 |
|---|---|
| public PD8d51cdc8 | 19ae167b；91aed706 在 createLocalGateway registry 当前 generation 绑定同 ModelRuntime 的 prepare/stream、真实 catalog available/default selection及 UTF-8 txt/md file_parse。没有第二模型、目录、任务或新造session权限context |
| adapter PD71e63fc8 / ccc4be6a | 6e9392d4 / 36463da3；保原 FormData/AbortSignal/status/raw error和Knowledge ingest namespace，canonical无KB上传走具名auto，而非猜KB/拆create+upload |
| public SD56a457 / 8ad463 / 97a990 / 0d20209 | SD efb6 / a748 / a4af / ee91；public ingest调用PD parser，public检索和ingest不取第二SD默认模型；auto-upload一次原owner创建private KB/version/native ingest。worker再核active credential与原target PEP，内部来源不进入KB/doc/source/native metadata |
| public SDK8aec0975 | 43c92d26；新具名upload_knowledge_document_auto planner，原200 KnowledgeIngestJobRead合同 |
| 公共网关4496af69 | /api/modules/staffdeck-sdk/file allowlist具名auto，保原bytes/title/capability_scope/200/body/headers/signal，无任意代理；原JSON入口拒文件伪装 |
| SD root c762495c | 显式部署bind_pilotdeck_domain_client，正常Gatewaytokenpath/origin/response-derived PDuser/exact tenant/actor/target；缺配置启用失败，wrongtuple在transport前拒绝 |
| 绑定准备91aed706 / 293a3250 | 允许同时省略延期approver响应；仍核fresh actor/PDuser/target/owned credential；部分env/configPatch不冒有效profile，正常部署token不mint、不复制 |
| public SDd7f33288 / PD61cac7fc | SD1383e39a / PD17691edb；正常Knowledge query使用账户Bearer、原PEP、public_host_retrieval与正式module envelope，PD凭credentialEnv只从server进程取账户key；旧无认证module路径不作有限版绑定 |
| 整合PD3aadf223 / b3e8d441 / 88d84c29 | 私有profile组合把准备好的copy、management、discovery与public limited renderer合一；target/key/bundle不一致及相对bundle路径拒绝。compiled-tree profile测试路径修正，不改生产协议 |
| adapter f858ddb2 | 固定[Knowledge查询consumer处置](minimum-knowledge-query-consumer-delivery-20260928.md)：正常对话的认证module读已由后续public合同接通；正式Knowledge页单KB检索仍把自动选择的PD `model_config_id`传给当前拒绝此字段的SD public search。结构化响应/引用投影无需改，输入模型绑定尚未闭合 |
| public PD35bbd45a | 本树已接[浏览器模型选择合同](browser-knowledge-model-selection-delivery-20260928.md)及公共route：SDK用同一已认证Gateway/selected Host Port的catalog校验唯一可用默认`provider/model`；非2xx Host响应保原status/body，成功检索的`host_model_selection`写回浏览器JSON。SD原词法检索、PEP和evidence/citations不变 |

同源校验：SD packages/staffdeck-business-ui 与 PD vendor @staffdeck/business-ui 0.1.13 **41个canonical源逐字一致**，manifest无差异；本批无canonical、lock、vendor实现改写。

## 当前必要差异

1. 认证Knowledge源码合同已接，实际PD账户key、原PEP、文档引用和正常模型回答尚未在新进程中观察。SD facade当前只广告`query`；旧`resolve_citation`与高级管理按最小范围不冒等价能力。原模型回答中的citation须由同次查询结果验证。
2. limited renderer和私有binding组合已接；实际enabled profile须等独立fresh正式身份、账户key、原生无审批已发布bundle、模型环境取得后写入并由Gateway启动选中。native-five原占位endpoint与approval示例不作为本轮profile。未观察启动/manifest/模型配置前不称effective。
3. root暂未广告tools.list，其工具执行/管理合同仍由原public provider owner承接；若最小SOP编辑需要目录，须原runtime.tools.list的准确descriptor固定投影。工具不可执行不伪装probe/create，保同真源；最小链路未使用操作按用户延期，非PASS。
4. K3正式Knowledge页查询仍为源码BLOCKED：public合同与公共route已接；adapter owner尚须把页面自动选择的PD `model_config_id`移为外层`selectedPdModelId`，从SD search body移除此字段，保持单KB与原scope。现有页面路径仍会被SDK准确拒绝。不可静默丢弃、当成SD模型ID或假称查询/引用已跑通；无单KB选择或多KB搜索亦不计本轮单文档映射PASS。

员工/team扩展USER EXCLUDED；审批和高级管理USER DEFERRED。既有固定consumer/router/源码/失败保留。没有正常approver reader/admitted mapping时human mount禁提交，旧直接human resume不恢复；external_task仍沿原路。审批输入不再作为首轮前置。领域ETag/412、版本/PEP/正常合法分支规则不变。

## 聚焦检查与串行构建

原始证据集中目录 `/Users/a1/Documents/Codex/2026-09-27/g0-g6-integration-intake`：

- `minimum-upload-consumer-tests.log`：browser file client、Knowledge Host和同源SDK gateway，38/38（聚焦consumer与transport，不是业务PASS）。
- `minimum-sdk-tests.log`：具名SDK planner14/14。
- `minimum-domain-binding-tests.log`：SD正式root binding/domain/auto owner12/12；native原metadata不构成public来源。
- 准备/私有组合8/8；active model/text Port5/5已通过。新增gateway测试最初fixture漏SOP管理scope得到403，补齐fixture后17/17；未减少生产身份guard。
- 新SD public read pytest3/3；PD Knowledge transport/profile4/4。第一次在`dist`运行profile测试因standalone `.mjs`未复制到`dist`报`ERR_MODULE_NOT_FOUND`；b3e8d441让测试按工作树资源路径读取，修后4/4。
- public模型选择SDK Node测试16/16；公共route Vitest18/18（含同一principal/catalog、原Host 422、错配前置拒绝及成功receipt）。这些为源码聚焦检查，非浏览器/模型业务PASS。
- 当前PD b3e8d441 根tsc emit、前端typecheck/Vite均通过；另用limited renderer的离线fixture生成enabled入口后再跑前端typecheck/Vite，随后恢复原generated文件。fixture构建只证注册与打包，不证实际endpoint/model/key。
- 当前SD1383e39a frontend tsc-b/Vite通过；仅借既有dependency路径，未运行install、未改锁，临时link已删除。Vite体积告警；PD CSS minify亦有既有warning，未导致构建失败。

最终clean refs记在[MINIMUM_SOURCE_FREEZE.json](/Users/a1/Documents/Codex/2026-09-27/g0-g6-integration-intake/MINIMUM_SOURCE_FREEZE.json)，SD认证入口整合ref为1383e39a。独立fresh流程先正常启动隔离Gateway与SD、取响应tuple及发布合法无审批bundle，再运行`prepare-staffdeck-bindings.mjs`和`compose-limited-staffdeck-profile.mjs`写同一个private enabled profile并令Gateway实际选中；准备工具不代业务结果。最终源码与准入结论见[DEPENDENCY_CLOSURE.md](/Users/a1/Documents/Codex/2026-09-27/g0-g6-integration-intake/DEPENDENCY_CLOSURE.md)。旧CLEANPAIR.json/原始失败保持。无push/merge/deploy/archive。
