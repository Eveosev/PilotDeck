# PR #3 · T-P0a-03: AgentLoop 性能基线 harness + native/stdio/tcp 证据

- 任务：T-P0a-03
- 链接：https://github.com/Eveosev/PilotDeck/pull/3（head 分支 `pilotdeck-rust/T-P0a-03-perf-baseline`）
- 合并 commit：`8a6d9b1a5ffc05da7c8ebc23088ee749d5e6b966`
- 父提交：主线 `5fa81190`，PR head `0044a13f`
- 合并时间：2026-10-12 10:31（Asia/Shanghai）

## 做了什么
AgentLoop 性能基线 harness + native/stdio/tcp 证据。（摘自 PR 标题/任务清单；细节以 PR 正文为准）

## 改动模块与路径
按目录占比（`git diff --dirstat=files` 主线父→合并）：
```
  35.7% evidence/perf-baseline/
   7.1% tools/agent-loop-parity/adapters/
   7.1% tools/agent-loop-parity/
  42.8% tools/agent-loop-perf/
```
<details><summary>文件清单（git diff --stat）</summary>

```
 .gitignore                                                  |     4 +
 evidence/perf-baseline/README.md                            |    65 +
 evidence/perf-baseline/native.json                          |  2539 +++++++++++++++++++++++
 evidence/perf-baseline/stdio.json                           | 14661 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 evidence/perf-baseline/summary.json                         |    32 +
 evidence/perf-baseline/tcp.json                             | 14661 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 tools/agent-loop-parity/adapters/pilotdeck_gateway_impl.mjs |    49 +-
 tools/agent-loop-parity/run.py                              |     2 +-
 tools/agent-loop-perf/METRICS.md                            |   126 ++
 tools/agent-loop-perf/README.md                             |    75 +
 tools/agent-loop-perf/collector.mjs                         |   119 ++
 tools/agent-loop-perf/collector.test.mjs                    |    80 +
 tools/agent-loop-perf/run.py                                |   633 ++++++
 tools/agent-loop-perf/test_run.py                           |   140 ++
 14 files changed, 33184 insertions(+), 2 deletions(-)
```
</details>

## 影响面
涉及顶层目录：`.gitignore`、`evidence`、`tools`。产品代码/仅工具证据的判断：仅工具/证据/文档/CI，无产品运行时代码。

> 原文路径相对本机审阅目录 `/workspace/pilotdeck-rust/`（部分目录也随 PR 入库到仓库 `review/`）；入库前需核对仓库内是否存在。

## QA 结论
| tip | 结论 | 原文 |
|---|---|---|
| — | 原始文件不在本机，待补 | — |

## Reviewer 结论（逐轮）
| 轮次 | 结论 | 原文 |
|---|---|---|
| R1 | conditional_pass | `review/2026-10-12-T-P0a-03-perf-baseline/REVIEW_RESULT.md` |
| R2 | pass（R1 major 已关） | `review/2026-10-12-T-P0a-03-perf-baseline/REVIEW_RESULT_R2.md` |

## 遗留 minor / 已披露缺口
待补

## 合并后桌面 smoke
无
