# PR #7 · T-P0a-07: Module Protocol 变更同步门禁（文档）

- 任务：T-P0a-07
- 链接：https://github.com/Eveosev/PilotDeck/pull/7（head 分支 `pilotdeck-rust/T-P0a-07-protocol-change-gate`）
- 合并 commit：`d6ec73d824e74009c47c0254c86db194ad7ce66d`
- 父提交：主线 `e316945d`，PR head `54e9d8b7`
- 合并时间：2026-10-13 14:16（Asia/Shanghai）

## 做了什么
Module Protocol 变更同步门禁（文档）。（摘自 PR 标题/任务清单；细节以 PR 正文为准）

## 改动模块与路径
按目录占比（`git diff --dirstat=files` 主线父→合并）：
```
  10.0% evidence/schema/
  10.0% evidence/
  50.0% review/2026-10-12-T-P0a-07-protocol-change-gate/
```
<details><summary>文件清单（git diff --stat）</summary>

```
 CONTRIBUTING.md                                                     | 132 ++++++++++++++++++++++++++++++++++++++++
 README.md                                                           |   2 +-
 README.zh.md                                                        |   2 +-
 evidence/protocol-sync-gate.md                                      | 412 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 evidence/schema/README.md                                           |  16 ++++-
 review/2026-10-12-T-P0a-07-protocol-change-gate/DECISION.md         |  39 ++++++++++++
 review/2026-10-12-T-P0a-07-protocol-change-gate/PROGRESS.md         | 261 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 review/2026-10-12-T-P0a-07-protocol-change-gate/REVIEW_PROMPT.md    |   8 +++
 review/2026-10-12-T-P0a-07-protocol-change-gate/REVIEW_RESULT.md    | 122 +++++++++++++++++++++++++++++++++++++
 review/2026-10-12-T-P0a-07-protocol-change-gate/REVIEW_RESULT_R2.md | 100 ++++++++++++++++++++++++++++++
 10 files changed, 1089 insertions(+), 5 deletions(-)
```
</details>

## 影响面
涉及顶层目录：`CONTRIBUTING.md`、`README.md`、`README.zh.md`、`evidence`、`review`。产品代码/仅工具证据的判断：仅工具/证据/文档/CI，无产品运行时代码。

> QA / Reviewer 原文路径曾相对本机审阅目录 `/workspace/pilotdeck-rust/`。已按 `1d7c8068` 核对：仓库中存在的改为相对链接；不存在的保留原文并标「本地证据，未入库」。标「原始文件不在本机，待补」的行不补结论。

## 结论（据本地证据整理）

**QA**
- `3b5cf763`：**PASS**。G1–G7 通过：G2 抓到 stale 并重生成，G3 时 replay 以 exit 1 报出 53 个错配；范围只有 docs/evidence/review。
- `9da4ee1d`（R2 增量）：**PASS**。按原文用 `bash -e` 连跑 exit 0；旧顺序对照 exit 2；Node 20 下 replay exit 9。F-5 只核了文档，没有实测改坏锚点。
- `7bcee318`：**PASS**（CI pending）。R2-1…R2-7 通过；F-7 的 79 个删除文件 sha256 核对 0 不符。
- `bbb88cb7`（同步 M=`7d488a1b`）：**PASS（结构）**。CI web 失败仍开（合并前就已失败）。
- `f6d46add`（同步 M=`2c4420b4`）：**merge gate PASS**，CI 当时 pending。
- **QA 未覆盖合并 head**：合并 head 是 `54e9d8b7`，比 QA 最后验过的 `f6d46add` 多了几个文档提交，本机没有对应记录。
**Reviewer**
- R1（`3b5cf763`）：**conditional_pass**，0 blocker / 2 major / 4 minor。
  - F-1 major：replay 会改写已跟踪的报告，按 2→3→7 照抄执行时第二次 exit 2 → 改为「一次 replay → 拷贝 → restore → 只读副本」，R2 轮关闭。
  - F-2 major：触发范围只写了 `protocol.ts`，漏了 lib 映射和语料源 → 补全适用范围，R2 轮关闭。
- R2（`9da4ee1d`）：**conditional_pass**，R1 的 10 条里 9 条 closed，F-7 partially。新增 R2-1（CI `paths:` 列表漏了 schema 产物和依赖，ready 前修）、R2-2…R2-4 minor。R2-1…R2-7 在 `7bcee318` 经 QA 核为 PASS。
**遗留**
- F-5：锚点改坏时 exit 1 只做了文档核对 → 建议在 T-P0a-04 做 CI 时补负控制。
- CI `paths:` 按 R2-1 补全后的列表落地，归 T-P0a-04。

## QA 结论
| tip | 结论 | 原文 |
|---|---|---|
| `3b5cf763` | PASS | `review/2026-10-12-T-P0a-07-protocol-change-gate/qa-gate-3b5cf763/SUMMARY.md`（本地证据，未入库） |
| `9da4ee1d` | PASS | `review/2026-10-12-T-P0a-07-protocol-change-gate/qa-gate-9da4ee1d/SUMMARY.md`（本地证据，未入库） |
| `7bcee318` | PASS（CI pending） | `/workspace/pilotdeck-rust/review/2026-10-12-T-P0a-07-protocol-change-gate/qa-gate-7bcee318/SUMMARY.md` |
| `bbb88cb7` | PASS（structure） | `/workspace/pilotdeck-rust/review/2026-10-12-T-P0a-07-protocol-change-gate/qa-gate-bbb88cb7/SUMMARY.md` |
| `f6d46add` | merge gate PASS | `/workspace/pilotdeck-rust/review/2026-10-12-T-P0a-07-protocol-change-gate/qa-gate-f6d46add/SUMMARY.md` |

## Reviewer 结论（逐轮）
| 轮次 | 结论 | 原文 |
|---|---|---|
| R1 | conditional_pass | [review/2026-10-12-T-P0a-07-protocol-change-gate/REVIEW_RESULT.md](../../../review/2026-10-12-T-P0a-07-protocol-change-gate/REVIEW_RESULT.md) |
| R2 | conditional_pass（修 R2-1 即 ready） | [review/2026-10-12-T-P0a-07-protocol-change-gate/REVIEW_RESULT_R2.md](../../../review/2026-10-12-T-P0a-07-protocol-change-gate/REVIEW_RESULT_R2.md) |

## 遗留 minor / 已披露缺口
R2 原文：F-7 partially（旧 QA 件 sha256 核验由 QA 跟进）。

**QA 未覆盖合并 head**。最后一档 QA tip `f6d46add`，合并 head `54e9d8b7`（`f6d46add` 为其祖先）。first-parent 上之后 4 个提交：`82497abe` 并入主线 `761572d7`（#8），`ca737b63` 在 PROGRESS 记下这次同步，`04494c39` 并入主线 `e316945d`（#12），`54e9d8b7` 在 PROGRESS 记下这次同步。

`git diff f6d46add 54e9d8b7` 为 83 个文件（+9466/−13）。去掉 `review/2026-10-12-T-P0a-07-protocol-change-gate/PROGRESS.md` 后，与主线 `git diff 2c4420b4 e316945d` 的补丁相同（QA tip 已同步到 `2c4420b4`，head 再同步到 #12 的合并提交 `e316945d`）。多出来的只有 PROGRESS（+51/−2），用来记录 #8 与 #12 两次主线同步。QA 没有在 `54e9d8b7` 上重跑。

## 合并后桌面 smoke
无
