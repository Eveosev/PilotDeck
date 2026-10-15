# PR #5 · T-P0a-01: generate module-protocol.schema.json from protocol.ts

- 任务：T-P0a-01
- 链接：https://github.com/Eveosev/PilotDeck/pull/5（head 分支 `pilotdeck-rust/T-P0a-01-protocol-schema`）
- 合并 commit：`1da663a21d40ef5e309c86423a235550c79f91ff`
- 父提交：主线 `64647f53`，PR head `34767840`
- 合并时间：2026-10-12 18:10（Asia/Shanghai）

## 做了什么
从 protocol.ts 生成 module-protocol.schema.json 并交叉校验。（摘自 PR 标题/任务清单；细节以 PR 正文为准）

## 改动模块与路径
按目录占比（`git diff --dirstat=files` 主线父→合并）：
```
  16.6% evidence/schema/fixtures/
  50.0% evidence/schema/
   8.3% scripts/lib/
  25.0% scripts/
```
<details><summary>文件清单（git diff --stat）</summary>

```
 evidence/schema/README.md                               |  52 ++++++++
 evidence/schema/additional-properties-probe.json        | 264 +++++++++++++++++++++++++++++++++++++
 evidence/schema/additional-properties-probe.md          |  32 +++++
 evidence/schema/fixtures/edge-samples.json              | 173 ++++++++++++++++++++++++
 evidence/schema/fixtures/negative-samples.json          | 131 +++++++++++++++++++
 evidence/schema/module-protocol.schema.json             | 602 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 evidence/schema/replay-report.json                      | 982 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 evidence/schema/replay-report.md                        |  74 +++++++++++
 scripts/generate-module-protocol-schema.mjs             |  36 +++++
 scripts/lib/module-protocol-schema.mjs                  | 743 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 scripts/probe-module-protocol-additional-properties.mjs | 248 +++++++++++++++++++++++++++++++++++
 scripts/replay-module-protocol-schema.mjs               | 478 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 12 files changed, 3815 insertions(+)
```
</details>

## 影响面
涉及顶层目录：`evidence`、`scripts`。产品代码/仅工具证据的判断：仅工具/证据/文档/CI，无产品运行时代码。

> QA / Reviewer 原文路径曾相对本机审阅目录 `/workspace/pilotdeck-rust/`。已按 `1d7c8068` 核对：仓库中存在的改为相对链接；不存在的保留原文并标「本地证据，未入库」。标「原始文件不在本机，待补」的行不补结论。

## 结论（据本地证据整理）

**QA**
- `754bb192`：**PASS**（另有 2 个非阻塞 follow-up）。A1–A4 通过，53 场景共 542 条比对，可表达错配 0。F1：probe 证据记录 gitDirty=true，需在干净树重生成；F2：probe 不能直接用 node 运行。
- `89ddfc66`：**PASS**。只改 probe 相关 3 个文件；F1、F2 关闭。
- `34767840`：**PASS**。A2 共 648 条比对、错配 0，语料标注为 synthetic；A3 负样本 20/20、边角样本 26/26；F-1/F-3/F-4/F-6 通过。观察：reject 覆盖只靠 A3。
**Reviewer**
- R1（`89ddfc66`）：**conditional_pass**，2 major / 4 minor（F-3…F-6）。
  - F-1 major：schema 的 `response.final` 限定 boolean，比 TS validator 严 → 删掉该类型约束并补边角样本，R2 轮关闭。
  - F-2 major：A2「trace 回放」实为合成的纯正样本（542/0）→ 口径改为 synthetic 并披露分布，R2 轮关闭。
- R2（`34767840`）：**pass**，建议 ready；F-3、F-6、F-7、F-9 关闭；剩余 R2-1…R2-8 都是 minor/nit。
**遗留**
- R2-2：T-P1 serde 风险（`1.0`/`-0`/指数/>2^53/`1e400`/重复键/ajv strict）需登记成 T-P1-01 或 T-P1-07 的可追踪条目，建议合并前完成。
- R2-1：变异语料，与 F-8、F-10 一起放到 T-P0a-07 或 T-P0a-04。
- R2-3…R2-8、F-11：下次改到相关文件时顺手处理。

## QA 结论
| tip | 结论 | 原文 |
|---|---|---|
| `754bb192` | PASS（2 个非阻塞 follow-up） | `review/2026-10-12-T-P0a-01-protocol-schema/evidence/qa-gate-754bb192/SUMMARY.md`（本地证据，未入库） |
| `89ddfc66` | PASS | `review/2026-10-12-T-P0a-01-protocol-schema/evidence/qa-gate-89ddfc66/SUMMARY.md`（本地证据，未入库） |
| `34767840` | PASS | `review/2026-10-12-T-P0a-01-protocol-schema/evidence/qa-gate-34767840/SUMMARY.md`（本地证据，未入库） |

## Reviewer 结论（逐轮）
| 轮次 | 结论 | 原文 |
|---|---|---|
| R1 | conditional_pass | `review/2026-10-12-T-P0a-01-protocol-schema/REVIEW_RESULT.md`（本地证据，未入库） |
| R2 | pass | `review/2026-10-12-T-P0a-01-protocol-schema/REVIEW_RESULT_R2.md`（本地证据，未入库） |

## 遗留 minor / 已披露缺口
QA 754bb192 列 2 个非阻塞 follow-up

## 合并后桌面 smoke
无
