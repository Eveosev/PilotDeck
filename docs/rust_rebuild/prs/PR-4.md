# PR #4 · T-P0a-05 S0: Desktop hello Rust / extraResources / PKG-14

- 任务：T-P0a-05
- 链接：https://github.com/Eveosev/PilotDeck/pull/4（head 分支 `pilotdeck-rust/T-P0a-05-desktop-hello`）
- 合并 commit：`64647f5396f3ab34e056c6b2e60690bef2247b78`
- 父提交：主线 `8a6d9b1a`，PR head `a54a0ae2`
- 合并时间：2026-10-12 11:31（Asia/Shanghai）

## 做了什么
Desktop 打包 hello Rust 二进制（extraResources / PKG-14）。（摘自 PR 标题/任务清单；细节以 PR 正文为准）

## 改动模块与路径
按目录占比（`git diff --dirstat=files` 主线父→合并）：
```
   6.6% .github/workflows/
   6.6% apps/desktop/checklists/
   6.6% apps/desktop/resources/rust/
  26.6% apps/desktop/scripts/
  13.3% apps/desktop/
   6.6% crates/pilotdeck-agent-loop-hello/src/
   6.6% crates/pilotdeck-agent-loop-hello/
```
<details><summary>文件清单（git diff --stat）</summary>

```
 .github/workflows/rust-hello.yml                   |  47 ++++++++++++++++++++++++++++++++
 .gitignore                                         |   5 ++++
 Cargo.lock                                         | 105 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 Cargo.toml                                         |   3 +++
 apps/desktop/README.md                             |  30 +++++++++++++++++++++
 apps/desktop/checklists/PKG.md                     |  41 ++++++++++++++++++++++++++++
 apps/desktop/package.json                          |  10 +++++++
 apps/desktop/resources/rust/.gitkeep               |   0
 apps/desktop/scripts/build-runtime.mjs             |   7 +++++
 apps/desktop/scripts/rust-hello-packaging.test.mjs |  29 ++++++++++++++++++++
 apps/desktop/scripts/rust-hello.mjs                |  84 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 apps/desktop/scripts/verify-rust-hello.mjs         | 207 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 crates/pilotdeck-agent-loop-hello/Cargo.toml       |  15 +++++++++++
 crates/pilotdeck-agent-loop-hello/src/main.rs      | 136 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 rust-toolchain.toml                                |   2 ++
 15 files changed, 721 insertions(+)
```
</details>

## 影响面
涉及顶层目录：`.github`、`.gitignore`、`Cargo.lock`、`Cargo.toml`、`apps`、`crates`、`rust-toolchain.toml`。产品代码/仅工具证据的判断：含产品代码（src/、apps/、ui/ 或 crates/）。

> QA / Reviewer 原文路径曾相对本机审阅目录 `/workspace/pilotdeck-rust/`。已按 `1d7c8068` 核对：仓库中存在的改为相对链接；不存在的保留原文并标「本地证据，未入库」。标「原始文件不在本机，待补」的行不补结论。

## 结论（据本地证据整理）

**QA**
- `3f53c5ad`：**PASS**。A1 cargo release、A2 `--rust-only`、A4 verify（hello→capabilities，transport=stdio）。
- `6304160c`：**PASS**。默认不 opt-in 时跳过 cargo（R1），verify 断言 sidecar exit=0（R3）；rust-hello CI run 38181084640 success（1.83.0）。
- `a54a0ae2`（合并 6304160c + 8a6d9b1a）：**PASS**。14 个文件均在 T-P0a-05 范围内；CI rust-hello success。Linux DEB x64 失败属 R2′ 旧债，不阻塞。
**Reviewer**
- R1（`3f53c5ad`）：**conditional_pass**，3 项 ready 前必修（R1/R2 中、R3 低-中），R4–R10 低/信息。
  - R1：只要 PATH 上有 cargo 就自动 build，波及全平台（Windows `.exe`、arch、mac 签名、离线）→ 改为显式 opt-in，并修 `.exe` 命名，R2 轮关闭。
  - R2：CI 结果缺失，`unstable` 原因不明 → R2 轮只关一半（见 R2′）。
  - R3：verify 不断言 sidecar 干净退出 → 加 `exit.code===0` 断言，R2 轮关闭。
- R2（`6304160c`）：**conditional_pass**，代码层无阻塞；唯一前置 R2′：贴出 check-runs 终态并说明非绿项。
- 合并 head `a54a0ae2` 的 Reviewer 轮：原始文件缺失（本机只有 QA re-gate）。
**遗留**
- R1′：opt-in 后仍只按 host arch 编译，S1/S2 需要 `--target`。
- R5′：PKG-14「随包存在」无 job 覆盖，排到 S3。
- R6：`signIgnore` 断言偏严。
- R7：PKG.md 路径偏差。
- R8：toolchain 1.83.0 需 Arch 书面确认。
- R11：两个 env 等价。
- R12：verify 复用已 staged 的旧二进制。
- R13：rust-hello 没有 push 触发。
- 证据卫生：CLAIMS.md 需刷新。

## QA 结论
| tip | 结论 | 原文 |
|---|---|---|
| `3f53c5ad` | PASS | `review/2026-10-12-T-P0a-05-desktop-hello/evidence/qa-gate-3f53c5ad/SUMMARY.md`（本地证据，未入库） |
| `6304160c` | PASS | `review/2026-10-12-T-P0a-05-desktop-hello/evidence/qa-gate-6304160c/SUMMARY.md`（本地证据，未入库） |
| `a54a0ae2` | PASS | `/workspace/pilotdeck-rust/review/2026-10-12-T-P0a-05-desktop-hello/evidence/qa-gate-a54a0ae2/SUMMARY.md` |

## Reviewer 结论（逐轮）
| 轮次 | 结论 | 原文 |
|---|---|---|
| R1 | conditional_pass | `review/2026-10-12-T-P0a-05-desktop-hello/REVIEW_RESULT.md（抢救稿升格）`（本地证据，未入库） |
| R2 | conditional_pass（R1/R3 已关；R2 只关一半） | `review/2026-10-12-T-P0a-05-desktop-hello/REVIEW_RESULT_R2.md`（本地证据，未入库） |
| 合并 tip a54a0ae2 的 Reviewer | 原始文件不在本机，待补 | — |

## 遗留 minor / 已披露缺口
R2 原文：R2 项只关了一半（详见 R2 原文）

## 合并后桌面 smoke
无
