# T-P0a-07 Module Protocol 变更同步门禁

- 任务：T-P0a-07（文档先行，**不做 CI / git hook**）
- 基线：`rust_standalone_alpha1@1da663a2`
- **前提：Node >= 22**（`node -v` 主版本 ≥ 22）。1a / generate 只 `readFileSync` `protocol.ts`，**不要**给它们加 `--experimental-strip-types`。replay 脚本会自己用该 flag 再 exec 一次；Node 20 会 `bad option` 并以 **exit 9** 退出。
- 依赖：仓库根 `pnpm install`（ajv 8.20.0）。
- 原则：**同步，不冻结**。触发文件（见下）可以改，但必须在**同一 PR** 内把 schema / replay / 样本 / parity / Rust adapter（自 T-P1-01 起）/ 版本评估 / 干净树证据一起落地。
- Schema 口径（R2-3）：**hand-mapped + source anchors + replay**，不是从 TypeScript 类型自动推导。生成器只从源码抽取版本常量、`MODULE_CALL_TARGETS`、`isOutcome` 枚举，并断言若干 `validateModuleMessage` 锚点。

CI 路径触发自动检查**不在本任务**。Payne 已锁定：门禁文档过 Reviewer 后再开绿灯（可并入 T-P0a-04）。日后 CI 的 `paths:` **原样复制**下面「触发路径」列表。

## 触发路径（日后 CI `paths:` 原样复制）

任一 PR 触及下列路径之一，即适用本门禁。修改 `protocol.ts` 时，纯注释 / 格式改动可在 PR 正文声明检查 4/5/6 为 N/A，但仍须跑 1a + 2。

```
src/agent/modules/protocol.ts
scripts/lib/module-protocol-schema.mjs
scripts/generate-module-protocol-schema.mjs
scripts/replay-module-protocol-schema.mjs
evidence/schema/fixtures/negative-samples.json
evidence/schema/fixtures/edge-samples.json
tools/agent-loop-parity/run.py
tools/agent-loop-parity/scenarios.json
```

## 适用范围

| 改动 | 是否走本门禁 |
| --- | --- |
| `src/agent/modules/protocol.ts`（契约或校验） | 是（检查 1–7） |
| 上表其余触发路径（手写映射、generate/replay、fixtures、parity runner/场景表） | 是（检查 1–3、7；4/5/6 可 N/A，除非改了运行时 accept/reject 或版本） |
| `crates/` Rust adapter（T-P1-01 起） | 是（检查 5）；须与协议改动同 PR |
| 仅更新 `evidence/schema/module-protocol.schema.json` / replay 报告 / 本文件 | 按对应检查执行；不强制 live parity |
| 未改触发路径、也未改 `crates/` 协议处理的普通功能 PR | 否 |

## 退出码

| exit | 含义 | 谁会返回 |
| --- | --- | --- |
| **0** | 通过 | generate、replay、1a（schema-current）、`git diff --exit-code`、cargo、parity runner |
| **1** | 未通过（schema-stale / acceptance failed / summary 不是 53） | 1a、replay、检查 2/3/7 的 python 断言、parity |
| **2** | 脏树拒绝 | generate、replay（`git status --porcelain` 非空） |
| **9** | Node < 22：`--experimental-strip-types` 为未知选项 | **仅 replay**（及其自再 exec）。1a / generate 无此 flag，Node 20 不会因该选项退出 9 |

## 前置：干净树

`scripts/generate-module-protocol-schema.mjs` 与 `scripts/replay-module-protocol-schema.mjs` **拒绝脏树**（exit 2）。先提交触发文件，再生成 / replay。

```bash
node -v
git status --porcelain
git rev-parse HEAD
```

| 项 | 期望 |
| --- | --- |
| `node -v` | `v22.*` 或更高 |
| `git status --porcelain` | 空（无输出） |
| exit | 0 |

---

## 检查清单（1–7）

每条都给出：**精确命令**、**期望输出 / 退出码**、**证据路径**。

