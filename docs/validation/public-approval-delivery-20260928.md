# 固定审批主体：本线集中输入（尚未闭合）

基线 PD fb3c3b77bf452c973939852d95146bdcd9750e4a / SD 2da6f276d4834aa3bd8b51aa6288453ca9d91624；不替换完整候选，不启动业务轮。本文件吸收 PRE_CANDIDATE_INPUTS_20260928.md。

## 本批实装

`ui/server/staffdeck-approval-authority.mjs` 的 createFixedApprovalAuthority 使用审批人自己的正常 Bearer 调用 SD `/api/auth/me`。私密服务配置绑定原 tenant/approver ID，核 native web、admin/member、未 disabled；响应 ID 不来自 username、目录、请求 body、账户 API key。保原认证 HTTP failure status 与 AbortSignal。

输出是 subject 与原 session/wait/revision/request/message 的 command，**不是已经提交的 resume、审批 receipt 或授权闭环**。尚须原入口核 session access 与运行中 pinned SOP 节点的 assignee。不会自动 continue，不写 SD HandoffRequest 或 PD wait，不产生影子审批 state。

本轮部署选择明确为 SD native identity（DEMO_SEED_ENABLED=true，HARNESS_CONTROL_AUTH_PROVIDER 空）；该选择不能作为外部故障 fallback。生产 IDs/secret 只能来自完整候选正常 bootstrap 响应，本文件没有占位 profile 或有效模型声明。

## 固定源码的最小接线缺口

1. PD `StaffDeckSopStatusSnapshot` 只返回 state/wait，wait 无 assignee；`SopStateStore` 持有同 session 的 pinned bundle，但原公开 status 不提供该 bundle 的节点授权投影。须在现有 store/control 边界读取 pinned bundle 中 active skill/step 对应的 assignee，并绑定原 wait ID/revision。不能用最新 bundle 或配置默认 ID覆盖运行中旧版本的审批人。
2. 原 resume 在 session lock 内核 wait/source/revision 与 request 幂等，没有 subject。正常入口须将服务认证得到的 subject 与 pinned assignee核验接到同一权威 wait；旧 resume RPC/HTTP 入口不能继续绕过该守卫。该处不需要改变原审批规则，但需要原公共协议/控制文件 owner 应用窄 hunk。
3. SD `chat.py:list_human_handoffs` 过滤 PD-origin sessions；`reply_human_handoff` 写原 SD handoff/回复服务。不能移除过滤后把 PD wait 当 SD HandoffRequest。SD 页面需单独呈现 PD权威 wait 的公开投影并调用共用已认证审批桥；原 SD-native handoff 列表/reply保持原 PEP。纯 UI hunk由 UI owner处理，HTTP桥由整合处理。
4. 两 Host 共用入口认证：PD 同源入口首先核 PDuser/session，审批 Bearer再经本守卫核 SD固定审批主体；SD入口使用当前 SD登录审批人 Bearer，同样读取 PD权威 wait 并核其跨Host session映射。两者只向 PD原resume提交同wait/revision/request。不是两次回复、不是反向双写。
5. profile/provider/领域DI尚未闭合。固定 root 的 getPublicHostCapabilities仅装 model.catalog与skills.list，tools为空、context抛错；之前91cffab2只接受caller方法，不是现有ModelInvoker/Tool/Task实际适配，不能称已完成。file/task/模型执行与领域Python DI仍必须补实际绑定，禁止将此批审批守卫当替代产物。

## ownership

本批只新增两份本线server文件与本DELIVERY。在固定基线新隔离树修改；保主仓旧WIP，不再改旧root。共享窄hunk路径已集中请求裁定：PD `src/sop/staffdeck/{types.ts,SopStateStore.ts,StaffDeckSopControlPlane.ts}` 与原 resume HTTP/RPC入口；SD `backend/app/api/chat.py` 的PD-origin收件箱呈现分支。未修改任何这些文件；整合保持modules/gateway/root唯一owner。

## 聚焦自验

Node22.23.1（进程级移除NODE_OPTIONS）4/4测试通过：正常主体/同wait绑定、错误actor/tenant/disabled/source拒绝、旧revision/external_task零认证请求拒绝、401保持。测试使用可控正式HTTP响应，不是实际身份登录证据。无真实模型/审批/resume业务运行；profile/effective/pin/wait两Host入口全链路均未标PASS。
