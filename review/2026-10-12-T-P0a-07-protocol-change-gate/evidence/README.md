# T-P0a-07 空跑证据

- 任务：T-P0a-07（文档 + 两次本地空跑；**不推送**空跑分支；**无 `src/` 进入本 PR**）
- 门禁：[`evidence/protocol-sync-gate.md`](../../../evidence/protocol-sync-gate.md)
- 基线：`rust_standalone_alpha1@1da663a2`
- 空跑分支只存在于本机：`tmp/T-P0a-07-dry-g2`、`tmp/T-P0a-07-dry-g3`（未 `git push`）
- 原始审阅：[`../REVIEW_RESULT.md`](../REVIEW_RESULT.md)、[`../REVIEW_RESULT_R2.md`](../REVIEW_RESULT_R2.md)

## 子目录 → 采集 SHA（R2-3）

| 子目录 | 采集 `gitSha` | dirty | 说明 |
| --- | --- | --- | --- |
| `baseline/` | `6be324cd3ce5f7248cc3952a33b9ca04fe7e1242` | false | 文档空跑（无协议改动） |
| `dry-run-g2/` | protocol `f019dca634ab8b12419d3f8c18cea9dfbbd71a7f`；schema `6f37ee7751b43f0fe92b189a300a2a9bd0db8f04` | false | 临时分支 `tmp/T-P0a-07-dry-g2`，**未推送** |
| `dry-run-g3/` | `b052c7318edd7a31ce9647587a80d43a4b5845cd` | false | 临时分支 `tmp/T-P0a-07-dry-g3`，**未推送** |
| `r1-verbatim/` | `d84f3e8cbd6d01eda5574ef371c7da540259e2ff` | false | R1 原文连跑 |
| `r2-verbatim/` | `8004fb21598abccd5ad7bcae5c7d62ecc58c1458` | false | R2 原文连跑 |
| `r3-verbatim/` | `14b1a71ee8a63371c79a830f656482657e2a25a6` | false | R3 原文连跑（`bash -e`） |

`git ls-remote --heads origin 'tmp/T-P0a-07*'` 为空。临时分支 **not pushed**。

## 本 PR 树空跑（无协议改动）

目录：`baseline/`。采集树：`6be324cd3ce5f7248cc3952a33b9ca04fe7e1242`。

| # | 检查 | 结果 | 日志 |
| --- | --- | --- | --- |
| 1a | builder vs 磁盘 schema | **PASS schema-current** exit 0 | `baseline/check1a.txt` |
| 1c | 二次生成空 diff | generate exit 0；`git diff --exit-code` 0 | `baseline/generate-1.txt` |
| 2 | replay 可表达错配 | exit 0；`expressibleMismatches=0` | `baseline/replay.stdout.txt` |
| 3 | A3 + 放宽对照 | `allRejectedByBoth=true`；`loosened=FAIL` | 同上 |
| 4 | live parity 53 | **N/A**（本 PR 不改运行时协议；口径同 PR#5 合成模板） | — |
| 5 | `cargo test --workspace` | exit 0；0 tests（hello crate，T-P1-01 前 N/A） | `baseline/cargo-test.txt` |
| 6 | 版本评估 | 不升级（无契约变化） | — |
| 7 | gitSha / gitDirty | replay 记录 `gitSha=6be324cd…`，`gitDirty=false` | `baseline/replay.stdout.txt` |

Replay 会改写 `evidence/schema/replay-report.*`。空跑后已 `git checkout --` 恢复 T-P0a-01 报告，避免把 PR#5 的 provenance 冲掉。

### F-3 更正（baseline provenance）

`baseline/provenance.txt` 曾误写 `check1a_exit=1` / `generate1_exit=1`（采集时 `$?` 吃到缺 ajv 的第一次 pipe）。同目录 `check1a.txt` = `PASS schema-current`，`generate-1.txt` = 成功 generate，QA 复跑也是 0/0。已改正为 **0/0**，并拆成 `baseline/check1a.exit.txt`、`baseline/generate1.exit.txt`（`key=0`）。

## G2：改 `protocol.ts` 可抽取契约（必须抓住）

本地分支 `tmp/T-P0a-07-dry-g2`（**未推送**）。

改动：`MODULE_CALL_TARGETS` + `ModuleCallRequest.module` 增加 `"notes"`。  
提交：`f019dca634ab8b12419d3f8c18cea9dfbbd71a7f`。  
Diff：`dry-run-g2/protocol.diff`。

| # | 检查 | 结果 | 日志 |
| --- | --- | --- | --- |
| 1a 重生前 | builder vs 磁盘 | **FAIL schema-stale** exit 1 ← **抓住了** | `dry-run-g2/check1a.txt` |
| 1b 第一次生成 | schema diff | 非空：`$defs.moduleCallRequest.properties.module.enum` 增加 `notes` | `dry-run-g2/schema-after-regen.diff` |
| 1c 二次生成 | 提交 schema `6f37ee77` 后再生成 | `git diff --exit-code` 0 | `dry-run-g2/generate-2.txt` / `check1c.exit.txt` |
| 2/3/7 replay | regen 之后 | exit 0；错配 0；`loosened=FAIL`；`gitDirty=false` | `dry-run-g2/replay.stdout.txt` |
| 4 parity | live 53 | **N/A**（只扩展未使用的 enum；合成模板不含 `notes`） | — |
| 5 Rust | `cargo test --workspace` | exit 0；N/A 无 Rust 校验器 | `dry-run-g2/cargo-test.txt` |
| 6 版本 | `MODULE_PROTOCOL_VERSION` 仍 `2.0` | **不升级**：向后兼容地扩展 enum，旧消息 accept 集不变 | `dry-run-g2/version-grep.txt` |

