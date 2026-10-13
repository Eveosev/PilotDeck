# T-P0a-07 Round-1 审阅结果 · PR #7 @ `3b5cf763`

- PR：Eveosev/PilotDeck #7（draft）→ `rust_standalone_alpha1@1da663a2`
- 提交：`6be324cd`（gate doc）→ `3b5cf763`（dry-run 证据）
- 审阅人：本机 Claude Code（独立、只读）。已 `git fetch https://github.com/Eveosev/PilotDeck.git pull/7/head`，FETCH_HEAD = `3b5cf7636e54d71f755659e0c7e2c9d615819924`，与 `PR.diff` / QA provenance 一致。
- 核对对象：`evidence/protocol-sync-gate.md` 对照 `3b5cf763` 下的 `scripts/generate-module-protocol-schema.mjs`、`scripts/replay-module-protocol-schema.mjs`、`scripts/lib/module-protocol-schema.mjs`、`tools/agent-loop-parity/run.py`，以及 `1da663a2:evidence/schema/replay-report.json`（PR#5 演练数字）。
- 本审阅没有在 PR 树上重跑脚本（只允许写本文件，不建 worktree）。运行结论引用 QA `qa-gate-3b5cf763/` 和 PR 自带证据，行为结论来自读源码。

## TL;DR

**conditional_pass**。文档门禁的设计是对的：replay 是必过项，兜住了 F-5，G3 空跑实证 1a 漏报而 replay 以 exit 1 / 53 错配抓到；局限 F-5 / R2-1 / R2-3 写明且有归属；范围只有文档。没有 blocker。有 2 个 major 要在 ready 前修：

1. replay 每次运行都会改写已跟踪的 `replay-report.*`。按文档顺序照抄执行 2 → 3 → 7，第二次 replay 起会被自身的脏树检查以 exit 2 拒绝。
2. 门禁触发范围只写了 `protocol.ts`，漏了手写映射 `scripts/lib/module-protocol-schema.mjs` 和 replay 语料源。F-5 的漂移恰恰发生在这些文件里。

另有 4 个 minor（其中之一：baseline provenance 文件与日志自相矛盾）和若干 nit。QA 提到的「1a 片段缺 `--experimental-strip-types`」核实为**不是问题**：1a 不加载 TS。

## Verdict

**conditional_pass**。修完 F-1、F-2（文档改动，预计 < 0.5 h）后即可转 ready。F-3 到 F-6 建议同轮顺手修，不阻塞。

## G1–G7 验收表

