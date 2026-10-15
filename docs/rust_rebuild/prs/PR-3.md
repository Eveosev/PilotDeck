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

> QA / Reviewer 原文路径曾相对本机审阅目录 `/workspace/pilotdeck-rust/`。已按 `1d7c8068` 核对：仓库中存在的改为相对链接；不存在的保留原文并标「本地证据，未入库」。标「原始文件不在本机，待补」的行不补结论。

## 结论（据本地证据整理）

**QA**
- `da859d43`（qa-rerun/VERDICT.md）：**PASS**。独立复跑；采集 HEAD 为 `df1ce045`，跨机绝对值不要求一致。
- `c3b1a275`（qa-r1-verify/VERDICT.md）：**PASS**（R1–R3 验证）；指出 committed JSON 的 gitSha ≠ tip。
- `812b8da3`（qa-gate-812b8da3/VERDICT.md）：**GATE PASS**。干净树，gitDirty=false，n=30，delayPolicy=zero，`segments.*`/`non_model_ms` 齐全。
**Reviewer**
- R1（`da859d43`）：**conditional_pass**，0 blocker / 1 major / 5 minor / 1 nit。
  - R1 major：`turn_ms` 构成未拆（native pure_text 约 530ms 在 model 之外无解释）→ 加分段与 `non_model_ms`，并在干净树重采，R2 轮关闭。
- R2（`812b8da3`）：**pass**，0 blocker / 0 open major；R2、R3 已关闭，R4–R6 以文档形式关闭，R7 未核（看不到 diff）。
**遗留**
- R8 minor：METRICS/README 的两条机制归因与 marks 数据不符（pre_model 实为冷进程首次 `try_auto_compact`；stdio post_model 疑为等子进程退出），只改文案，ready 前处理。
- R9 minor：归档的 `PR.diff` 实为 `pr.json`，ready 前用 `gh pr diff 3 --name-only` 核对 14 个文件。
- R10 info：真实 stdio sidecar 每个 turn 可能多等 0–500ms，另开 issue，排入 P1 或 transport 债。
- D4：P1 只测不设线。

## QA 结论
| tip | 结论 | 原文 |
|---|---|---|
| `da859d43` | PASS | `review/2026-10-12-T-P0a-03-perf-baseline/evidence/qa-rerun/VERDICT.md`（本地证据，未入库） |
| `c3b1a275` | PASS | `review/2026-10-12-T-P0a-03-perf-baseline/evidence/qa-r1-verify/VERDICT.md`（本地证据，未入库） |
| `812b8da3` | GATE PASS | `review/2026-10-12-T-P0a-03-perf-baseline/evidence/qa-gate-812b8da3/VERDICT.md`（本地证据，未入库） |

## Reviewer 结论（逐轮）
| 轮次 | 结论 | 原文 |
|---|---|---|
| R1 | conditional_pass | `review/2026-10-12-T-P0a-03-perf-baseline/REVIEW_RESULT.md`（本地证据，未入库） |
| R2 | pass（R1 major 已关） | `review/2026-10-12-T-P0a-03-perf-baseline/REVIEW_RESULT_R2.md`（本地证据，未入库） |

## 遗留 minor / 已披露缺口
待补

## 合并后桌面 smoke
无
