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

> QA / Reviewer 原文路径曾相对本机审阅目录 `/workspace/pilotdeck-rust/`。已按 `1d7c8068` 核对：仓库中存在的改为相对链接；不存在的保留原文并标「本地证据，未入库」。标「原始文件不在本机，待补」的行不补结论。

## 结论（据本地证据整理）

**QA**
- `8d36b967`（base `1da663a2`）：**PASS**（G1–G4）。
  - diff 只有 `MainAreaV2.tsx` 新增 1 行，内容与 `f2b0ac60` 的同一行一致。
  - `MainAreaV2.test.tsx:131` 在 base 上 FAIL、在 PR 上 PASS；删掉这行后又 FAIL。
  - 参考 e2e：`:237` 通过，随后在 `:251` 失败（新的下游失败）。
  - CI：Desktop 和 web 红。其中 DEB x64 的失败是 runtime 依赖不同步（base 漂移，由 #6 修复），与这一行无关。
**Reviewer**
- 所有轮次：原始文件缺失。
**遗留**
- `:251` 失败转由 #10 处理（e2e 缺 `/api/modules/runtime` mock）。

## QA 结论
| tip | 结论 | 原文 |
|---|---|---|
| `8d36b967` | G1/G2 PASS | `review/2026-10-12-desktop-no-drag-h1/qa-gate-8d36b967/SUMMARY.md`（本地证据，未入库） |

## Reviewer 结论（逐轮）
| 轮次 | 结论 | 原文 |
|---|---|---|
| 全部轮次 | 原始文件不在本机，待补 | — |

## 遗留 minor / 已披露缺口
待补

## 合并后桌面 smoke
无