检查 **2、3、7 共用一次 replay**。replay **会改写** 已跟踪的 `evidence/schema/replay-report.json` 与 `replay-report.md`（`gitSha` 变成当前 HEAD）。若按「检查 2 跑一遍、检查 3 再跑一遍、检查 7 再跑一遍」，第二次起树已脏，replay **exit 2**。官方顺序：replay **一次** → 报告拷到临时目录 → **立刻 restore** 跟踪文件 → 2/3/7 只读临时副本。下面「一次 replay + restore」必须按原文连跑，树保持干净。

### 1. Schema 重生 + 二次生成 diff 为空

重跑生成器，提交更新后的 `evidence/schema/module-protocol.schema.json`。若本次契约改动也影响已发布的 v2 profile，同一 PR 更新 `docs/pilotdeck-module-protocol-v2.schema.json`（该文件是手写 profile schema，**不是**生成器输出；生成器只写 evidence 副本）。

**1a. 重生前：builder 输出 vs 磁盘 schema（捕获未同步）**

不使用 `--experimental-strip-types`。`readProtocolSource()` 是 `readFileSync`。

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import {
  SCHEMA_PATH,
  buildModuleProtocolSchema,
  extractProtocolContract,
  readProtocolSource,
  stringifySchema,
} from "./scripts/lib/module-protocol-schema.mjs";
const built = stringifySchema(buildModuleProtocolSchema(extractProtocolContract(readProtocolSource())));
const onDisk = readFileSync(SCHEMA_PATH, "utf8");
if (built !== onDisk) {
  console.log("FAIL schema-stale");
  process.exit(1);
}
console.log("PASS schema-current");
'
```

| 项 | 期望 |
| --- | --- |
| 可抽取契约已改、尚未 regen | **FAIL schema-stale**，exit **1** |
| 已 regen 并提交 schema | **PASS schema-current**，exit **0** |
| 锚点 / 枚举漂移（`extractProtocolContract` throw） | **FAIL**，exit **1**，stderr 未捕获异常，形如 `Error: validateModuleMessage lost …` / `… drifted …` / `MODULE_CALL_TARGETS is unexpectedly short` / `protocol.ts lost …`。视为检查失败，按局限 F-5 同步 `scripts/lib/module-protocol-schema.mjs` 映射后再 regen。不要当成环境故障。 |
| 证据 | 命令 stdout / stderr；PR 内 `git diff -- evidence/schema/module-protocol.schema.json` |

类型上新增 optional 字段、或只改 `validateModuleMessage` 里未被抽取/锚定的规则时，1a 可能仍 PASS。这是已知局限 **F-5**（手写映射），不能单靠本条放行。

**1b. 第一次生成**

```bash
node scripts/generate-module-protocol-schema.mjs
git diff -- evidence/schema/module-protocol.schema.json
```

| 项 | 期望 |
| --- | --- |
| exit（generate） | **0** |
| stdout | `generated evidence/schema/module-protocol.schema.json from src/agent/modules/protocol.ts` 以及 `protocolVersion=…` / `capabilitiesVersion=capabilitiesVersion` / `notContract=storageConfigVersion` |
| 脏树 | exit **2**，stderr 含 `dirty`（generate 只对 `assertCleanTree` catch → 2） |
| 锚点 / 枚举漂移 | exit **1**，stderr 未捕获 `Error: … lost …` / `… drifted …`（与 1a 同形）。视为 FAIL，同步 lib 映射后再 regen。 |
| 契约可抽取变化 | `git diff` **非空**；把新 schema 纳入同一 PR |
| 无契约抽取变化 | `git diff` 空；用检查 2 抓 validator 漂移 |
| 证据 | `evidence/schema/module-protocol.schema.json`；如 profile 受影响则还有 `docs/pilotdeck-module-protocol-v2.schema.json` |

**1c. 二次生成 diff 为空**

先提交 1b 写出的 schema（树再次干净），然后：

```bash
node scripts/generate-module-protocol-schema.mjs
git diff --exit-code -- evidence/schema/module-protocol.schema.json
```

| 项 | 期望 |
| --- | --- |
| generate exit | **0** |
| `git diff --exit-code` | **0**（无输出） |
| 证据 | 空 diff；一次 replay 临时报告里 `A1.secondGenerationDiffEmpty=true`（见检查 2 的 `$PROTOCOL_REPLAY_OUT/replay-report.json`） |

`docs/pilotdeck-module-protocol-v2.schema.json` 不由本脚本覆盖。若 SOP 字段 / 枚举变了，人工改该文件并在 PR 说明。

---

### 一次 replay + restore（检查 2 / 3 / 7 的共同前缀）

```bash
set -o pipefail
export PROTOCOL_REPLAY_OUT="${PROTOCOL_REPLAY_OUT:-/tmp/protocol-sync-replay}"
mkdir -p "$PROTOCOL_REPLAY_OUT"
node scripts/replay-module-protocol-schema.mjs | tee "$PROTOCOL_REPLAY_OUT/stdout.txt"
cp evidence/schema/replay-report.json "$PROTOCOL_REPLAY_OUT/replay-report.json"
cp evidence/schema/replay-report.md "$PROTOCOL_REPLAY_OUT/replay-report.md"
git checkout -- evidence/schema/replay-report.json evidence/schema/replay-report.md
test -z "$(git status --porcelain)"
```

| 项 | 期望 |
| --- | --- |
| replay exit | **0**（失败 **1**；脏树 **2**；Node 20 **9**） |
| `tee` 里的 JSON | `A1.ok === true`；`A2.expressibleMismatches === 0`；`A3.allRejectedByBoth === true`；`A3.loosened === "FAIL"` |
| restore 后 `git status --porcelain` | 空 |
| 证据 | `$PROTOCOL_REPLAY_OUT/replay-report.json`、`$PROTOCOL_REPLAY_OUT/replay-report.md`、`$PROTOCOL_REPLAY_OUT/stdout.txt` |

协议确实变了、需要把新报告纳入 PR 时：从 `$PROTOCOL_REPLAY_OUT` 拷回跟踪文件，**单独证据提交**（采集 SHA = 该证据提交的 parent）。不要在 JSON 里写尚未产生的 evidence commit SHA。本门禁的 2→3→7 **验证**只读临时副本，不把跟踪报告留在脏状态。

replay **无论成败**都会 `writeFileSync` 跟踪报告（含 `gitSha`）。**exit 1**（acceptance failed）同样留下脏树；修完后若再跑 replay，须先 `git checkout -- evidence/schema/replay-report.json evidence/schema/replay-report.md`（或先提交报告），否则下一次会 **exit 2**。

---

### 2. Replay：可表达错配 = 0

先跑完上一节「一次 replay + restore」。**不要再跑** `node scripts/replay-module-protocol-schema.mjs`。

```bash
python3 -c 'import json,os,sys
r=json.load(open(os.path.join(os.environ["PROTOCOL_REPLAY_OUT"],"replay-report.json")))
print("expressibleMismatches", r["A2"]["expressibleMismatches"])
print("inexpressibleRules", r["A2"]["inexpressibleRules"])
print("A1.reproducible", r["A1"]["reproducible"], "dirtyTreeRefused", r["A1"]["dirtyTreeRefused"])
ok = (r["A2"]["expressibleMismatches"]==0
      and r["A1"]["reproducible"] and r["A1"]["dirtyTreeRefused"])
