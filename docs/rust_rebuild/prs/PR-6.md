# PR #6 · fix(desktop): sync @pilotdeck/sdk into isolated runtime packaging

- 任务：—（desktop fix）
- 链接：https://github.com/Eveosev/PilotDeck/pull/6（head 分支 `pilotdeck-rust/desktop-sdk-runtime-fix`）
- 合并 commit：`2c4420b417bc9eefe19b52f3d62245c8b74d406a`
- 父提交：主线 `a1cf6d81`，PR head `12395bbe`
- 合并时间：2026-10-13 07:07（Asia/Shanghai）

## 做了什么
@pilotdeck/sdk 同步进隔离 runtime 打包。（摘自 PR 标题/任务清单；细节以 PR 正文为准）

## 改动模块与路径
按目录占比（`git diff --dirstat=files` 主线父→合并）：
```
  22.2% apps/desktop/runtime/
  22.2% apps/desktop/scripts/
  11.1% review/2026-10-12-desktop-sdk-runtime-fix/round2/legacy-deb-e2e/
  11.1% review/2026-10-12-desktop-sdk-runtime-fix/round2/
  33.3% review/2026-10-12-desktop-sdk-runtime-fix/
```
<details><summary>文件清单（git diff --stat）</summary>

```
 apps/desktop/runtime/package.json                                         |   3 ++
 apps/desktop/runtime/pnpm-lock.yaml                                       |  23 +++++++++++++
 apps/desktop/scripts/build-runtime.mjs                                    | 214 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++-----------------
 apps/desktop/scripts/ui-server-runtime-imports.test.mjs                   | 127 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 review/2026-10-12-desktop-sdk-runtime-fix/DECISION.md                     |   5 +++
 review/2026-10-12-desktop-sdk-runtime-fix/PROGRESS.md                     |  86 ++++++++++++++++++++++++++++++++++++++++++++++++
 review/2026-10-12-desktop-sdk-runtime-fix/README.md                       |  52 +++++++++++++++++++++++++++++
 review/2026-10-12-desktop-sdk-runtime-fix/round2/README.md                |  44 +++++++++++++++++++++++++
 review/2026-10-12-desktop-sdk-runtime-fix/round2/legacy-deb-e2e/README.md |  44 +++++++++++++++++++++++++
 9 files changed, 567 insertions(+), 31 deletions(-)
```
</details>

## 影响面
涉及顶层目录：`apps`、`review`。产品代码/仅工具证据的判断：含产品代码（src/、apps/、ui/ 或 crates/）。

> QA / Reviewer 原文路径曾相对本机审阅目录 `/workspace/pilotdeck-rust/`。已按 `1d7c8068` 核对：仓库中存在的改为相对链接；不存在的保留原文并标「本地证据，未入库」。标「原始文件不在本机，待补」的行不补结论。

## 结论（据本地证据整理）

**QA**
- `524cb673`（R2 gate）：**GATE PASS（代码）**。D1–D7 通过：base 上 manifest 失败、head 上通过；独立 resolver 结果 0 missing；staged runtime 启动 200。DEB x64/arm64 在 `desktop-chrome.smoke.mjs:237` 仍红，判为基线遗留。
- `46ca9718`（R3 gate）：**PASS**。R2-1/R2-2/F-7 通过，删除的 37 个文件都有 sha256 记录。CI 当时还在排队。
- `c1eab0d5`：**PASS**（CI pending）。只改 review/ 文档，R3-1 的 ID 冲突已拆开。
- `918594b1`（主线同步后）：**merge gate PASS；CI 未全绿**。DEB x64/arm64 在 `:251` 失败，归因于 e2e mock 缺 `/api/modules/runtime`，不是产品 bug。
- `12395bbe`（同步 #10，M=`a1cf6d81`）：**merge gate PASS；CI 只剩 CI-3（web）红**。CI-4（`:251`）已由 #10 关闭；CI-3 是基线既有问题。
**Reviewer**
- R1（`d60aee42`）：**conditional_pass**，0 blocker / 0 major / 4 minor / 3 nit。唯一合并条件是 F-3：mac/Win/DEB/RPM 的 CI 确认。
- R2（`524cb673`）：**conditional_pass**，0 blocker / 0 major。`.mjs` 改写和构建内校验正确；DEB 红归因于 base merge `e07d451f`。新增 R2-1（测试复制逻辑而非 import）、R2-2（main guard），均为 minor。
- R3（`46ca9718`）：**conditional_pass**，0 blocker / 0 major。R2-1、R2-2、F-7 关闭；新增 R3-1（PROGRESS 里 ID 冲突，只改文档）。
**遗留**
- 跟进项：R1 的 F-2（`rmSync` guard）、F-5（映射单测）、F-6；R2-3、R2-4；R3-2…R3-6；macOS/Windows 的 UI-server 启动冒烟（F-3 残余）。
- CI-3（Web Regression）是基线技术债，合并时仍红，需要修复、排除或豁免。

## QA 结论
| tip | 结论 | 原文 |
|---|---|---|
| `524cb673` | GATE PASS (code) | `review/2026-10-12-desktop-sdk-runtime-fix/qa-gate-524cb673/SUMMARY.md`（本地证据，未入库） |
| `46ca9718` | PASS | `review/2026-10-12-desktop-sdk-runtime-fix/qa-gate-46ca9718/SUMMARY.md`（本地证据，未入库） |
| `c1eab0d5` | PASS | `review/2026-10-12-desktop-sdk-runtime-fix/qa-gate-c1eab0d5/SUMMARY.md`（本地证据，未入库） |
| `918594b1` | merge gate PASS；CI 未全绿 | `review/2026-10-12-desktop-sdk-runtime-fix/qa-gate-918594b1/SUMMARY.md`（本地证据，未入库） |
| `12395bbe` | merge gate PASS；CI 未全绿（仅 CI-3） | `review/2026-10-12-desktop-sdk-runtime-fix/qa-gate-12395bbe/SUMMARY.md`（本地证据，未入库） |

## Reviewer 结论（逐轮）
| 轮次 | 结论 | 原文 |
|---|---|---|
| R1 | conditionally yes（条件：Desktop dist / rust-hello CI 绿） | `review/2026-10-12-desktop-sdk-runtime-fix/REVIEW_RESULT.md`（本地证据，未入库） |
| R2 | conditional_pass | `review/2026-10-12-desktop-sdk-runtime-fix/REVIEW_RESULT_R2.md`（本地证据，未入库） |
| R3 | conditional_pass（R3-1 文档项 + CI） | `review/2026-10-12-desktop-sdk-runtime-fix/REVIEW_RESULT_R3.md`（本地证据，未入库） |

## 遗留 minor / 已披露缺口
R2 原文：F-5（映射/物化无单测）nit open；合并时 CI 未全绿

## 合并后桌面 smoke
无
