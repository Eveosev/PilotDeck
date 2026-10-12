# T-P0a-07 空跑证据

- 任务：T-P0a-07（文档 + 空跑；**不推送**空跑分支；**无 `src/` 进入本 PR**）
- 门禁：[`evidence/protocol-sync-gate.md`](../../../evidence/protocol-sync-gate.md)
- R1 采集树：文档 tip `d84f3e8cbd6d01eda5574ef371c7da540259e2ff`
- **`gitSha`**: `d84f3e8cbd6d01eda5574ef371c7da540259e2ff`
- **`gitDirty`**: `false`（采集开始时 `git status --porcelain` 为空；本目录是之后单独证据提交）
- 基线：`rust_standalone_alpha1@1da663a2`

## R1 原文连跑（F-1 验证）

目录：`r1-verbatim/`。在干净树 `d84f3e8c` 上按 CONTRIBUTING 命令块连跑 **1a → 1c → 一次 replay+restore → 2 → 3 → 7**。

| 步 | exit | 输出要点 |
| --- | --- | --- |
| 1a | **0** | `PASS schema-current` |
| 1c | **0** | generate 0；`git diff --exit-code` 0 |
| replay + restore | **0** / restore **0** | stdout `expressibleMismatches=0`，`loosened=FAIL`；restore 后 porcelain 空 |
| 2 | **0** | `expressibleMismatches 0`；`A1.reproducible True` |
| 3 | **0** | `allRejectedByBoth True`；`loosened FAIL` |
| 7 | **0** | `gitSha d84f3e8c…` == HEAD；`gitDirty False` |
| 终态树 | 空 | 跟踪的 `replay-report.*` 已 restore，未留下脏文件 |

对照（旧顺序，**不要**当通过步骤）：连续两次 replay、中间不 restore → 第一次改写跟踪报告，**第二次 exit 2**。见 `r1-verbatim/old-sequence-dirty.txt`。原文连跑全文：`r1-verbatim/verbatim-sequence.txt`。

Node 20：`node scripts/replay-module-protocol-schema.mjs` → **exit 9**（`bad option: --experimental-strip-types`）。见 `r1-verbatim/node20-replay.exit.txt`。

检查 4 live parity：本 PR 无运行时协议改动，N/A。检查 5：`cargo test --workspace` exit 0（0 tests，T-P1-01 前 N/A）。检查 6：不升级。

## G2 / G3（首轮，仍有效）

见 `dry-run-g2/`、`dry-run-g3/`。临时分支未推送。

- G2：可抽取 enum `"notes"` → 1a **FAIL schema-stale**；regen 后 replay PASS。
- G3：validator 必填 `sessionId`、不更新 schema → 1a PASS（局限 F-5）；replay **FAIL** 53 错配。
