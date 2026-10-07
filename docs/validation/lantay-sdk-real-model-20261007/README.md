# SDK / Lantay 真实模型验收

日期：2026-10-07。结论：本轮 11 组真实模型/Gateway/API 验收全部通过。
OCR 按用户要求跳过。此结论适用于单实例本地组合容器，不代表生产多实例或普遍任务质量。

## 环境

- 核心：`standalone_alpha1`，HEAD `0a2ba0cc9` 加当前未提交 SDK 增量。
- 模型：`LLMCenter/qwen3.6-flash-distill`，OpenAI-compatible API。
- 凭据：桌面 `.env` 的 `PILOTDECK_MODEL_API_KEY`；只在进程环境中传递，报告与日志已脱敏。
- 最终镜像：`lantay-pilotdeck:sdk-real-accepted`，基于当前 standalone 核心和 SDK 的 `Dockerfile.sdk`。
- 独立容器、随机本机端口、临时 Gateway state 与 wrapper outputs；每轮结束清理测试容器。
- `MOCK_OCR_API=true` 仅用于启动，上传 CSV/TXT，没有执行 OCR 验收。
- Docker 的无效代理只在测试进程中清空；已有用户容器未操作。

## 验收结果

| 验收组 | 独立断言 | 最终通过证据 |
| --- | --- | --- |
| 鉴权/参数 | 无 token 401、非法 session 400、未知 skill 400、未上传引用 400 | `accepted/errors.json` |
| 上传/同步 JSON/模型覆盖 | CSV 金额 17+29+41，真实模型返回 `ACCEPTANCE_SUM=87`；transcript 存在；模型请求计数非零 | `accepted/sync-result.json` |
| 单技能/白名单 | 测试技能由 Gateway catalog 加载；单技能和两技能白名单都输出技能中的 marker | `skills/skills.json` |
| 工具/交付物 | 五种文件真实落盘；MD/CSV 文本正确；DOCX ZIP/XML、XLSX 单元格、PDF 解析文字正确；二进制 Base64；脚本/日志排除；工具输出可读 | `delivery/delivery-result.json` |
| SSE | assistant 增量、trajectory、done 完整，答案 `REAL_SSE_READY` | `stream-recovery/sse-result.txt` |
| 并发/断线恢复 | 同 session 409 `session_busy`；不同 session 完成；断开 SSE 后 GET 得到 `DISCONNECT_RECOVERED` 且 runId 不变 | `stream-recovery/concurrency.json`、`disconnect-result.json` |
| SDK 恢复 | 原 run 的 get/reattach/result；afterSeq 分页无重复，答案一致，不提交新 run | `accepted/sdk-replay.json` |
| SDK abort | 真实 Gateway run 中断后 result 为 `aborted` | `abort/aborted-result.json` |
| SOP 审批/续跑/幂等 | 普通 SDK 提交；记住上轮 CSV，输出 `APPROVED_SUM=87`；重复 resume 同 run；执行完成但 delivery pending | `accepted/sop-resume.json` |
| 重启/交付门禁 | 容器重启后原 run 和答案恢复；重复 resume 不重提；未验证交付 400，验证后 delivery completed | `accepted/recovered-result.json`、`sop-recovered.json`、`checks.json` |
| SOP 拒绝/超时 | reject 和 timeout 持久化；resume 返回 409 | `accepted/sop-review-decisions.json` |

每轮 `summary.json` / `checks.json` 保存机器可读断言与耗时。最终证据按上表选择；早期失败未删除，不能将早期目录整体解释为通过。

## 发现与修复

1. `.log` 被默认宽松交付物扫描收集，导致 `debug.log` 混入。新增包含嵌套日志、大小写后缀的回归，确认修复前失败；现在排除日志，文件保留在 workspace。
2. SDK bridge 事件映射丢失 native payload，工具失败未配对、完整工具输出为空、模型请求计数为 0。新增回归确认修复前失败；现在保留原字段，恢复 tool.failed、tool.result_detail、context.usage、pilotdeck.* 映射和终态 usage。
3. 验收脚本自身修正：SSE 是 native 事件帧而非 event 外壳，答案位于 trajectory；使用服务返回 session；未验证交付为 400 `delivery_invalid`；SDK abort 返回 void；本机 PDF 验证使用已安装 pypdf。

首轮文件留在本目录根部。`accepted/` 使用修复后的镜像，但其中交付文件、流式与 abort 的早期脚本断言仍有失败；对应项分别由 `delivery/`、`stream-recovery/`、`abort/` 的通过证据替代。SOP、上传、SDK replay 无须重复模型调用。

## 定向回归

- Node bridge：3 项通过；包含先失败后修复的事件字段回归。
- 本机交付/HTTP E2E：49 项通过，2 条第三方 websockets deprecation warning。
- 最终镜像内交付/HTTP E2E/SOP execution/adapter：60 项通过，1 条第三方 Starlette deprecation warning。
- 镜像增量构建通过；amd64 在 arm64 Docker Desktop 运行使用模拟。
- 前轮完整 SDK 130 项和 wrapper 159 项证据见主计划；本轮修改后只重跑相关集合，不声称完整集合重新执行。

## 复现

wrapper 目录运行，宿主 Python 需要 httpx、python-dotenv、pypdf、openpyxl：

```bash
python tools/sdk_real_model_acceptance.py \
  --env-file /Users/a1/Desktop/.env \
  --image lantay-pilotdeck:sdk-real-accepted \
  --model LLMCenter/qwen3.6-flash-distill \
  --api-base https://llm-center.modelbest.co/v1 \
  --evidence-dir /tmp/lantay-sdk-real-model
```

可用 `--checks <name> ...` 重跑独立验收组，名称见 `checks.json`。SOP/restart/replay 依赖同轮 `multipart_sync_material_comprehension`，筛选时应一并指定。

## 未测范围

- OCR/PDF 输入转换、音视频 sidecar 和真实 OCR 失败降级：用户要求跳过。
- 生产部署配额、生产多实例原子锁/唯一运行所有权：未验证。
- 重启测试覆盖已完成 run 和持久化 SOP；未覆盖强杀进行中模型/tool 进程后的恢复。
- 大于大小限制、损坏文档、result_unknown/event gap、retention/锁过期依赖已有确定性测试，未在本轮重复真实模型场景。
- 真实 provider 拒绝/额度错误和未知 case 尚未做本轮在线验收。
- 不把五文件样例的通过当作所有业务交付质量的保证。
