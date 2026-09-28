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

同源校验：SD packages/staffdeck-business-ui 与 PD vendor @staffdeck/business-ui 0.1.13 **41个canonical源逐字一致**，manifest无差异；本批无canonical、lock、vendor实现改写。

## 当前必要差异

1. 正常 PD conversation 的 `knowledge_query` 当前仍由 `ProjectSessionRuntimeBundle` → `createKnowledgeModulePort` → `HttpModuleClient` 使用 module-http-v2。SD 旧 `/v2/module/call` 只依赖DB session，按body actor ID取User，query未选择public_host_retrieval。**它不是已认证 public facade，不能直接作为有限版本正式读取入口。** 原public owner须交有界query/resolve_citation的正式认证/PEP/module envelope+manifest endpoint及credential合同；整合再接原root/HTTP，不以body身份代认证、不用单KB目录证明正常模型引用。
2. 实际enabled profile尚缺：native-five-staffdeck现有knowledge-runtime/sop-runtime是占位endpoint，definitions指approval示例；必须给正式domain承载点/同target/discovery/正常原生无审批定义/唯一真实PD模型绑定。已有enabled形状构建不证明它有效。fresh身份/owned key只按原正式API取得，不抄旧DB、token或推测ID。
3. root暂未广告tools.list，其工具执行/管理合同仍由原public provider owner承接；若最小SOP编辑需要目录，须原runtime.tools.list的准确descriptor固定投影。工具不可执行不伪装probe/create，保同真源；最小链路未使用操作按用户延期，非PASS。

员工/team扩展USER EXCLUDED；审批和高级管理USER DEFERRED。既有固定consumer/router/源码/失败保留。没有正常approver reader/admitted mapping时human mount禁提交，旧直接human resume不恢复；external_task仍沿原路。审批输入不再作为首轮前置。领域ETag/412、版本/PEP/正常合法分支规则不变。

## 聚焦检查与串行构建

原始证据集中目录 `/Users/a1/Documents/Codex/2026-09-27/g0-g6-integration-intake`：

- `minimum-upload-consumer-tests.log`：browser file client、Knowledge Host和同源SDK gateway，38/38（聚焦consumer与transport，不是业务PASS）。
- `minimum-sdk-tests.log`：具名SDK planner14/14。
- `minimum-domain-binding-tests.log`：SD正式root binding/domain/auto owner12/12；native原metadata不构成public来源。
- 准备工具6/6；active model/text Port5/5已通过。新增gateway测试最初fixture漏SOP管理scope得到403，补齐fixture后17/17；未减少生产身份guard。
- SDK、memory依赖和PD根tsc emit通过；原server/插件资源分发已完成。`minimum-pd-final-source-build.log`留已接最终frontend增量的enabled注册形状生成、UI typecheck、Vite build；保存对应generated入口后恢复默认源码。
- `minimum-sd-build.log`留SD tsc-b/Vite build。仅借已安装dependency路径，未运行install、未改锁，临时link已删除。Vite只有体积告警。

最终源码冻结与准入结论见唯一 [DEPENDENCY_CLOSURE.md](/Users/a1/Documents/Codex/2026-09-27/g0-g6-integration-intake/DEPENDENCY_CLOSURE.md)。本批是同一集中任务的公共收口，不启动独立业务轮，不将源码pair冒充完整可运行candidate，旧CLEANPAIR.json/原始失败保持。无push/merge/deploy/archive。
