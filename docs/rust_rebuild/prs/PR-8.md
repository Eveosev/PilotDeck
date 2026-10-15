# PR #8 · T-P1-01 PR-A: Rust agent-loop crate (S0–S2 stdio)

- 任务：T-P1-01 PR-A
- 链接：https://github.com/Eveosev/PilotDeck/pull/8（head 分支 `pilotdeck-rust/T-P1-01-agent-loop-a`）
- 合并 commit：`761572d7ff548eb41f27ebdb9a70faaccc73fdb8`
- 父提交：主线 `2c4420b4`，PR head `e190eda1`
- 合并时间：2026-10-13 09:55（Asia/Shanghai）

## 做了什么
Rust agent-loop crate（S0–S2 stdio）。（摘自 PR 标题/任务清单；细节以 PR 正文为准）

## 改动模块与路径
按目录占比（`git diff --dirstat=files` 主线父→合并）：
```
   3.0% crates/pilotdeck-agent-loop/fixtures/
   3.0% crates/pilotdeck-agent-loop/scripts/
  18.1% crates/pilotdeck-agent-loop/src/
   3.0% crates/pilotdeck-agent-loop/tests/common/
   9.0% crates/pilotdeck-agent-loop/tests/
   3.0% crates/pilotdeck-agent-loop/
  39.3% evidence/t-p1-01/
  15.1% review/2026-10-12-T-P1-01-rust-agent-loop/
```
<details><summary>文件清单（git diff --stat）</summary>

```
 Cargo.lock                                                 |    7 +
 Cargo.toml                                                 |    2 +-
 crates/pilotdeck-agent-loop/Cargo.toml                     |   19 +++
 crates/pilotdeck-agent-loop/fixtures/invalid-messages.json |  125 ++++++++++++++
 crates/pilotdeck-agent-loop/scripts/roundtrip-validate.mjs |  153 +++++++++++++++++
 crates/pilotdeck-agent-loop/src/lib.rs                     |   19 +++
 crates/pilotdeck-agent-loop/src/main.rs                    |    8 +
 crates/pilotdeck-agent-loop/src/protocol.rs                |  613 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 crates/pilotdeck-agent-loop/src/sidecar.rs                 | 1223 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 crates/pilotdeck-agent-loop/src/stdio.rs                   |   51 ++++++
 crates/pilotdeck-agent-loop/src/time.rs                    |  175 +++++++++++++++++++
 crates/pilotdeck-agent-loop/tests/common/mod.rs            |  130 ++++++++++++++
 crates/pilotdeck-agent-loop/tests/lock.rs                  |  109 ++++++++++++
 crates/pilotdeck-agent-loop/tests/roundtrip.rs             |  316 ++++++++++++++++++++++++++++++++++
 crates/pilotdeck-agent-loop/tests/sidecar_stdio.rs         |  273 ++++++++++++++++++++++++++++++
 evidence/t-p1-01/base-contrast.json                        |   17 ++
 evidence/t-p1-01/base-lock.txt                             |    2 +
 evidence/t-p1-01/cargo-clippy.txt                          |    8 +
 evidence/t-p1-01/cargo-test-1.txt                          |   82 +++++++++
 evidence/t-p1-01/cargo-test-2.txt                          |   81 +++++++++
 evidence/t-p1-01/cargo-test.json                           |   17 ++
 evidence/t-p1-01/emitted-messages.json                     |  312 ++++++++++++++++++++++++++++++++++
 evidence/t-p1-01/invalid-roundtrip.json                    |  274 ++++++++++++++++++++++++++++++
 evidence/t-p1-01/mutation-first-wins.txt                   |   23 +++
 evidence/t-p1-01/provenance.json                           |   33 ++++
 evidence/t-p1-01/report.md                                 |   64 +++++++
 evidence/t-p1-01/roundtrip.json                            |  209 +++++++++++++++++++++++
 evidence/t-p1-01/rust-decisions.json                       |  106 ++++++++++++
 review/2026-10-12-T-P1-01-rust-agent-loop/DECISION.md      |   60 +++++++
 review/2026-10-12-T-P1-01-rust-agent-loop/PROGRESS.md      |  220 ++++++++++++++++++++++++
 review/2026-10-12-T-P1-01-rust-agent-loop/QA-ACCEPTANCE.md |   19 +++
 review/2026-10-12-T-P1-01-rust-agent-loop/REVIEW_RESULT.md |  163 ++++++++++++++++++
 review/2026-10-12-T-P1-01-rust-agent-loop/mask_f3.sh       |  180 ++++++++++++++++++++
 33 files changed, 5092 insertions(+), 1 deletion(-)
```
</details>

## 影响面
涉及顶层目录：`Cargo.lock`、`Cargo.toml`、`crates`、`evidence`、`review`。产品代码/仅工具证据的判断：含产品代码（src/、apps/、ui/ 或 crates/）。

> 原文路径相对本机审阅目录 `/workspace/pilotdeck-rust/`（部分目录也随 PR 入库到仓库 `review/`）；入库前需核对仓库内是否存在。

## QA 结论
| tip | 结论 | 原文 |
|---|---|---|
| `5ea8d3ce` | PASS（2 个覆盖缺口给 Reviewer） | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-5ea8d3ce/SUMMARY.md` |
| `804b9ed5` | PASS | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-804b9ed5/SUMMARY.md` |
| `846402ac` | CONDITIONAL PASS | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-846402ac/SUMMARY.md` |
| `fce2463c` | PASS | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-fce2463c/SUMMARY.md` |
| `16b274aa` | PASS | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-16b274aa/SUMMARY.md` |
| `d43acb9e` | PASS | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-d43acb9e/SUMMARY.md` |
| `82b5644d` | PASS（CI web 失败未关） | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-82b5644d/SUMMARY.md` |
| `e190eda1` | merge gate PASS | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-e190eda1/SUMMARY.md` |

## Reviewer 结论（逐轮）
| 轮次 | 结论 | 原文 |
|---|---|---|
| R1 | fail | `review/2026-10-12-T-P1-01-rust-agent-loop/REVIEW_RESULT.md` |
| R2 | 原始文件不在本机，待补 | REVIEW_RESULT_R2.md（R2b 原文引用） |
| R2b | pass | `review/2026-10-12-T-P1-01-rust-agent-loop/REVIEW_RESULT_R2b.md` |

## 遗留 minor / 已披露缺口
待补

## 合并后桌面 smoke
无
