# PilotDeck SDK 与 Lantay 交付闭环计划

更新时间：2026-10-07。基线：`standalone_alpha1`，核心 HEAD `0a2ba0cc9`，包含未提交 SDK 增量。

## 提交关联

wrapper 独立仓库提交：`3fd8cd5`（`feat(lantay): complete SDK delivery adapter and SOP recovery`），分支 `codex/lantay-sdk-delivery`，基于已验收的 `bf44d8e`。
远端 `master` 在验收期间已更新至 `bc213ff`，含大量 `base/` 更新；本轮独立分支没有将这些未验收更新混入。PilotDeck 主仓库 SDK、镜像配置和本验收证据提交到 `standalone_alpha1`。

## Goal 与范围

完成 `HTTP -> staging -> Python adapter -> Node SDK -> Gateway RunRegistry -> 结果恢复 -> 交付物校验`，先证明契约，再证明可打包运行。

- PilotDeck 改动集中在 `packages/sdk` 类型、client 和定向测试。
- 不修改 AgentLoop，不修改 Gateway wire protocol，不向核心写入 Lantay 业务规则。
- wrapper 保留鉴权、材料、OCR、交付物、retention、业务 SOP 和部署所有权。
- 保留工作区已有改动；sandbox/execution-world 不属于本交付。
- 执行完成、流程审批、业务交付完成分开记录。
- 未知结果只查询原 session/run，禁止自动换 run 重试。

## 已实现

### SDK

- `runs.start/get/observe/result/reattach/abort`，稳定 session/run ID。
- durable events 投影 `finalAnswer/generatedFiles/trajectory/runSummary/sessionTranscript`。
- replay 序号去重；显式 gap、缺失序号或历史提前终止返回 `result_unknown`。
- Gateway skill catalog 校验，单技能 force-load、多技能 whitelist。
- 材料引用校验 completed upload 及选中的 attachment；非法引用在提交前失败。
- Gateway RunRegistry 保持运行权威，SDK 不保存业务交付状态。

### Lantay adapter 与 API

- sync JSON 和 SSE 共用 `sdk_adapter.py` 与 Node SDK bridge。
- staging 先保存受控文件，bridge 上传字节，submit 只携带 attachment 引用。
- OCR/转换后的材料引用映射到实际 staged derivative。
- 空技能和空模型由 Python null 转成 SDK 的 omitted option。
- bridge 关闭运行观察连接；提交前校验错误不会使 subprocess 永久挂住。
- stream 并发 drain stderr，缺少终态返回 `result_unknown`，取消时清理 bridge 进程。
- query 原 run ID，恢复时只合并同一 run 的编码交付结果，禁止混入旧 turn 结果。
- SDK backend 的编码结果可重复查询；native backend 保留历史消费契约。
- Gateway 查询在线程中执行，不阻塞 HTTP event loop。
- 文本/二进制编码、格式校验、脚本/日志/OCR sidecar/中间产物过滤保留 wrapper 规则。
- 当前单个 staged 文件限制 9 MiB（12 MiB Base64）；超限 `413 upload_too_large`。现有协议没有分块文件上传。
- `unknown_skill/validation_error/session_busy/capability_unavailable` 结构化错误映射。

### SOP

- 文件持久化 `taskId -> projectKey/sessionId/runId/sopInstanceId`。
- handoff、approve/reject/timeout、execution 与 delivery 独立状态。
- resume 首先以文件锁原子认领幂等键，再经普通 `/v1/runs` 路径提交 SDK turn。
- 同一个 resume_key 重复调用只查询原 run，重启后也不重复提交。
- 提交附近进程退出时保留原 run 引用，可返回 `result_unknown`。
- completed/failed/aborted/unknown 回写 execution；完成续跑不会自动完成 delivery。
- project 不匹配、非法 run ID、未审批任务被拒绝。

### 部署

- `Dockerfile.sdk` 组合当前 standalone 核心；旧 `Dockerfile` 保留 native `base/`。
- 旧 `base/` 缺少 `run_get/run_events/upload_*`，不能当作 SDK 部署验收。
- SDK 镜像默认 project 为 `/root/.pilotdeck`（宿主 General workspace）。`/app` 未注册时不可用。
- `EVAL_TOKEN/DEFAULT_MODEL/provider` 启动校验，挂载 YAML 也必须校验。
- Gateway readiness 失败时退出；TERM/INT/子进程退出触发清理。
- health 按 backend 使用正确协议，返回 Gateway、存储、模型配置与 OCR mode。
- 镜像技能在空 state volume 上初始化，保留已有技能文件。
- 启动、恢复、数据卷与回退说明在 wrapper `API.md` 和 `README.md`。

