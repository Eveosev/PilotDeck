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

## QA 结论
| tip | 结论 | 原文 |
|---|---|---|
| — | 原始文件不在本机，待补 | — |

## Reviewer 结论（逐轮）
| 轮次 | 结论 | 原文 |
|---|---|---|
| R1 | conditional_pass | `review/2026-10-10-T-P0a-00-parity-tcp/REVIEW_RESULT.md`（本地证据，未入库） |
| R2 | pass | `review/2026-10-10-T-P0a-00-parity-tcp/REVIEW_RESULT_R2.md`（本地证据，未入库） |

## 遗留 minor / 已披露缺口
待补

## 合并后桌面 smoke
无
