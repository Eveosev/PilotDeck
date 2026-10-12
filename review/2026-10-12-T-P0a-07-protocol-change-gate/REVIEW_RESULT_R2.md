# T-P0a-07 Round-2 审阅结果 · PR #7 @ `9da4ee1d`

- PR：Eveosev/PilotDeck #7（draft）→ `rust_standalone_alpha1@1da663a2`
- Round-1 tip `3b5cf763`。修复提交：`b4c581d9`（门禁流程 / 触发路径 / Node 22）→ `d84f3e8c`（pipefail 透传 replay exit）→ `3fa5e99a` / `3fb9d179` / `8394c020`（R1 连跑证据）→ `8004fb21`（F-5 锚点失败形态、F-6 runner exit）→ `9da4ee1d`（F-3 provenance + R2 连跑证据）。
- 审阅人：本机 Claude Code（独立、只读）。已执行 `git fetch https://github.com/Eveosev/PilotDeck.git pull/7/head`，FETCH_HEAD = `9da4ee1df3df9169df8a7f1f8ad327a0ecb2ceaa`，与 QA `qa-gate-9da4ee1d/provenance.json` 一致。（fetch 只写入了 `.git` 对象与 FETCH_HEAD，和 Round-1 做法相同；工作树没有改动。）
- 下文行号均指 `9da4ee1d` 下的文件：gate doc = `evidence/protocol-sync-gate.md`，CONTRIBUTING = `CONTRIBUTING.md`。脚本行号指 `9da4ee1d` 下的 `scripts/…`，`3b5cf763..9da4ee1d` 区间内脚本没有改动。
- 本审阅没有重跑脚本。运行结论引用 QA `qa-gate-9da4ee1d/` 和 PR 自带证据；行为结论来自读源码。

## TL;DR

**conditional_pass**。Round-1 的 10 条中 9 条 closed，1 条 partially（F-7：新证据格式已统一，旧 QA 件的清理 / sha256 核验还没做，属已知限制，不阻塞）。两个 major 都已关闭：F-1 改为「一次 replay → 拷到临时目录 → restore → 2/3/7 只读副本」，QA 在 `bash -e` 下原文执行 exit 0、树干净，旧顺序对照 exit 2；F-2 新增 8 条触发路径，CONTRIBUTING、README、schema README 同步更新。没有 blocker、没有 major。新 finding 4 条 minor、3 条 nit。ready 前唯一要求是 R2-1：「CI `paths:` 原样复制」的列表漏了 `evidence/schema/module-protocol.schema.json` 等文件，改一行文档即可。

## Verdict

**conditional_pass**。修完 R2-1 即可转 ready（纯文档，不需要重跑 G2/G3）。R2-2、R2-3 建议同轮修，不阻塞。F-7 的旧件 sha256 核验由 QA 按已知限制跟进。

## F-1..F-10 逐条复核

