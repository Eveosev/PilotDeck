# T-P0a-07 空跑证据

- 任务：T-P0a-07（文档 + 空跑；**不推送**空跑分支；**无 `src/` 进入本 PR**）
- 门禁：[`evidence/protocol-sync-gate.md`](../../../evidence/protocol-sync-gate.md)
- R2 采集树：文档 tip `8004fb21598abccd5ad7bcae5c7d62ecc58c1458`
- **`gitSha`**: `8004fb21598abccd5ad7bcae5c7d62ecc58c1458`
- **`gitDirty`**: `false`（采集开始时 `git status --porcelain` 为空；本目录是之后单独证据提交）
- 基线：`rust_standalone_alpha1@1da663a2`
- 原始审阅：[`../REVIEW_RESULT.md`](../REVIEW_RESULT.md)（F 项 L48–104）

## F-3 更正（baseline provenance）

`baseline/provenance.txt` 曾误写 `check1a_exit=1` / `generate1_exit=1`（采集时 `$?` 吃到缺 ajv 的第一次 pipe）。同目录 `check1a.txt` = `PASS schema-current`，`generate-1.txt` = 成功 generate，QA 复跑也是 0/0。

已改正为 **0/0**，并拆成与 g2/g3 一致的 `baseline/check1a.exit.txt`、`baseline/generate1.exit.txt`（`key=0`）。

## R2 原文连跑（F-1 回归）

目录：`r2-verbatim/`。在干净树 `8004fb21` 上按 CONTRIBUTING 命令块连跑 **1a → 1c → 一次 replay+restore → 2 → 3 → 7**。全文：`r2-verbatim/verbatim-sequence.txt`。

| 步 | exit | 输出要点 |
| --- | --- | --- |
| 1a | **0** | `PASS schema-current` |
| 1c | **0** | generate 0；`git diff --exit-code` 0 |
| replay + restore | **0** / restore **0** | `expressibleMismatches=0`，`loosened=FAIL`；restore 后 porcelain 空 |
| 2 | **0** | `expressibleMismatches 0`；`A1.reproducible True` |
| 3 | **0** | `allRejectedByBoth True`；`loosened FAIL` |
| 7 | **0** | `gitSha 8004fb21…` == HEAD；`gitDirty False` |

## R1 / G2 / G3

- R1 连跑与 Node 20 exit 9：`r1-verbatim/`
- G2 / G3 空跑：`dry-run-g2/`、`dry-run-g3/`（临时分支未推送）
