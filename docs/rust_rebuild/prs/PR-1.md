# PR #1 · pilotdeck-rust / T-P0a-00 parity TCP

- 任务：T-P0a-00
- 链接：https://github.com/Eveosev/PilotDeck/pull/1（head 分支 `pilotdeck-rust/T-P0a-00-parity-tcp`）
- 合并 commit：`5fa81190680a6cf5728045148ccdf5c7315fc0be`
- 父提交：主线 `93fb4f89`，PR head `38bacf0a`
- 合并时间：2026-10-11 22:22（Asia/Shanghai）

## 做了什么
parity 工具支持 TCP 目标（adapter/trace/run 负对照）。（摘自 PR 标题/任务清单；细节以 PR 正文为准）

## 改动模块与路径
按目录占比（`git diff --dirstat=files` 主线父→合并）：
```
  16.6% docs/
  16.6% tools/agent-loop-parity/adapters/
  66.6% tools/agent-loop-parity/
```
<details><summary>文件清单（git diff --stat）</summary>

```
 docs/pilotdeck-agent-loop-parity-sop.zh.md                  |   4 +-
 tools/agent-loop-parity/README.md                           |  99 ++++++++++++++++++++++++++---
 tools/agent-loop-parity/adapters/pilotdeck_gateway_impl.mjs |  46 +++++++++-----
 tools/agent-loop-parity/run.py                              | 456 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++---------------------------
 tools/agent-loop-parity/test_trace.py                       | 236 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 tools/agent-loop-parity/trace.py                            |  18 +++++-
 6 files changed, 741 insertions(+), 118 deletions(-)
```
</details>

## 影响面
涉及顶层目录：`docs`、`tools`。产品代码/仅工具证据的判断：仅工具/证据/文档/CI，无产品运行时代码。

> QA / Reviewer 原文路径曾相对本机审阅目录 `/workspace/pilotdeck-rust/`。已按 `1d7c8068` 核对：仓库中存在的改为相对链接；不存在的保留原文并标「本地证据，未入库」。标「原始文件不在本机，待补」的行不补结论。

## 结论（据本地证据整理）

**QA**
- `8d8cc8f9`（r1-qa/VERDICT.md）：**PASS**。tcp pure_text 正向 exit 0、sidecarTransport=tcp；stdio/tcp 负对照均 BLOCKED（exit 2），关闭 Reviewer R1 要求的三项产物。
- `8b132c1f`（r2-qa-smoke/VERDICT.md）：**PASS**。`test_trace` 67/67；tcp 正向 exit 0；neg-stdio / neg-tcp 均 exit 2。
**Reviewer**
- R1（base `b243fa00`）：**conditional_pass**，0 blocker / 2 major / 7 minor（R3–R9）。
  - R1 major：A1/A3 只有云端 agent 自述、无原始产物 → QA 在 `8d8cc8f9` 补齐 r1-qa 三项产物关闭。
  - R2 major：TCP sidecar stdout/stderr 用 PIPE 不读，可能写满卡死 → 改为写 `tcp-sidecar.log`，summary 加 `tcpSidecarLog`，启动失败带日志尾 BLOCKED，R2 关闭。
- R2（`8b132c1f`）：**pass**，0 blocker / 0 major；新增 minor R2-1、R2-2，R3–R9 维持 minor。
**遗留**
- R3（transport 由 adapter 自报、summary 不记 tcp target）：须在 T-P1-03 之前处理。
- R4、R6、R2-2（场景间不探活、端口竞态、失败路径无端到端产物）：建议在 T-P0a-02 tcp 全量前处理。
- R2-1（测试用 `env={}` 依赖系统 python3）、R5、R7、R8、R9：随时处理。

## QA 结论
| tip | 结论 | 原文 |
|---|---|---|
| `8d8cc8f9` | PASS | `evidence/r1-qa/VERDICT.md`（本地证据，未入库） |
| `8b132c1f` | PASS | `evidence/r2-qa-smoke/VERDICT.md`（本地证据，未入库） |

## Reviewer 结论（逐轮）
| 轮次 | 结论 | 原文 |
|---|---|---|
| R1 | conditional_pass | `review/2026-10-10-T-P0a-00-parity-tcp/REVIEW_RESULT.md`（本地证据，未入库） |
| R2 | pass | `review/2026-10-10-T-P0a-00-parity-tcp/REVIEW_RESULT_R2.md`（本地证据，未入库） |

## 遗留 minor / 已披露缺口
待补

## 合并后桌面 smoke
无