| F | Round-1 原文（摘） | 修复位置 | 判定 | 证据 |
| --- | --- | --- | --- | --- |
| **F-1** major | 「replay 每次运行都会改写已跟踪的 `replay-report.*` … 2 → 3 → 7 照抄执行会在第二次 replay 时 exit 2」；建议一次 replay 共用、restore、fixtures 先提交、exit 1 也会改写报告（R1 L48-60） | `b4c581d9`、`d84f3e8c`；gate doc :68（共用一次 replay 的说明）、:143-161（一次 replay + restore 块，`set -o pipefail`）、:163（需要入 PR 时单独做证据提交）、:165（exit 1 也会写报告，重跑前先 restore）、:171 / :205 / :333（2/3/7「不要再跑 replay」）、:203（fixtures 先提交）；CONTRIBUTING :30-111 合成一个命令块；schema README「Commands」改为指向 CONTRIBUTING | **closed** | R1 的 4 条建议全部落地。QA `verbatim/block.sh` 与 CONTRIBUTING :37-110 逐字一致；`verbatim/run.log` 在 `bash -e -x` 下 exit 0（`run.exit`=0），`test -z ''` 通过，7 的 `gitSha == HEAD == 9da4ee1d`、`gitDirty False`。对照组 `control/replay1.exit`=0、`replay2.exit`=2，stderr 为 `requires a clean git tree`，复现了 R1 的问题。PR 自带 `r1-verbatim/old-sequence-dirty.txt`、`r2-verbatim/verbatim-sequence.txt` 结论相同。失败路径和交互粘贴的残留问题见 R2-2。 |
| **F-2** major | 「门禁触发范围只写 `protocol.ts`，漏了手写映射与 replay 语料源」；建议加入 lib、generate/replay、fixtures、`tools/agent-loop-parity/{run.py,scenarios.json}`（R1 L62-66） | `b4c581d9`；gate doc :12-25（8 条触发路径）、:27-35（适用范围表，:32 写明非 protocol.ts 路径走 1-3、7）；CONTRIBUTING :7-19；README.md / README.zh.md 各 1 行；`evidence/schema/README.md` :7-10 | **closed** | 对照脚本核实了触发列表：replay 读取 `PROTOCOL_PATH`、`SCHEMA_PATH`、两份 fixtures（`replay-…mjs:45-46`），lib 读取 `SCENARIOS_PATH`、`PARITY_RUNNER_PATH`（lib :22-23、:416、:426）；`protocol.ts` 没有 import，不存在传递依赖。R1 点名的路径全部覆盖。新暴露的问题：触发列表被定为「日后 CI `paths:` 原样复制」，但列表本身漏了 schema JSON 等文件，见 R2-1。 |
| **F-3** minor | 「baseline `provenance.txt` 的 exit 码与日志、README 自相矛盾」（`check1a_exit=1` / `generate1_exit=1`），建议改为 0/0 或拆成 `*.exit.txt`（R1 L68-72） | `9da4ee1d`；`evidence/baseline/provenance.txt` :3-4 改为 0/0，:6-8 注释说明原因；新增 `baseline/check1a.exit.txt`（`check1a_exit=0`）、`baseline/generate1.exit.txt`（`generate1_exit=0`）；evidence README「F-3 更正」节；`provenance.json.f3` | **closed** | 三处数值一致（provenance.txt、拆分出的 exit 文件、`check1a.txt`=`PASS schema-current`）。QA 复核为 0/0（SUMMARY「F-3 provenance 0/0」）。原因说明（第一次 pipe 时缺 ajv，`$?` 取错）在 provenance.txt :6-7 与 README 两处一致。provenance 粒度方面的残留问题见 R2-3。 |
| **F-4** minor | 「未写 Node 版本前置；replay 在 node20 上 exit 9，不在文档的 exit 码表里」；1a 不需要 strip-types（R1 L74-78） | `b4c581d9`；gate doc :5（前提 Node ≥ 22，1a / generate 不加 flag，replay 自己 re-exec，Node 20 exit 9）、:37-44（新增退出码表，其中 9 只由 replay 返回）、:58、:158；CONTRIBUTING :22、:27-28；schema README :44、:60-61 | **closed**（附 nit R2-5） | QA `node20/`：`/usr/bin/node v20.19.2` 下 replay exit 9、stderr 为 `bad option: --experimental-strip-types`，generate exit 0，与退出码表 :44「仅 replay；1a / generate 不会因该选项退出 9」一致。PR 自带 `r1-verbatim/node20-replay.exit.txt`=9。版本表述与 `engines` 的细微出入见 R2-5。 |
| **F-5** minor | 「1a/1b 未列锚点断言失败的 exit 1 形态」（R1 L80-84） | `8004fb21`；gate doc :102（1a 表新增「锚点 / 枚举漂移 → FAIL exit 1，stderr 为未捕获异常 … 不要当成环境故障」）、:119（1b 表同形） | **closed**（只做了文档核对） | 对照源码：`extractProtocolContract` 的 throw 位于 lib :50/:60/:70/:87/:92/:96/:99/:103/:109/:120/:128/:131/:134；generate 只在 `assertCleanTree` 处 catch 并返回 2（`generate-…mjs:19-24`），:27 的 extract 没有 try，ESM 顶层未捕获异常 → exit 1；1a 片段同理。文档描述与行为一致。**已知限制**：没有实际改坏锚点去触发 exit 1（QA SUMMARY 也写明「anchor-break not exercised」），按 prompt 只 flag、不作 blocker。另外 :102 列出的 stderr 示例没有覆盖 `protocol.ts is missing …` / `… is not closed` 两种形态（lib :50/:60/:70），因为写的是「形如」，算 nit，并入 R2-6。 |
| **F-6** minor | 「检查 4 片段的退出码不反映 runner 退出码；`python` / `python3` 混用」；建议 `runner_exit=$?` 并排除 blocked/failed/oracle（R1 L86-89） | `8004fb21`；gate doc :238-259（`runner_exit=$?`、`summary_exit=$?`、runner 非零时 `exit "$runner_exit"`）、:251-254（排除 `blocked` / `failed` / `oracleFailures`）、:261（只用 python3）、:265 | **closed**（附 nit R2-7） | summary 键 `scenarios` / `gateScenarioCount` / `blocked` / `failed` / `oracleFailures` 都存在（`run.py:886-899`）。QA `check4/result.txt`：替身 runner rc 0 → 片段 0，rc 2 → 片段 2；`stub-rc2.log` 显示 summary 中 `scenarios 53 gate 53` 但 `blocked True`，片段仍返回 2，正好是 R1 描述的场景。gate doc 中已没有裸 `python` 命令，`:236` 去掉了 nvm 依赖。 |
| **F-7** nit | 「`.exit` 证据文件格式不统一」；QA `g2/regen2.exit`、`g3/schema-diff.exit` 内容为文字。判断可接受（R1 L91-94） | QA 侧：`qa-gate-9da4ee1d/**/*.exit` 全部为纯数字（含 `g2/regen2.exit`=0、`g3/schema-diff.exit`=0）。PR 侧：新文件统一为 `key=N`（`baseline/*.exit.txt`、`r2-verbatim/STEP_*_exit=N`） | **partially**（非阻塞） | 新一轮证据的格式已统一。`qa-gate-3b5cf763/g2/regen2.exit`（`regen2 diff exit 0`）、`g3/schema-diff.exit`（`g3 schema diff exit 0`）仍是文字。按 prompt 所列已知限制，删除这些原始证据的提交尚未出，sha256 由 QA 后续核对，本审阅无法独立验证。R1 本身就判为可接受，所以不构成 ready 条件。PR 侧 `key=N` 与 QA 侧纯数字仍是两种约定，日后 CI 采集时统一即可。 |
| **F-8** nit | 「`inexpressibleRules === 0` 与『不可表达规则单列』两条表述有张力」（R1 L96-98） | `b4c581d9`；gate doc :188 | **closed** | :188 写明「当前恒为 0（脚本 `const inexpressibleRules = []`，未实现自动识别，也不计入 replay `failed`）。若人工发现……在 PR 正文单列，自动化放到 T-P0a-04」，基本采用了 R1 建议的原文。检查 2 的 python（:179-180）也不再把它作为判据，只打印。 |
| **F-9** nit | 「CONTRIBUTING 可补最小三命令」（R1 L100-102） | `b4c581d9` / `d84f3e8c` / `8004fb21`；CONTRIBUTING :30-111 | **closed**（做得超出建议） | 补的不止三行，而是 1a、1c、replay+restore、2、3、7 的完整可复制块，QA 原文执行 exit 0。代价是命令现在在 gate doc 与 CONTRIBUTING 两处各有一份（gate doc :78-95 / :145-154 / :174-181 / :208-221 / :336-344 对 CONTRIBUTING :44-110）。本轮逐行比对两处一致，漂移风险留到日后 CI 再收敛，不另立 finding。 |
| **F-10** nit | 「触发措辞『含仅改注释以外的契约或校验逻辑』语义含糊」（R1 L104-106） | `b4c581d9`；gate doc :14；CONTRIBUTING :21-22 | **closed** | :14：「修改 `protocol.ts` 时，纯注释 / 格式改动可在 PR 正文声明检查 4/5/6 为 N/A，但仍须跑 1a + 2」。与 R1 建议一致，并具体到哪些检查可以 N/A。原文的含糊措辞已删除。 |

