# PR #9 · fix(desktop): restore data-desktop-no-drag on session title h1

- 任务：—（desktop fix）
- 链接：https://github.com/Eveosev/PilotDeck/pull/9（head 分支 `pilotdeck-rust/desktop-no-drag-h1`）
- 合并 commit：`7d488a1b5607df51b91b3b0a596298d633638cc2`
- 父提交：主线 `1da663a2`，PR head `8d36b967`
- 合并时间：2026-10-12 22:04（Asia/Shanghai）

## 做了什么
会话标题 h1 恢复 data-desktop-no-drag。（摘自 PR 标题/任务清单；细节以 PR 正文为准）

## 改动模块与路径
按目录占比（`git diff --dirstat=files` 主线父→合并）：
```
 100.0% ui/src/components/app-shell/
```
<details><summary>文件清单（git diff --stat）</summary>

```
 ui/src/components/app-shell/MainAreaV2.tsx | 1 +
 1 file changed, 1 insertion(+)
```
</details>

## 影响面
涉及顶层目录：`ui`。产品代码/仅工具证据的判断：含产品代码（src/、apps/、ui/ 或 crates/）。

> 原文路径相对本机审阅目录 `/workspace/pilotdeck-rust/`（部分目录也随 PR 入库到仓库 `review/`）；入库前需核对仓库内是否存在。

## QA 结论
| tip | 结论 | 原文 |
|---|---|---|
| `8d36b967` | G1/G2 PASS | `review/2026-10-12-desktop-no-drag-h1/qa-gate-8d36b967/SUMMARY.md` |

## Reviewer 结论（逐轮）
| 轮次 | 结论 | 原文 |
|---|---|---|
| 全部轮次 | 原始文件不在本机，待补 | — |

## 遗留 minor / 已披露缺口
待补

## 合并后桌面 smoke
无