sys.exit(0 if ok else 1)'
```

| 项 | 期望 |
| --- | --- |
| exit | **0** |
| 打印 | `expressibleMismatches 0`；`A1.reproducible True`；`dirtyTreeRefused True` |
| `inexpressibleRules` | 当前恒为 **0**（脚本 `const inexpressibleRules = []`，未实现自动识别，也不计入 replay `failed`）。若人工发现不可表达规则，在 **PR 正文单列**，自动化放到 T-P0a-04。 |
| 语料 | 53 条 `tools/agent-loop-parity` 场景的**合成模板**（不是 live wire） |
| 证据 | `$PROTOCOL_REPLAY_OUT/replay-report.json` 的 `A2` |

`expressibleMismatches !== 0` 即 schema 与 `validateModuleMessage` 对同一条样本一 accept 一 reject。必须先修映射或样本，禁止放宽 schema 来消零。

---

### 3. A3 负样本 / 边角更新 + 放宽 schema 对照 FAIL

契约或校验规则变化时，先更新：

- `evidence/schema/fixtures/negative-samples.json`（每消息类型 ≥1 条负样本；条件规则 `final-implies-outcome` / `forbidden-attemptId-stepId` / `forbidden-binding-on-event` 仍须有样本）
- `evidence/schema/fixtures/edge-samples.json`（`1.0` / `-0` / 指数 / 溢出 / 额外字段 / 空 id / `response.final` 非布尔 等）

**fixtures 改动先提交**，再跑（或复用）replay。未提交的 fixture 会让 `git status --porcelain` 非空，replay **exit 2**。

然后**不要重跑 replay**。读同一次临时报告：

```bash
python3 -c 'import json,os,sys
r=json.load(open(os.path.join(os.environ["PROTOCOL_REPLAY_OUT"],"replay-report.json")))
a3=r["A3"]
print("allRejectedByBoth", a3["allRejectedByBoth"])
print("loosened", a3["loosenedSchemaControl"]["result"])
print("missingMessageTypes", a3["missingMessageTypes"])
print("missingConditionals", a3["missingConditionals"])
print("edgesMatchExpect", a3["edgesMatchExpect"])
ok = (a3["allRejectedByBoth"] is True
      and a3["loosenedSchemaControl"]["result"]=="FAIL"
      and a3["missingMessageTypes"]==[]
      and a3["missingConditionals"]==[]
      and a3["edgesMatchExpect"] is True)