R1「观察」中「人工审查不可检查」一条也已处理：检查 6 :315 要求「若改了 `protocol.ts` 的校验 / 字段，逐处列出对应 `scripts/lib/module-protocol-schema.mjs` 映射改动或 N/A」。

## QA 证据复核（qa-gate-9da4ee1d）

| 项 | 判定 | 依据 |
| --- | --- | --- |
| Provenance | OK | `provenance.json`：`gitSha=9da4ee1d…`、`gitDirty=false`、node v22.19.0；与 FETCH_HEAD 一致。`install.exit`=0。 |
| G1 / F-1 原文执行 | PASS | `verbatim/block.sh` 与 CONTRIBUTING 块逐字一致；`run.exit`=0；restore 后 porcelain 为空。 |
| G2 | PASS | `g2/check1a.exit`=1，log 为 `FAIL schema-stale`；`regen1.diff` 14 行；`regen2.exit`=0；`replay.exit`=0，`expressibleMismatches: 0`。 |
| G3 | PASS | `g3/check1a.exit`=0（F-5 漏报），`schema-diff.exit`=0，`replay.exit`=1，log :13 `expressibleMismatches: 53`、:38 `T-P0a-01 acceptance failed`。 |
| G7 | PASS | `git diff --name-only 1da663a2 9da4ee1d` 共 73 个文件，全部属于 `CONTRIBUTING.md`、`README(.zh).md`、`evidence/protocol-sync-gate.md`、`evidence/schema/README.md`、`review/**`；无 `src/`、`scripts/`、`tools/`、`crates/`、`.github/`、`package*.json`、lock。与 `g7-diffstat.txt`（2210+/5-）一致。 |