| G | 判定 | 依据 |
| --- | --- | --- |
| G1 每项有命令 / 期望 exit / 证据路径 | **PASS（附 F-1、F-4、F-5）** | 前置与 1a/1b/1c/2/3/4/5/6/7 都有三要素（gate doc :22-261）。可照抄性：1a 不需要 strip-types（lib 只 `readFileSync` protocol.ts，导入只有 node 内置模块与 ajv，`scripts/lib/module-protocol-schema.mjs:5-10,44-45`），所以 node20 / node22 都能跑；replay 会用 `--experimental-strip-types` 自我重启（`replay-module-protocol-schema.mjs:33-40`），node20 上会以 exit 9 失败（见 F-4）。2 → 3 → 7 顺序照抄会撞上 exit 2（见 F-1）。 |
| G2 schema 过期必须抓住 | **PASS** | QA g2：1a `FAIL schema-stale` exit 1；regen1 diff 加入 `notes`（14 行）；regen2 diff 空（`g2/regen2.diff` 0 字节）；1a after PASS exit 0；replay exit 0、`expressibleMismatches=0`、`loosened=FAIL`；脏树 generate exit 2。PR 自带 `dry-run-g2/` 结果相同。QA 示例「加 optional 字段」按 F-5 不会被抓到，Arch 改用实际抽取的 enum 并写明原因（evidence README :48），可以接受。 |
| G3 只改 validator → 清单必须 FAIL | **PASS** | QA g3 与 Arch dry-run-g3 是两次独立复现（protocol.diff blob 分别为 `7f8ba9a5`、`8363576a`）：1a PASS（F-5 漏报），schema diff 空，replay exit 1，stderr `T-P0a-01 acceptance failed`，`decisions 595/53`，`expressibleMismatches=53`。gate doc 把 replay exit 0 设为必过（:114-120），并明说 1a「不能单靠本条放行」（:72）。replay 的失败条件涵盖 A1-A4 全部子项（`replay-…mjs` 末尾 `failed = !( … )`），所以兜底成立。附带条件：只有新规则命中合成模板或负样本时才兜得住，这一点已作为 F-5 + R2-1 写明（evidence README :72）。 |
| G4 F-5 / R2-1 / R2-3 写明 + 归属 | **PASS** | 已知局限表（gate doc :265-271）：F-5 归本文档口径 + 日后 CI（T-P0a-04），R2-1 归 T-P0a-04，R2-3 归本文档 / 另切片。核实 R2-3 措辞残留确实存在：`scripts/lib/module-protocol-schema.mjs:204` 仍写 `"Generated from src/agent/modules/protocol.ts validateModuleMessage only."`。F-5 中「只抽取版本常量 / `MODULE_CALL_TARGETS` / `isOutcome` + 锚点」的描述与 `extractProtocolContract`（lib :73-150）一致。 |
| G5 R2-1 字段变异出范围并引用 | **PASS** | gate doc :270、:273-275；CONTRIBUTING :25-26。与 DECISION 第 5 条（Payne 20:23 锁定）一致。 |
| G6 CONTRIBUTING 片段 | **PASS（附 nit F-9）** | CONTRIBUTING :7-8 链接 gate doc，7 条摘要与 gate doc 1-7 一一对应，结尾明确「Path-triggered CI … not enabled yet」（:28）。片段里没有可复制命令。QA-ACCEPTANCE G6 写的是「commands copy-paste runnable」，命令放在 gate doc 里、CONTRIBUTING 只做索引，本审阅认为**足够**（避免两处命令漂移），但建议补一行最小三命令（F-9）。 |
| G7 仅文档 | **PASS** | `git diff --name-only 1da663a2 3b5cf763` 共 48 个文件，全部属于 `CONTRIBUTING.md`、`README(.zh).md`、`evidence/**`、`review/**`；无 `src/`、`.github/`、`crates/`、`package*.json`、lock。与 `g7-diffstat.txt`（681+/2-）一致。 |

## Diff 要点

- **新增 `evidence/protocol-sync-gate.md`（311 行）**：「同步不冻结」原则、适用范围表、干净树前置、检查 1a/1b/1c/2-7（每项含命令 + 期望表 + 证据路径）、已知局限表、PR#5 回溯演练、本 PR 空跑说明。
- **新增 `CONTRIBUTING.md`（28 行）**：Fork 流程、7 条摘要、F-5/R2-1 口径、CI 未启用。
- `README.md` / `README.zh.md` 各改 1 行，指向 CONTRIBUTING 与 gate doc。`evidence/schema/README.md` 加 2 行链接。
- `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/`：baseline / dry-run-g2 / dry-run-g3 日志、`provenance.json`、README。
- **PR#5 演练数字已逐项核对**，与 `1da663a2:evidence/schema/replay-report.json` 一致：`gitSha=b328626a…`、`gitDirty=false`；`A1.fileMatchesBuilder` / `secondGenerationDiffEmpty` / `dirtyTreeRefused` 均为 true；20 个负样本；26 个边角样本，其中 9 个期望 reject；三条条件规则 `fail=true`；A2 648 条、648/0；后续证据提交 `34767840` 在 base 历史中存在。
- **报告字段名已核对**：gate doc 引用的 `A1.secondGenerationDiffEmpty`、`A3.missingMessageTypes`、`A3.missingConditionals`、`A3.edgesMatchExpect` 均存在于 replay 写出的 JSON（replay script `a1` / `a3` 对象）。stdout 中的 `A1.ok`、`A3.loosened` 也与脚本一致。
- **check 4 已核对**：runner 参数 `--pilotdeck-root/--comparison same-version/--surface gateway/--scenario all/--output`，summary 键 `scenarios`/`gateScenarioCount`，exit 语义 1 = failed/oracle、2 = blocked，均与 `tools/agent-loop-parity/run.py:711-718,885-916` 一致。
- **v2 profile 说法已核对**：generator 只写 `SCHEMA_PATH`（`evidence/schema/module-protocol.schema.json`），`docs/pilotdeck-module-protocol-v2.schema.json` 不被覆盖，与 gate doc :42、:105 一致。
- **CI 表述**：gate doc :9、CONTRIBUTING :28、`evidence/schema/README.md`「No CI gate」三处一致，没有暗示 CI 已存在的误导表述。