## 验收矩阵

| 层级 | 验收项 | 状态与证据 |
| --- | --- | --- |
| SDK | transport、durable projection、skill、材料、replay/gap、abort | 130 项通过；`packages/sdk/test/transport.test.ts` |
| SDK | typecheck、build、vendor 刷新 | 通过；当前 vendor 已同步最新 durable gap 逻辑 |
| Node bridge | submit/upload refs、observe afterSeq、reattach/result/abort | 3 项通过；`sdk_bridge.test.mjs` |
| HTTP 全链路 | 实际 HTTP/Python/Node SDK，对接 mock wire Gateway | 3 项通过；`api/test_sdk_http_e2e.py` |
| HTTP 全链路 | multipart 字节、SSE/sync、同 session 409、不同 session 并发、断开后查询 | 包含在上述 3 项通过证据中 |
| SOP | 首次续跑、幂等、持久化重开、三种终态与交付门禁 | 5 项通过；`api/test_sop_execution.py` |
| SOP | 状态机审批/拒绝/超时 | `api/test_sop_state.py` 通过 |
| Wrapper | API + adapter 最终集合 | 159 项通过，2 项第三方 websockets deprecation warning |
| 容器 | API + adapter、Node bridge | 无缓存最终镜像内 159 + 3 项通过，1 项 Starlette deprecation warning |
| 运维 | health 模型/OCR 状态 | 新测试先失败再修复；`api/test_sdk_operations.py` |
| 运维 | artifact retention 不删除 SOP 审批状态 | 新测试先失败再修复；`api/test_retention.py` |
| Docker | 当前 standalone 核心与 SDK 组合镜像 | 核心缓存构建通过；最终 SDK 组合镜像 --no-cache 构建及 SDK import 通过 |
| Docker | 真实 Gateway + 确定性模型 + restart | 通过；multipart/sync/SSE/SOP 续跑及重启后幂等查询 |
| 外部依赖 | 真实 provider / Gateway / 工具交付 | 11 组通过；`lantay-sdk-real-model-20261007/README.md`，模型 `LLMCenter/qwen3.6-flash-distill` |
| 外部依赖 | 真实 OCR、音视频转换 | 按用户要求跳过，本轮不计入通过 |
| 生产 | 多实例锁/所有权、生产交付质量 | 未执行；不属于首版一致性承诺 |

## 剩余任务

- [x] 完成当前组合镜像的真实 Gateway/SOP/restart smoke 并保存证据。
- [x] 对最终源码执行 wrapper API + adapter 验收集合，159 项通过。
- [x] 无缓存构建当前 `Dockerfile.sdk`；最终镜像 `lantay-pilotdeck:sdk-clean-current`，镜像内测试和真实 Gateway smoke 均通过。
- [x] 使用桌面 `.env` 在真实 provider 环境验收 CSV 材料理解和 MD/CSV/DOCX/XLSX/PDF 交付，独立检查内容和格式。
- [x] 真实模型 SSE、断线后原 run 恢复、并发、SDK replay/abort、技能、SOP 续跑/幂等/重启/交付门禁。
- [ ] 真实 OCR 和音视频材料验收；用户要求本轮跳过。
- [ ] 在部署环境验证资源额度、模型错误、真实音视频/OCR 降级。
- [ ] 后续若要求多实例一致性，另行实现运行权威/外部锁服务，不用 SDK callback 模拟。

## 本轮发现和修复