sys.exit(0 if ok else 1)'
```

| 项 | 期望 |
| --- | --- |
| exit | **0** |
| 打印 | `allRejectedByBoth True`；`loosened FAIL`；缺类型/条件为空；`edgesMatchExpect True` |
| 证据 | `$PROTOCOL_REPLAY_OUT/replay-report.json` 的 `A3`；fixtures 如上 |

放宽对照（`loosenSchema` 去掉 `allOf` 里的 `not` / `if`）若变成 `UNEXPECTED_PASS`，说明条件规则没有真正落到 schema 上，检查失败。

---

### 4. Parity：相关场景复跑

`protocol.ts` 或 `tools/agent-loop-parity/{run.py,scenarios.json}` 改变运行时 accept/reject、消息形状或场景集时，复跑 gateway sidecar 对拍（产品默认 transport 仍是 native；本命令只跑对拍）。需要已能 `pnpm build` 的 Node >= 22 环境，**不**依赖 nvm。

```bash
pnpm build
python3 tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --scenario all \
  --output /tmp/pilotdeck-agent-loop-parity
runner_exit=$?
echo "runner_exit=$runner_exit"
python3 -c 'import json,sys
s=json.load(open("/tmp/pilotdeck-agent-loop-parity/summary.json"))
print("scenarios", s.get("scenarios"), "gate", s.get("gateScenarioCount"))
blocked=bool(s.get("blocked")); failed=bool(s.get("failed")); oracle=bool(s.get("oracleFailures"))
print("blocked", blocked, "failed", failed, "oracleFailures", oracle)
ok = (s.get("scenarios")==53 and s.get("gateScenarioCount")==53
      and not blocked and not failed and not oracle)