## Findings

### F-1 · major · replay 改写已跟踪报告，2 → 3 → 7 照抄执行会在第二次 replay 时 exit 2

- 证据：
  - `scripts/replay-module-protocol-schema.mjs`：`gitDirty()` 即 `git status --porcelain !== ""`（`scripts/lib/module-protocol-schema.mjs:33-35`），在开头检查，脏则 exit 2。随后**无论成败**都先 `writeFileSync(reportJsonPath)` / `writeFileSync(reportMdPath)`，再判定 `failed`。报告内含 `gitSha`，所以任何新提交上第一次 replay 之后，已跟踪的 `evidence/schema/replay-report.{json,md}` 必然变成 M。
  - QA `qa-gate-3b5cf763/g2/gen-dirty.log:3-4` 列出 ` M evidence/schema/replay-report.json` / `.md`，佐证这一现象。Arch 自己空跑后也要 `git checkout --` 恢复（evidence README :26）。
  - gate doc :112（检查 2 跑 replay）→ :135-138（检查 3「然后重跑检查 2 的同一条命令」）→ :246-251（检查 7 先 `git status --porcelain` 再跑 replay）。照抄执行时，检查 3 和检查 7 的 replay 会以 exit 2 失败，检查 7 的 porcelain 前置也不为空。G3 场景下 replay exit 1 同样会留下脏报告，修完后重跑会先撞 exit 2。
  - 检查 3 要求先改 fixtures，但没写「改完先提交」，未提交的 fixture 改动同样会触发 exit 2。
- 影响：G1「命令可照抄执行」不成立；日后 CI 若照此文档串联，也会踩坑。
- 建议（纯文档）：
  1. 写明「一次 replay 同时满足检查 2/3/7」，检查 3/7 改为「读同一次 replay 的输出 / 报告」，不要重跑；
  2. 若必须重跑，先 `git checkout -- evidence/schema/replay-report.json evidence/schema/replay-report.md`（或先把报告作为证据提交）；
  3. 检查 3 加一句「fixtures 改动先提交，再跑 replay」；
  4. 失败表补一句「exit 1 也会改写报告，重跑前先恢复」。

### F-2 · major · 门禁触发范围只写 `protocol.ts`，漏了手写映射与 replay 语料源

- 证据：gate doc :7（触发）、适用范围表 :13-18（:16 只列 `evidence/schema/**` / fixtures / 本文件）；CONTRIBUTING :7；README.md / README.zh.md 各 1 行；`evidence/schema/README.md` +2 行。
- 问题：F-5 的本质是 schema 结构手写在 `scripts/lib/module-protocol-schema.mjs`（gate doc 自己在 :269 这样写）。只改 lib 映射（例如放宽某个 `$defs`）、改 `scripts/replay-module-protocol-schema.mjs` 的判定、改 `tools/agent-loop-parity/run.py` 的 `REQUIRED_GATEWAY_SCENARIOS` 或 `tools/agent-loop-parity/scenarios.json`（replay 语料来源，lib :415-431），都不触及 `protocol.ts`，按现在的表格不走门禁。「禁止放宽 schema 来消零」（:124）对这类 PR 没有约束力。下一步 Payne 开绿灯的路径触发 CI 会以本文档为准，漏掉的路径会直接变成 CI 盲区。
- 建议：适用范围表加一行：`scripts/lib/module-protocol-schema.mjs`、`scripts/{generate,replay}-module-protocol-schema.mjs`、`evidence/schema/fixtures/**`、`tools/agent-loop-parity/{run.py,scenarios.json}` → 走检查 1-3、7（可免 4/5/6）。CONTRIBUTING / README 的「touch protocol.ts」表述同步扩充，或改为「见 gate doc 适用范围」。

