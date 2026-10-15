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

> QA / Reviewer 原文路径曾相对本机审阅目录 `/workspace/pilotdeck-rust/`。已按 `1d7c8068` 核对：仓库中存在的改为相对链接；不存在的保留原文并标「本地证据，未入库」。标「原始文件不在本机，待补」的行不补结论。

## 结论（据本地证据整理）

**QA**（验收口径见 QA-ACCEPTANCE.md：B1–B7；PR-A=S0–S2，PR-B=S3–S4）
- `5ea8d3ce`：**PASS**。cargo test 26 个、clippy 0；round-trip 19 条 0 mismatch；8 个变异全部 exit 101。另报 2 个覆盖缺口给 Reviewer：无效样本没有 TS 对照；B4 没有 TS host。
- `804b9ed5`：**PASS**。30/0；invalid 20 条三方都拒、emitted 19 条都收；变异全部 101。B4 延到 PR-B。
- `846402ac`：**CONDITIONAL PASS**。F-1/F-2/F-6/F-9 的变异都是 101；F-3 再生成不能逐字节一致；F-12 provenance 写 1.83.0 与实测 1.85.1 不符，属文案问题。
- `82b5644d`（同步 M=`7d488a1b`）：**PASS**（附 mask_f3 范围说明），32/0；web 红在合并前就存在。
- `fce2463c`（F-4）：**PASS**，35/0。F4a/F4b 变异 101；F-5 未动。
- `16b274aa`（content tip）：**PASS**，38/0。S1/S2/S3/F4a/F4b 全部 101。
- `d43acb9e`：补验 **PASS**。crates/ 空 diff，provenance 一致。
- `e190eda1`（同步 M=`2c4420b4`）：**merge gate PASS**。
**Reviewer**
- R1（`804b9ed5`）：**fail**，1 blocker / 4 major / 7 minor。
  - F-1 blocker：cancel ≤2s 的锁定无效，sleep_cancellable 类变异能存活 → 只改测试（delay 10s，断言 sequence==0），`846402ac` 上 M7a/b/c 均为 101。
  - F-2 major：非 UTF-8 帧会让 sidecar exit 1 → 改为回 INVALID_JSON 并继续服务，变异 101。
  - F-3 major：emitted 证据不能用仓内测试复现，completed 路径没覆盖 → 改由测试再生成，覆盖 completed；字节级确定性按 QA PARTIAL 处理。
  - F-4 major：没有运行期 deadline，ISO 解析过窄 → 在 `fce2463c` 补上，变异 101。
  - F-5 major（前瞻）：stub 的 final payload 不能被 TS host 消费 → 按 DECISION 延到 PR-B（B4 前置）。
- R2：原始文件缺失。R2b 原文写明挡 ready 的两个 major 是 R2-1（future/attempt/min 只锁了单侧）和 R2-2（仓内 evidence 过期）。
- R2b（`d43acb9e` / content `16b274aa`）：**pass**，建议 ready。R2-1、R2-2 关闭；新增 R2b-1 minor 和 R2b-2…5 nit。
**遗留**
- F-5 → PR-B（#18），作为 B4 前置必过项。
- R2b-1：反方向的 earliest-deadline 测试 → PR-B 或 ready 前。
- R2-3（`parse_iso_ms` 边角）、R2-4（R1 F-7 码级比较）、R2-5（`mask_f3.sh` 默认对照）→ PR-B/S3。
- F-10：TCP 多连接竞态和 delayMs 上限 → PR-B。
- F-9 已修；web 红为基线遗留。

## QA 结论
| tip | 结论 | 原文 |
|---|---|---|
| `5ea8d3ce` | PASS（2 个覆盖缺口给 Reviewer） | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-5ea8d3ce/SUMMARY.md`（本地证据，未入库） |
| `804b9ed5` | PASS | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-804b9ed5/SUMMARY.md`（本地证据，未入库） |
| `846402ac` | CONDITIONAL PASS | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-846402ac/SUMMARY.md`（本地证据，未入库） |
| `fce2463c` | PASS | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-fce2463c/SUMMARY.md`（本地证据，未入库） |
| `16b274aa` | PASS | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-16b274aa/SUMMARY.md`（本地证据，未入库） |
| `d43acb9e` | PASS | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-d43acb9e/SUMMARY.md`（本地证据，未入库） |
| `82b5644d` | PASS（CI web 失败未关） | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-82b5644d/SUMMARY.md`（本地证据，未入库） |
| `e190eda1` | merge gate PASS | `review/2026-10-12-T-P1-01-rust-agent-loop/qa-gate-e190eda1/SUMMARY.md`（本地证据，未入库） |

## Reviewer 结论（逐轮）
| 轮次 | 结论 | 原文 |
|---|---|---|
| R1 | fail | [review/2026-10-12-T-P1-01-rust-agent-loop/REVIEW_RESULT.md](../../../review/2026-10-12-T-P1-01-rust-agent-loop/REVIEW_RESULT.md) |
| R2 | 原始文件不在本机，待补 | REVIEW_RESULT_R2.md（R2b 原文引用） |
| R2b | pass | `review/2026-10-12-T-P1-01-rust-agent-loop/REVIEW_RESULT_R2b.md`（本地证据，未入库） |

## 遗留 minor / 已披露缺口
待补

## 合并后桌面 smoke
无
