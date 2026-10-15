# PR #2 · pilotdeck-rust / T-P0a-02′ R5-R7 comparator

- 任务：T-P0a-02′
- 链接：https://github.com/Eveosev/PilotDeck/pull/2（head 分支 `pilotdeck-rust/T-P0a-02-comparator`）
- 合并 commit：`93fb4f89b4771a10f73bc32d046b7b9a3b883252`
- 父提交：主线 `b243fa00`，PR head `2223c8b7`
- 合并时间：2026-10-11 22:16（Asia/Shanghai）

## 做了什么
comparator：通道序比较(R5)+budget 文案(R6)+cancel 确定性(R7)，含 TS 小修与单测。（摘自 PR 标题/任务清单；细节以 PR 正文为准）

## 改动模块与路径
按目录占比（`git diff --dirstat=files` 主线父→合并）：
```
  11.1% src/agent/loop/
  22.2% tests/agent/loop/
  11.1% tests/agent/modules/
  11.1% tools/agent-loop-parity/adapters/
  44.4% tools/agent-loop-parity/
```
<details><summary>文件清单（git diff --stat）</summary>

```
 src/agent/loop/AgentLoop.ts                                 |   2 ++
 tests/agent/loop/agent-status-projection.spec.ts            |  11 +++----
 tests/agent/loop/max-budget.spec.ts                         |  72 +++++++++++++++++++++++++++++++++++++++++++-
 tests/agent/modules/sidecar-client.spec.ts                  |  37 +++++++++++++++++++++++
 tools/agent-loop-parity/adapters/pilotdeck_gateway_impl.mjs |  77 ++++++++++++++++++++++++++++++++++++++++++-----
 tools/agent-loop-parity/mock_backend.py                     |  23 ++++++++++++--
 tools/agent-loop-parity/run.py                              |  28 +++++++++++++----
 tools/agent-loop-parity/test_trace.py                       | 216 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 tools/agent-loop-parity/trace.py                            | 174 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++-----
 9 files changed, 611 insertions(+), 29 deletions(-)
```
</details>

## 影响面
涉及顶层目录：`src`、`tests`、`tools`。产品代码/仅工具证据的判断：含产品代码（src/、apps/、ui/ 或 crates/）。

> QA / Reviewer 原文路径曾相对本机审阅目录 `/workspace/pilotdeck-rust/`。已按 `1d7c8068` 核对：仓库中存在的改为相对链接；不存在的保留原文并标「本地证据，未入库」。标「原始文件不在本机，待补」的行不补结论。

## 结论（据本地证据整理）

**QA**
- `57a43158`（qa-verify/VERDICT.md）：**PASS**（单测 57 OK、matrix-53 exit 0）；后因 Reviewer R1 fail 被标 **VOID**。
- `c57b5261`（qa-verify-r1r3/VERDICT.md）：**PASS**。R1–R3 静态检查通过，cancel 20/20、matrix-53 exit 0。
- `2223c8b7`（r7-lock-smoke + r7-full-ts）：**PASS**（R7 锁定范围）。三条锁 HEAD PASS / base FAIL；`sidecar-client.spec.js` 52/53，失败项为已知 tool-progress flake。
**Reviewer**
- R1（`57a43158`）：**fail**，1 blocker / 2 major / 4 minor。
  - R1 blocker：比较器可交错通道远超 5 类 → 收紧为 5 类 + 严格 per-actor `core`，R2 轮关闭。
  - R2 major：cancel 不稳定、靠放宽掩盖 → 恢复 `abortSignal`、`abort_turn` 失败记 `cancel.error`、mock 等产品 abort，R2 轮关闭。
  - R3 major：「两侧 cancelled 即忽略 `turn_aborted`」放宽 → 已删除并加反向单测，R2 轮关闭。
- R2（`c57b5261`）：**pass**，0 blocker / 0 major；新增 minor R2-1…R2-6；R4/R5/R7 仍开，R6 只能部分核实。R7 需 Payne 明确接受 `AgentLoop.ts` 对 stdio 所有 status 文案的改动。
- R3–R6：原始文件缺失。
- R7（`2223c8b7`）：**pass**，0 blocker / 0 major；三条锁与方案 A 一致，commit 只改测试；新增 minor R7-1…R7-3。
**遗留**
- R2-1（PR 正文对 durable 重排说法过宽）、R2-2、R2-3、R2-4/R4（`requireObservedDifferences` 死配置）、R5（summary 不记两侧 transport）、R6。
- R2-5 / R2-6 / R7-2 / R7-3：证据补齐（probe 文件、test_trace stdout、base 上 tool-progress 结果、PR 正文 53/53 应改为与 QA 一致的 52/53）。
- R7-1：在 HEAD 上跑一遍完整 TS 单测，确认没有其他测试锁住旧的 B0 形状。

## QA 结论
| tip | 结论 | 原文 |
|---|---|---|
| `57a43158` | PASS（后因 Reviewer R1 fail 被标 VOID） | `review/2026-10-10-T-P0a-02-comparator/evidence/qa-verify/VERDICT.md`（本地证据，未入库） |
| `c57b5261` | PASS | `review/2026-10-10-T-P0a-02-comparator/evidence/qa-verify-r1r3/VERDICT.md`（本地证据，未入库） |
| `2223c8b7` | PASS（R7 锁定范围） | `review/2026-10-10-T-P0a-02-comparator/evidence/r7-lock-smoke/VERDICT.md`、`review/2026-10-10-T-P0a-02-comparator/evidence/r7-full-ts/VERDICT.md`（本地证据，未入库） |

## Reviewer 结论（逐轮）
| 轮次 | 结论 | 原文 |
|---|---|---|
| R1 | fail（1 blocker/2 major/4 minor） | `review/2026-10-10-T-P0a-02-comparator/REVIEW_RESULT.md`（本地证据，未入库） |
| R2 | pass | `review/2026-10-10-T-P0a-02-comparator/REVIEW_RESULT_R2.md`（本地证据，未入库） |
| R3–R6 | 原始文件不在本机，待补 | — |
| R7 | pass | `review/2026-10-10-T-P0a-02-comparator/REVIEW_RESULT_R7.md`（本地证据，未入库） |

## 遗留 minor / 已披露缺口
待补（见各轮原文 minor）

## 合并后桌面 smoke
无