### F-3 · minor · baseline `provenance.txt` 的 exit 码与日志、README 自相矛盾

- 证据：`review/…/evidence/baseline/provenance.txt:3-4` 写 `check1a_exit=1`、`generate1_exit=1`；同目录 `check1a.txt` 为 `PASS schema-current`，`generate-1.txt` 为成功输出；evidence README :17-18 写 1a exit 0、generate exit 0。QA 独立复跑 baseline 为 `check1a.exit=0`、`gen1.exit=0`（`qa-gate-3b5cf763/baseline/`）。
- 影响：实质结论不受影响（QA 已复现 0/0），但这是一个以「证据完整性」为第 7 条规则的门禁 PR，自带的 provenance 文件写错，会误导事后审计。
- 建议：改正为 0/0，或删除该文件、拆成与 g2/g3 一致的单独 `*.exit.txt`；同时检查采集脚本，确认 `$?` 取的是正确的命令。

### F-4 · minor · 未写 Node 版本前置；replay 在 node20 上 exit 9，不在文档的 exit 码表里

- 证据：replay 自我重启时加 `--experimental-strip-types` 并 `process.exit(replayed.status ?? 1)`（`replay-module-protocol-schema.mjs:33-40`），node20 不认识这个 flag，会以 exit 9 失败。gate doc 只在检查 4 写了 `nvm use 22`（:158），前置章节（:20-33）和检查 2 的失败表（:120，只列 1 / 2）都没提。QA install.log 显示本机默认 node 为 v20.19.2，engines 要求 `>=22.13.0 <23`。
- 关于 QA 的提醒：1a 片段**不需要** `--experimental-strip-types`，lib 不导入 `.ts`（lib :5-10、:44-45 只 `readFileSync`），node20 也能跑。所以无需给 1a 加 flag，但前置应统一要求 Node 22。
- 建议：前置节加一句「Node 22（`engines >=22.13 <23`），`source ~/.nvm/nvm.sh && nvm use 22`」；检查 2 失败表补「node < 22.6 → exit 9（bad option），属环境问题，不是通过」。

### F-5 · minor · 1a/1b 未列锚点断言失败的 exit 1 形态

- 证据：`extractProtocolContract` 在锚点丢失时 `throw new Error("validateModuleMessage lost …" / "… drifted …")`（lib :86-135）。generate 没有 try/catch 包这一段（`generate-module-protocol-schema.mjs` 只在 `assertCleanTree` 上 catch → 2），1a 片段也没有，结果都是未捕获异常、exit 1、带 stack。gate doc 1a 表（:66-70）只写 `FAIL schema-stale` / `PASS schema-current`；1b 表（:81-88）只写 exit 0 和脏树 exit 2。
- 影响：这正是生成器**能**抓到的那类 validator 漂移，文档没把它列为预期失败形态，执行者可能误以为是环境错误。
- 建议：1a/1b 表补一行「锚点 / 枚举漂移 → exit 1，stderr `Error: … lost … / … drifted …` → 视为 FAIL，按 F-5 同步 lib 映射」。

### F-6 · minor · 检查 4 片段的退出码不反映 runner 退出码；`python` / `python3` 混用

- 证据：gate doc :160-169。runner 与 `python3 -c` 是分开的两条命令，没有 `set -e` 或 `&&`。片段最终的 exit 只取决于 `scenarios==53 && gateScenarioCount==53`，而 `run.py:906-916` 即使 failed/blocked 也会写出 `scenarios=53` 的 summary。另外 :160 用 `python`，:166 用 `python3`，macOS 上 `python` 可能不存在。
- 建议：runner 行改为 `python3 tools/agent-loop-parity/run.py … ; echo "runner_exit=$?"`，或把整段改为 `set -e`；summary 检查加 `not s["blocked"] and not s["failed"] and not s["oracleFailures"]`。

### F-7 · nit · `.exit` 证据文件格式不统一