sys.exit(0 if ok else 1)'
summary_exit=$?
if [ "$runner_exit" -ne 0 ]; then exit "$runner_exit"; fi
exit "$summary_exit"
```

整段只用 `python3`（不要混用 `python`）。`run.py` 在 failed/blocked 时仍可能写出 `scenarios=53` 的 summary，所以**必须以 `runner_exit` 为准**；summary 再排除 `blocked` / `failed` / `oracleFailures`。

| 项 | 期望 |
| --- | --- |
| `runner_exit` | **0**（1 = oracle/语义差异；2 = 环境/adapter `BLOCKED`）。片段最后的 `exit` 必须等于 runner 的非零码，不能只看 summary 计数。 |
| `summary.json` | `scenarios == 53` 且 `gateScenarioCount == 53`，且 `blocked` / `failed` / `oracleFailures` 皆空 |
| 证据 | `/tmp/pilotdeck-agent-loop-parity/summary.json`（以及 runner 写出的 traces）；PR 把结论摘到 `review/<date>-<task>/evidence/` 或 PR 正文。不要把 `/tmp` traces 提交进 Git。 |

仅改 schema 生成器 / fixtures、**未**改 `validateModuleMessage` 行为且未改 parity runner/场景表时，可用检查 2 的合成 53 场景 replay 代替 live wire；在 PR 正文写明「parity = synthetic replay，非 live」。PR#5 即此口径。

负控制（必须 `BLOCKED`）见 `tools/agent-loop-parity/README.md`。

---

### 5. Rust adapter（自 T-P1-01 起同 PR 更新）

当前基线 `crates/pilotdeck-agent-loop-hello` 只做 hello/capabilities 握手，**没有**与 `validateModuleMessage` 对等的 Rust 校验。T-P1-01 落地之前本条记 **N/A**，并跑现有 crate 测试证明无回归。

```bash
cargo test --workspace
```

| 项 | 期望（T-P1-01 之前） |
| --- | --- |
| exit | **0** |
| 结论 | **N/A — 无 Rust 协议校验器可同步** |
| 证据 | `cargo test --workspace` 日志 |

T-P1-01 及之后：`crates/` 里对应校验 / 处理必须与协议改动 **同一 PR** 更新，再：

```bash
cargo test --workspace
```

| 项 | 期望（T-P1-01 起） |
| --- | --- |
| exit | **0** |
| 证据 | 测试日志；`crates/` diff 出现在同一 PR |

---

### 6. 版本号评估（protocolVersion / capabilitiesVersion）

改契约时必须书面评估是否升级，不能只改字段。用符号，不要依赖会漂移的行号。

- `MODULE_PROTOCOL_VERSION`（文件顶部，当前 `"2.0"`）
- `ModuleResponse.protocolVersion`
- `ModuleCapabilities.capabilitiesVersion` 与 `ModuleResponse.capabilitiesVersion`
- `storageConfigVersion` **不是**契约版本，禁止写进 `x-pilotdeck.contractVersions`

```bash
git grep -nE "MODULE_PROTOCOL_VERSION|capabilitiesVersion|storageConfigVersion" -- src/agent/modules/protocol.ts
```

在 PR 正文或 `review/<date>-<task>/evidence/version-eval.md` 写明三选一；若改了 `protocol.ts` 的校验/字段，同时逐处列出对应的 `scripts/lib/module-protocol-schema.mjs` 映射改动或 N/A（人工审查，局限 F-5）：

1. **不升级** — 向后兼容（只加可忽略 optional / 不改 accept 集）。
2. **升级 `MODULE_PROTOCOL_VERSION`** — 消息形状或必填/拒绝规则不兼容。
3. **升级协商的 `capabilitiesVersion`** — 能力广告变化，协议信封仍兼容。

`x-pilotdeck.contractVersions` 是 **annotation**，schema 不 enforce 这两个版本。

| 项 | 期望 |
| --- | --- |
| 命令 | 上面的 `git grep -nE` exit 0，能看到现行常量 |
| 输出物 | 一段「升级 / 不升级 + 理由」 |
| 证据 | PR 正文或 `review/<date>-<task>/evidence/version-eval.md` |

---

### 7. 证据：干净树、gitSha、gitDirty=false

仍读同一次 `$PROTOCOL_REPLAY_OUT`，**不要再跑 replay**。

```bash
git status --porcelain
git rev-parse HEAD
python3 -c 'import json,os,subprocess,sys
head=subprocess.check_output(["git","rev-parse","HEAD"], text=True).strip()
r=json.load(open(os.path.join(os.environ["PROTOCOL_REPLAY_OUT"],"replay-report.json")))
print("gitSha", r["gitSha"])
print("gitDirty", r["gitDirty"])
print("HEAD", head)
sys.exit(0 if r["gitSha"]==head and r["gitDirty"] is False else 1)'
```

| 项 | 期望 |
| --- | --- |
| `git status --porcelain` | 空 |
| python exit | **0** |
| 打印 | `gitSha` == `git rev-parse HEAD`（采集时 HEAD）；`gitDirty False` |
| 证据 | `$PROTOCOL_REPLAY_OUT/replay-report.json` 的 `gitSha` / `gitDirty` |

---

## 已知局限（必须带着责任任务）

| ID | 局限 | 责任 |
| --- | --- | --- |
| **F-5** | Schema 结构在 `scripts/lib/module-protocol-schema.mjs` **手写映射**。只有版本常量、`MODULE_CALL_TARGETS`、`isOutcome` 枚举从源码抽取，外加锚点断言。validator 新增规则或类型上新增字段时，生成器不一定报错，1a/1b 可能仍 PASS。漂移防护 = replay（检查 2–3）+ 人工审查。后续可用路径触发 CI 跑 generate+replay，但 **CI 不在本 PR**。 | **T-P0a-07 本文档**（写明口径） / **日后 CI**（Payne 开绿灯后，可并入 T-P0a-04） |
| **R2-1** | 仓库 reject 方向只有手挑样本（20 负样本 + 9 个应拒边角）。建议在 replay 加确定性字段变异（逐键删除 / 替换为 10 种值），报告变异总数、拒数、错配数。本门禁列为**建议项**，不在本任务实现。 | **T-P0a-04** |
| **R2-3** | 生成 schema 的 `description` 仍可能写 "Generated from"。对外口径统一为 **hand-mapped + source anchors + replay**。 | 本文档；改生成器文案可另切片 |

### 建议项（R2-1，不阻塞本门禁）

实现放 T-P0a-04：对每条 accept 样本逐键删除，并把标量替换为 `null` / `""` / `0` / `-1` / `[]` / `{}` / `true` / `"x"` / 超长字符串 / 错误类型，统计变异数 / 双方 reject 数 / 错配数。本任务只要求在触及触发路径的 PR 里**意识到**手挑负样本覆盖不够。

---

## Contributing

完整片段与**可复制命令块**见仓库根 [CONTRIBUTING.md](../CONTRIBUTING.md)。触及触发路径的 PR 必须按本页 1–7 执行，并在 PR 正文逐项打勾或写 N/A 理由。

---

## A3 演练：用 PR#5（T-P0a-01）回溯本清单

PR#5：`pilotdeck-rust/T-P0a-01-protocol-schema`，合入 `1da663a2`。该 PR **未改** `validateModuleMessage` 行为；新增 hand-mapped schema + replay。下面按本门禁逐项打勾（证明清单可执行，不是要求 PR#5 补做 live parity）。

| # | 检查 | PR#5 | 说明 |
| --- | --- | --- | --- |
| 1 | schema regen + 二次空 diff | ✅ | generate 写出 `evidence/schema/module-protocol.schema.json`；replay `A1.fileMatchesBuilder=true`，`A1.secondGenerationDiffEmpty=true`，`A1.dirtyTreeRefused=true`。未改 `docs/pilotdeck-module-protocol-v2.schema.json`。 |
| 2 | replay 可表达错配 0 | ✅ | `A2`：53 场景合成模板，648 条，648/0，`expressibleMismatches=0`。 |
| 3 | A3 样本 + 放宽对照 FAIL | ✅ | 20 负样本双方均拒；26 边角；`loosened-schema control: FAIL`。 |
| 4 | parity 复跑 | ✅ N/A（已声明） | 无运行时协议改动。A2 用合成模板，**不是** live wire。 |
| 5 | Rust adapter | ✅ N/A | T-P1-01 未开始；hello crate 未改。 |
| 6 | 版本评估 | ✅ 不升级 | `protocolVersion.value=2.0`；`capabilitiesVersion` negotiated / annotation。 |
| 7 | gitSha + gitDirty=false | ✅ | 当时跟踪报告 `gitSha=b328626a…`，`gitDirty=false`。 |

复现用下面 CONTRIBUTING 命令块（一次 replay + restore），不要连续跑三次 replay。

---

## 本任务空跑（文档 PR 自身）

本 PR 不改 `src/`、不改 CI、不改依赖。对**本 PR 树**按 CONTRIBUTING 命令块连跑 1a / 1c / 一次 replay / 2 / 3 / 5 / 6 / 7，树须保持干净。检查 4 按 PR#5 口径记 N/A。G2/G3 空跑日志在 `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/`。