## 增量 diff 新 finding

### R2-1 · minor（ready 前修）· 「CI `paths:` 原样复制」的触发列表漏了 schema 产物与依赖

- 证据：gate doc :10、:12 要求日后 CI `paths:` **原样复制** :16-25 的 8 条路径。但适用范围表 :34 把「仅更新 `evidence/schema/module-protocol.schema.json` / replay 报告 / 本文件」也列为走门禁，这几项都不在列表里。另外 lib :13 把 `ajv/package.json` 的版本写进 schema（lib :226 `ajv: AJV_VERSION`），所以 ajv 升级（`package.json` / `pnpm-lock.yaml`）会让 1a 变成 stale，但同样不触发。
- 场景：有人直接手改 `module-protocol.schema.json`（例如放宽某个 `$defs` 来「消零」，正是 :192 禁止的做法），或者只升级 ajv。按照「原样复制」得到的 CI 不会触发，而只要跑门禁，1a 和 replay 的 `A1.fileMatchesBuilder` 都能抓到。这和 R1 F-2 是同一类 CI 盲区，只是范围小了。
- 建议（一行文档）：:16-25（以及 CONTRIBUTING :10-19 的副本）补上 `evidence/schema/module-protocol.schema.json`、`evidence/schema/replay-report.json`、`evidence/schema/replay-report.md`、`evidence/protocol-sync-gate.md`；`docs/pilotdeck-module-protocol-v2.schema.json` 视 Arch 意见决定。依赖类改为在 :12 注明「`package.json` / `pnpm-lock.yaml` 中 ajv 版本变化也须跑 1a + 2」，或者直接加入列表。也可以把 :10 的「原样复制」改为「以本列表为下限」。不需要重跑 G2/G3。

### R2-2 · minor · 命令块没说明执行方式；失败路径会跳过 restore，交互粘贴时 python 判据不能替代 replay exit

