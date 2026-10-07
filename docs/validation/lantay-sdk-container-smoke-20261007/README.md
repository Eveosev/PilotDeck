# Lantay SDK 容器验收证据

日期：2026-10-07。最终镜像：`lantay-pilotdeck:sdk-clean-current`（无缓存构建），组合 `pilotdeck:standalone-alpha1-sdk`。
Gateway 为实际 standalone 核心进程，模型为本地确定性 OpenAI HTTP fixture，OCR 为 mock。

通过：

- health 为 ok，模型配置有效、存储可写、Gateway 1.2 握手成功。
- multipart `memo.txt` 字节通过 Gateway upload 进入 Agent 输入；`sync-result.json` transcript 包含 `container material`。
- sync 完成，final answer 为 `container SDK smoke`，summary 无执行错误。
- SSE 完成，见 `sse-result.txt`。
- 创建 SOP、handoff、approve 后，resume 实际经 SDK 提交续跑，见 `sop-resume.json`。
- SOP execution 为 completed，delivery 保持 pending。
- `docker restart` 后读取同一 resumed run ID 与最终答案，见 `recovered-result.json`。
- 重启后重复 resume 不创建新 run，delivery 仍 pending，见 `sop-recovered.json`。
- 同一最终镜像内 API/adapter 测试 159 项、Node bridge 测试 3 项全部通过。

这是运行与持久化验收，不是业务交付质量评估；不证明真实 provider/OCR、多实例一致性或真实音视频处理质量。
容器只保存此次生成的验收数据，脚本退出时停止测试容器；已有用户容器未被操作。

复现：在 wrapper 目录运行

```bash
python tools/sdk_container_smoke.py --image lantay-pilotdeck:sdk-clean-current \
  --evidence-dir /tmp/lantay-sdk-evidence
```