- PR 自带的 exit 文件全部是 `key=value`（如 `cargo_exit=0`、`replay_exit=1`）。QA 的 exit 文件大多是纯数字，但 `qa-gate-3b5cf763/g2/regen2.exit` = `regen2 diff exit 0`，`g3/schema-diff.exit` = `g3 schema diff exit 0`。
- 判断：**可接受**。值都能读出且为 0，与对应 `.diff` / 日志一致（`g2/regen2.diff` 为 0 字节）。日后 CI / 脚本化采集应统一为纯数字或固定 `key=N`，便于机器解析。不阻塞本 PR。

### F-8 · nit · `inexpressibleRules === 0` 与「不可表达规则单列」两条表述有张力

- gate doc :118 要求 `A2.inexpressibleRules === 0`，同时括号里说「若出现须单列」。replay 里 `const inexpressibleRules = [];` 是硬编码的空数组，永远是 0，脚本也不把它计入 `failed`。建议改写为「当前恒为 0（脚本未实现自动识别）；若人工发现不可表达规则，在 PR 正文单列，并在 T-P0a-04 中补自动化」。

### F-9 · nit · CONTRIBUTING 可补最小三命令

- CONTRIBUTING :13-22 只列脚本名。按 G6 字面「copy-paste runnable」，可在 :22 后补 3 行（generate → `git diff --exit-code` → replay），并注明「完整判据见 gate doc」。不补也可以接受（见 G6 判定）。

### F-10 · nit · 触发措辞

- gate doc :7「含仅改注释以外的契约或校验逻辑」语义含糊：「含」和「以外」叠在一起，读不出纯注释改动是否豁免。建议改为「任一 PR 修改 `protocol.ts`（纯注释 / 格式改动可在 PR 正文声明 N/A，但仍须跑 1a + 2）」。

### 观察（不计 finding）

- G2 原始示例「类型上加 optional 字段」不被任何自动检查抓到（1a 不 stale，replay 语料也不会用到新字段）。文档已归入 F-5 并要求人工审查（:72、:269），但没给出具体的人工步骤。可考虑在检查 6 加一条「PR 正文逐处列出 protocol.ts diff 对应的 lib 映射改动或 N/A」，让「人工审查」可检查。可放到 T-P0a-04 或 Round-2 时一起处理。
- 门禁兜底的强度取决于合成模板与 20 个负样本的覆盖面。G3 能抓到，是因为合成 execute 模板恰好不带 `sessionId`。文档在 evidence README :72 已如实写明，R2-1 已归 T-P0a-04。

## Provenance

- QA：`qa-gate-3b5cf763/provenance.json` 记录 `gitSha=3b5cf763…`、`gitDirty=false`，记录时间 20:32:53+08:00；SUMMARY 记录 scratch 分支已删除、未推送、porcelain 为空。
- PR 证据：`provenance.json` 记录 `gitSha=6be324cd…`（文档提交）、`gitDirty=false`，并注明「本目录为后续单独提交，HEAD ≠ gitSha」，与 gate doc :261 的规则一致。baseline `replay.stdout.txt` 中 `gitSha=6be324cd…`；g2 replay `gitSha=6f37ee77…` 等于 schema commit；g3 replay `gitSha=b052c731…` 等于 protocol commit。三者相互一致。
- 唯一的不一致见 F-3（baseline `provenance.txt`）。
- 未推送声明：本审阅无法从本机验证 `git ls-remote --heads origin 'tmp/T-P0a-07*'`（该 origin 指向 Eveosev fork，本仓库 origin 是 OpenBMB），采信 Arch + QA 两方的记录。

## 是否建议 draft → ready

**暂不建议，修完 F-1、F-2 后建议转 ready。** 两项都是 gate doc / CONTRIBUTING 的文字改动，不碰脚本，不需要重跑 G2/G3。F-3 改正 provenance 文件即可。F-4 到 F-6 建议同轮修。Round-2 只需核对文档 diff 和 F-3 的文件。CI 绿灯仍按 DECISION 第 7 条：本门禁文档过 Reviewer 后再议，且 CI 的路径过滤应采用 F-2 扩充后的范围。