1. 旧镜像能够 import SDK，但内置 Gateway 缺少协议能力；新增组合镜像。
2. Python 空配置传成 null，真正 API 到 bridge 的调用失败；修复 optional 字段转换。
3. 未知技能在提交前失败后，run observer 保持连接；调用终态 facade 释放连接。
4. 旧 health 使用协议 1.0，当前 Gateway 要求 1.2；修正探针。
5. `/app` 是镜像目录但没有 project 注册；默认改为已支持的 General workspace。
6. SOP resume 原来只改状态；现在实际进入普通 SDK turn 提交路径。
7. Gateway 查不到新 run 时，wrapper 曾回退到上一 turn 的完成结果；新增回归并限制原 run 恢复。
8. artifact retention 曾删除过期 SOP 审批记录；现在保护业务状态目录，独立于执行产物的 retention。
9. 真实模型生成 `debug.log` 混入交付物；新增先失败的回归并排除 `.log`。
10. bridge 事件映射丢失工具失败、完整输出和模型请求/usage 字段；保留 native payload 并还原事件名称，回归先失败后通过。

SOP 5 项、HTTP 全链路 3 项、health 2 项和旧结果污染回归均记录过修复前失败。历史 2026-10-06 的 128/138/1 项与旧镜像证据仅属于当时源码，不能替代当前组合镜像验收。

## 复现命令

PilotDeck 根目录：

```bash
NODE_OPTIONS= pnpm exec tsc -p packages/sdk/tsconfig.json --noEmit
NODE_OPTIONS= pnpm --dir packages/sdk build
NODE_OPTIONS= ./node_modules/.bin/tsx --test packages/sdk/test/transport.test.ts
docker build -t pilotdeck:standalone-alpha1-sdk .
```

wrapper 根目录：

```bash
NODE_OPTIONS= node --test runners/pilotdeck/sdk_bridge.test.mjs
python -m pytest -q api runners/pilotdeck/test_sdk_adapter.py
docker build -f Dockerfile.sdk -t lantay-pilotdeck:sdk-current .
python tools/sdk_container_smoke.py --image lantay-pilotdeck:sdk-current \
  --evidence-dir /tmp/lantay-sdk-smoke-evidence
```

本机系统 Python 缺少 pytest；Conda Python 的 readline 导入会 segfault，需要在 pytest.main 前屏蔽 readline import。容器 Python 不需要该补丁。
Docker Desktop 注入的 `host.docker.internal:7890` 代理在本机不可用；本轮 build 临时传空 HTTP/HTTPS/ALL_PROXY（含小写）构建参数，未修改全局代理设置。
直接 PyPI 下载在 PyMuPDF 阶段停滞，该次构建已取消；改用 wrapper 既有阿里云 PyPI 镜像后，无缓存构建通过。`PIP_INDEX_URL` 构建参数可覆盖该镜像地址。

最终容器命令：

```bash
docker build --no-cache -f Dockerfile.sdk \
  --build-arg HTTP_PROXY= --build-arg HTTPS_PROXY= --build-arg ALL_PROXY= \
  --build-arg http_proxy= --build-arg https_proxy= --build-arg all_proxy= \
  -t lantay-pilotdeck:sdk-clean-current .
docker run --rm --entrypoint python3 -e EVAL_TOKEN=test-container \
  -e PILOTDECK_SDK_BACKEND=native lantay-pilotdeck:sdk-clean-current \
  -m pytest -q api runners/pilotdeck/test_sdk_adapter.py
docker run --rm --entrypoint node lantay-pilotdeck:sdk-clean-current \
  --test /app/runners/pilotdeck/sdk_bridge.test.mjs
python tools/sdk_container_smoke.py --image lantay-pilotdeck:sdk-clean-current \
  --evidence-dir /tmp/lantay-sdk-smoke-evidence
```

容器 pytest 的 native env 仅隔离旧 backend 单测；SDK E2E fixture 显式启用 sdk，真实容器 smoke 也使用 sdk 默认部署。

容器证据：`docs/validation/lantay-sdk-container-smoke-20261007/`，保存 health、sync、SSE、SOP、恢复 JSON 和容器日志。确定性模型内容是验收数据，不代表真实模型质量。

## 完成定义

本地 SDK、API、SOP 契约及当前组合镜像运行均有通过证据，外部依赖列明未执行；文档不得把旧镜像、wire mock、loop completion 等同于真实交付质量。
本地 SDK 适配与真实模型验收 Goal 均已完成。2026-10-07 使用真实 provider 通过 11 组验收，并修复日志过滤和事件映射；本轮定向回归为本机 49 项、镜像内 60 项、Node bridge 3 项通过。
真实 OCR 按用户要求跳过；音视频质量、生产资源、多实例、强杀运行中进程恢复仍未验证，不计入通过。
