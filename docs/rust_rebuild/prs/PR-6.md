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

> 原文路径相对本机审阅目录 `/workspace/pilotdeck-rust/`（部分目录也随 PR 入库到仓库 `review/`）；入库前需核对仓库内是否存在。

## QA 结论
| tip | 结论 | 原文 |
|---|---|---|
| `524cb673` | GATE PASS (code) | `review/2026-10-12-desktop-sdk-runtime-fix/qa-gate-524cb673/SUMMARY.md` |
| `46ca9718` | PASS | `review/2026-10-12-desktop-sdk-runtime-fix/qa-gate-46ca9718/SUMMARY.md` |
| `c1eab0d5` | PASS | `review/2026-10-12-desktop-sdk-runtime-fix/qa-gate-c1eab0d5/SUMMARY.md` |
| `918594b1` | merge gate PASS；CI 未全绿 | `review/2026-10-12-desktop-sdk-runtime-fix/qa-gate-918594b1/SUMMARY.md` |
| `12395bbe` | merge gate PASS；CI 未全绿（仅 CI-3） | `review/2026-10-12-desktop-sdk-runtime-fix/qa-gate-12395bbe/SUMMARY.md` |

## Reviewer 结论（逐轮）
| 轮次 | 结论 | 原文 |
|---|---|---|
| R1 | conditionally yes（条件：Desktop dist / rust-hello CI 绿） | `review/2026-10-12-desktop-sdk-runtime-fix/REVIEW_RESULT.md` |
| R2 | conditional_pass | `review/2026-10-12-desktop-sdk-runtime-fix/REVIEW_RESULT_R2.md` |
| R3 | conditional_pass（R3-1 文档项 + CI） | `review/2026-10-12-desktop-sdk-runtime-fix/REVIEW_RESULT_R3.md` |

## 遗留 minor / 已披露缺口
R2 原文：F-5（映射/物化无单测）nit open；合并时 CI 未全绿

## 合并后桌面 smoke
无