结论：清单在 regen 前抓住可抽取契约变化；regen + 提交 schema 后 replay 通过。

说明：QA 举例「加 optional 字段」。若只改 TypeScript 类型、不改 `MODULE_CALL_TARGETS` / 版本 / `isOutcome` / 锚点，1a **不会** stale（**F-5**）。G2 因此选用生成器实际抽取的 enum。

## G3：只改 validator、不更新 schema（清单必须 FAIL）

本地分支 `tmp/T-P0a-07-dry-g3`（**未推送**）。

改动：`validateModuleMessage` 的 execute 路径新增 `sessionId` 必填。  
提交：`b052c7318edd7a31ce9647587a80d43a4b5845cd`。  
Diff：`dry-run-g3/protocol.diff`。  
**没有**把新 schema 当作通过条件（即使跑 generate，diff 也是空的）。

| # | 检查 | 结果 | 日志 |
| --- | --- | --- | --- |
| 1a | builder vs 磁盘 | **PASS schema-current** exit 0 | `dry-run-g3/check1a.txt` |
| 1b generate | 磁盘 schema | **空 diff** exit 0 | `dry-run-g3/schema-diff.exit.txt` |
| 2 replay | 不采用新 schema | **FAIL** exit 1；`expressibleMismatches=53`（53 条 execute 合成模板 TS reject / schema accept） | `dry-run-g3/replay.stdout.txt` / `replay.stderr.txt` |
| 3 A3 | 负样本仍双方拒 | `allRejectedByBoth=true`；`loosened=FAIL`（本条未救整体） | 同上 |
| 4 parity | live 53 | 未跑。若跑，host execute 无 `sessionId` 会被新 validator 拒，预期失败。 | — |
| 6 版本 | 未评估为通过 | 不兼容必填变化，**本应**升级 `MODULE_PROTOCOL_VERSION`；清单已因检查 2 失败 | — |

结论：

- **清单整体 FAIL**（检查 2），满足 G3。
- 检查 1 **没抓住** 这条 validator 新规则：手写映射没有 `sessionId` required，生成器只抽版本 / `MODULE_CALL_TARGETS` / `isOutcome` + 锚点。记入 **F-5**。漂移靠 replay + 人工审查；日后 CI 应跑 generate+replay，而不是只跑 generate。
- 若新规则打不中现有 20 负样本 / 合成模板，replay 也会漏（**F-5** + **R2-1**）。字段变异实现归 **T-P0a-04**。

## 空跑分支（禁止推送）

```
tmp/T-P0a-07-dry-g2  protocol f019dca634ab8b12419d3f8c18cea9dfbbd71a7f
tmp/T-P0a-07-dry-g2  schema   6f37ee7751b43f0fe92b189a300a2a9bd0db8f04
tmp/T-P0a-07-dry-g3  b052c7318edd7a31ce9647587a80d43a4b5845cd
```

`git ls-remote --heads origin 'tmp/T-P0a-07*'` 为空。

## R1 原文连跑

目录：`r1-verbatim/`。采集 `d84f3e8c`。Node 20 replay exit **9**。旧 2→3→7 连跑第二次 replay exit **2**。

## R2 原文连跑

目录：`r2-verbatim/`。采集 `8004fb21`。1a/1c/replay/2/3/7 全 0。

## R3 原文连跑（`bash -e`）

目录：`r3-verbatim/`。在干净树 `14b1a71e` 上按 CONTRIBUTING 命令块用 **`bash -e`** 连跑 **1a → 1c → 一次 replay+restore（`replay_exit`）→ 2 → 3 → 7**。全文：`r3-verbatim/verbatim-sequence.txt`。

| 步 | exit | 输出要点 |
| --- | --- | --- |
| 1a | **0** | `PASS schema-current` |
| 1c | **0** | generate 0；`git diff --exit-code` 0 |
| replay + restore | **0** / restore **0** | `expressibleMismatches=0`，`loosened=FAIL`；restore 后 porcelain 空 |
| 2 | **0** | `expressibleMismatches 0`；`A1.reproducible True` |
| 3 | **0** | `allRejectedByBoth True`；`loosened FAIL` |
| 7 | **0** | `gitSha 14b1a71e…` == HEAD；`gitDirty False` |
| 整段 `bash -e` | **0** | `verbatim.exit.txt` |

F-7：本 `evidence/` 目录将在后续提交删除；每文件 path / sha256 / collection gitSha 见 [`../PROGRESS.md`](../PROGRESS.md)，原始件作为 PR artifacts。