- 证据：CONTRIBUTING :32-38、gate doc :68「必须按原文连跑」都没有说明是用 `bash -e` 执行脚本还是在交互式 shell 里粘贴。QA 是用 `bash -e` 跑通的（`verbatim/run.log` 带 `+` 前缀）。
  1. 在 `-e` 下 replay exit 1（G3 场景）时，脚本在 :69 立刻退出，:70-73 的 cp / restore 不会执行，已跟踪的报告保持脏状态。gate doc :165 有提醒，但 :68 写的是「树保持干净」，只在成功路径上成立。
  2. 不带 `-e` 交互粘贴时，replay 的非零 exit 只会显示为 stderr 里的一行 `T-P0a-01 acceptance failed`，后面的 2/3/7 python 照样打印、照样返回 0。python 判据没有覆盖 replay `failed` 里的 `a2.scenarios === 53` 和 `a4.matchesSource`（`replay-…mjs:461-472`）。如果失败原因是这两项，屏幕上的 2/3/7 输出全部「正常」。
  3. macOS 默认的 zsh 在交互模式下没有开 `interactive_comments`，`# 1a — …` 这类注释行会报 `command not found: #`。`set -o pipefail` 也会留在用户的 shell 里。
- 判定：成功路径已被 QA 验证，失败时在 `-e` 下也能正确以非零退出，所以不影响 gate 的判定，定为 minor。
- 建议：在 CONTRIBUTING :32 写明「保存为文件后用 `bash -e <file>` 执行（不要逐行粘进 zsh）」。在 :69 之后记下 `replay_exit=$?`（或用 `trap '…git checkout -- evidence/schema/replay-report.json evidence/schema/replay-report.md' EXIT`），restore 之后再 `exit "$replay_exit"`，或者在 2/3/7 之前 `test "$replay_exit" -eq 0`。gate doc :156-158 同步修改。

### R2-3 · minor · evidence README / provenance.json 重写后丢了 G2/G3 的明细和逐目录的 provenance

- 证据：`9da4ee1d` 把 `review/…/evidence/README.md` 从 81 行缩到 33 行（增量 diff L739-843），删掉了 G2/G3 结果表、「G2 为什么选 enum 而不是 optional 字段」的说明（R1 G2 判定正是依据这一段）、临时分支 SHA，以及「`git ls-remote --heads origin 'tmp/T-P0a-07*'` 为空」这一句。`provenance.json` 删掉了 `tempBranchesNotPushed`（g2 `f019dca6` / `6f37ee77`，g3 `b052c731`）。同时顶层 `gitSha` / `docsCommit` 改成了 `8004fb21`，而 `baseline/`、`dry-run-g2/`、`dry-run-g3/` 实际采集于 `6be324cd` 和临时分支（`baseline/provenance.txt:1`、`dry-run-*/commit.sha.txt`）。
- 影响：数据本身没有丢，`dry-run-*/commit.sha.txt`、`protocol.diff`、日志都还在。但这个 PR 的第 7 条规则就是证据完整性，现在目录级 README 和 provenance.json 只描述 R2 连跑一次采集，事后审计看不出各子目录分别对应哪个 SHA，也看不到未推送的声明。
- 建议：在 README 加一张小表「子目录 → 采集 SHA → 是否 dirty」（baseline / dry-run-g2 / dry-run-g3 → `6be324cd` + 临时分支 SHA；r1-verbatim → `d84f3e8c`；r2-verbatim → `8004fb21`）。恢复 G2/G3 各 1-2 行的结论，以及「选 enum 的原因」和「临时分支未推送」两句。provenance.json 恢复 `tempBranchesNotPushed`，或者改为按子目录记录。

### R2-4 · minor · 交互粘贴检查 4 片段时，末尾的 `exit` 会关闭用户终端；`pnpm build` 的结果没有检查

- 证据：gate doc :257-258 的 `exit "$runner_exit"` / `exit "$summary_exit"` 在交互式 shell 里执行，会直接退出当前终端。:239 的 `pnpm build` 失败时片段继续往下跑，runner 多半会以 2（BLOCKED）结束，所以结论仍然是非零、不会误判通过，只是原因不直观。
- 建议：:238 前加一句「用 `bash` 执行（或用 `( … )` 子 shell 包住）」，`pnpm build` 后接 `|| exit 2`。也可以和 R2-2 一起处理，统一声明「命令块一律用 `bash -e` 执行」。

### R2-5 · nit · Node 版本表述与 `engines` 不一致，exit 9 的条件写宽了

- 证据：gate doc :5、:58 写「Node ≥ 22 / `v22.*` 或更高」，退出码表 :44 写「Node < 22 → 9」。而 `package.json` engines 是 `>=22.13.0 <23`，`.nvmrc` 是 `v22`。`--experimental-strip-types` 从 22.6.0 才有，22.0-22.5 同样会 exit 9。Node 24 满足「≥ 22」但不满足 engines。
- 建议：统一写成「Node 22（engines `>=22.13.0 <23`）」，:44 改为「Node < 22.6」。

### R2-6 · nit · 锚点失败示例没列全

- gate doc :102 / :119 列了 `lost …` / `drifted …` / `MODULE_CALL_TARGETS is unexpectedly short` / `protocol.ts lost …`，漏了 `protocol.ts is missing …`、`protocol.ts function … is not closed`（lib :50/:60/:70）。前面写的是「形如」，不影响判断，可以顺手补上，或者改成「任何未捕获 `Error:`」。

### R2-7 · nit · 命令在 gate doc 与 CONTRIBUTING 各有一份

- 这是 F-9 修法的代价（见 F-9 行）。本轮两份逐字一致。建议在 gate doc :372 写明「两处必须同步修改，以 CONTRIBUTING 为准，QA 原文连跑的对象是 CONTRIBUTING」。日后 CI 可以把命令块抽成脚本后再收敛为一份。

## 增量 diff 其他核对（无问题）

- `d84f3e8c` 的 `set -o pipefail`（gate doc :146、CONTRIBUTING :38）确实让 `node … | tee` 的退出码等于 replay 的退出码，`r1-verbatim/old-sequence-dirty.txt` 里的 `old_replay2_exit=2` 证明能透传。
- 检查 2/3/7 python 引用的报告键 `A1.reproducible`、`A1.dirtyTreeRefused`（`replay-…mjs:114` 及附近）、`A3.loosenedSchemaControl.result`、`missingMessageTypes`、`missingConditionals`、`edgesMatchExpect` 都存在，QA 原文执行没有出现 KeyError。
- 1b 脏树 stderr「含 `dirty`」（:118）与 lib :40 `… refused: git tree is dirty` 一致；replay 脏树 exit 2（`replay-…mjs:126-130`）与 :43 一致。
- 检查 7（:338-344）读的是临时副本，`gitSha == HEAD` 在采集树上成立；:163 要求「采集 SHA = 证据提交的 parent」，与 R1 F-1 的建议一致。
- `9da4ee1d` 把 Round-1 的 `REVIEW_RESULT.md` 原样提交进了 `review/…/`，属于 review 目录，G7 范围允许。
- CI 表述：gate doc :3、:10、:360，CONTRIBUTING :24-25，schema README :6 都写明「不在本任务 / not enabled」，没有误导。

## ready 前条件

1. **必须**：修 R2-1，补全触发路径列表，或者把「原样复制」改为「以此为下限」。纯文档改动，不需要重跑 QA 的 G2/G3，只需 G7 复核 diffstat。
2. **已知限制，由 QA 跟进，不阻塞 ready**：F-7，`qa-gate-3b5cf763` 旧文字 exit 件的删除提交与 sha256 核验；F-5，锚点改坏后 exit 1 只做了文档核对，没有实测。如果之后 T-P0a-04 做 CI，建议在那里补一个改坏锚点的负控制。
3. **建议同轮修**：R2-2（执行方式声明 + 保留 replay exit）、R2-3（逐目录 provenance）、R2-4。R2-5 到 R2-7 可以顺手处理，也可以留到 CI 任务。

满足第 1 条后，建议 draft → ready。CI 绿灯仍按 DECISION 第 7 条：本门禁文档过 Reviewer 后再议，CI 的 `paths:` 应采用 R2-1 补全后的列表。
