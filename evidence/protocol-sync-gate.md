# T-P0a-07 Module Protocol 变更同步门禁

- 任务：T-P0a-07（文档先行，**不做 CI / git hook**）
- 基线：`rust_standalone_alpha1@1da663a2`
- 原则：**同步，不冻结**。`src/agent/modules/protocol.ts` 可以改，但必须在**同一 PR** 内把 schema / replay / 样本 / parity / Rust adapter（自 T-P1-01 起）/ 版本评估 / 干净树证据一起落地。
- Schema 口径（R2-3）：**hand-mapped + source anchors + replay**，不是从 TypeScript 类型自动推导。生成器只从源码抽取版本常量、`MODULE_CALL_TARGETS`、`isOutcome` 枚举，并断言若干 `validateModuleMessage` 锚点。
- 触发：任一 PR 触及 `src/agent/modules/protocol.ts`（含仅改注释以外的契约或校验逻辑）。

CI 路径触发自动检查**不在本任务**。Payne 已锁定：门禁文档过 Reviewer 后再开绿灯（可并入 T-P0a-04）。

## 适用范围

| 改动 | 是否走本门禁 |
| --- | --- |
| `src/agent/modules/protocol.ts` 契约或 `validateModuleMessage` | 是 |
| 仅更新 `evidence/schema/**` / fixtures / 本文件 | 按对应检查执行；不强制 live parity |
| `crates/` Rust adapter（T-P1-01 起） | 是（检查 5）；须与 `protocol.ts` 同 PR |
| 未改 `protocol.ts` 的普通功能 PR | 否 |

## 前置：干净树

`scripts/generate-module-protocol-schema.mjs` 与 `scripts/replay-module-protocol-schema.mjs` **拒绝脏树**（exit 2）。先提交 `protocol.ts`，再生成 / replay。

```bash
git status --porcelain
git rev-parse HEAD
```

| 项 | 期望 |
| --- | --- |
| `git status --porcelain` | 空（无输出） |
| exit | 0 |

---

## 检查清单（1–7）

每条都给出：**精确命令**、**期望输出 / 退出码**、**证据路径**。

### 1. Schema 重生 + 二次生成 diff 为空

重跑生成器，提交更新后的 `evidence/schema/module-protocol.schema.json`。若本次契约改动也影响已发布的 v2 profile，同一 PR 更新 `docs/pilotdeck-module-protocol-v2.schema.json`（该文件是手写 profile schema，**不是**生成器输出；生成器只写 evidence 副本）。

**1a. 重生前：builder 输出 vs 磁盘 schema（捕获未同步）**

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
| `protocol.ts` 已改、尚未 regen | **FAIL schema-stale**，exit **1**（可抽取契约变化时必须如此） |
| 已 regen 并提交 schema | **PASS schema-current**，exit **0** |
| 证据 | 命令 stdout；PR 内 `git diff -- evidence/schema/module-protocol.schema.json` |

类型上新增 optional 字段、或只改 `validateModuleMessage` 里未被抽取/锚定的规则时，1a 可能仍 PASS。这是 **F-5**，不能单靠本条放行。

**1b. 第一次生成**

```bash
node scripts/generate-module-protocol-schema.mjs
git diff -- evidence/schema/module-protocol.schema.json
```

| 项 | 期望 |
| --- | --- |
| exit（generate） | **0** |
| stdout | `generated evidence/schema/module-protocol.schema.json from src/agent/modules/protocol.ts` 以及 `protocolVersion=…` / `capabilitiesVersion=capabilitiesVersion` / `notContract=storageConfigVersion` |
| 脏树 | exit **2**，stderr 含 `dirty` |
| 契约可抽取变化 | `git diff` **非空**；把新 schema 纳入同一 PR |
| 无契约抽取变化 | `git diff` 空；继续用 replay（检查 2）抓 validator 漂移 |
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
| 证据 | 空 diff；replay 报告 `A1.secondGenerationDiffEmpty=true`（`evidence/schema/replay-report.json`） |

`docs/pilotdeck-module-protocol-v2.schema.json` 不由本脚本覆盖。若 SOP 字段 / 枚举变了，人工改该文件并在 PR 说明。

---

### 2. Replay：可表达错配 = 0

```bash
node scripts/replay-module-protocol-schema.mjs
```

| 项 | 期望 |
| --- | --- |
| exit | **0** |
| stdout JSON | `A2.expressibleMismatches === 0`；`A2.inexpressibleRules === 0`（不可表达规则若出现须单列，不得靠放宽 schema 凑零） |
| stdout JSON | `A1.ok === true`（可复现 + 拒脏树） |
| 失败 | exit **1**，stderr `T-P0a-01 acceptance failed`；或脏树 exit **2** |
| 语料 | 53 条 `tools/agent-loop-parity` 场景的**合成模板**（不是 live wire） |
| 证据 | `evidence/schema/replay-report.md`、`evidence/schema/replay-report.json`（含 `gitSha` / `gitDirty`） |

`expressibleMismatches !== 0` 即 schema 与 `validateModuleMessage` 对同一条样本一 accept 一 reject。必须先修映射或样本，禁止放宽 schema 来消零。

---

### 3. A3 负样本 / 边角更新 + 放宽 schema 对照 FAIL

契约或校验规则变化时，先更新：

- `evidence/schema/fixtures/negative-samples.json`（每消息类型 ≥1 条负样本；条件规则 `final-implies-outcome` / `forbidden-attemptId-stepId` / `forbidden-binding-on-event` 仍须有样本）
- `evidence/schema/fixtures/edge-samples.json`（`1.0` / `-0` / 指数 / 溢出 / 额外字段 / 空 id / `response.final` 非布尔 等）

然后重跑检查 2 的同一条命令：

```bash
node scripts/replay-module-protocol-schema.mjs
```

| 项 | 期望 |
| --- | --- |
| exit | **0** |
| stdout | `A3.allRejectedByBoth === true` |
| stdout | `A3.loosened === "FAIL"`（必须 FAIL；每条条件规则都要被放宽 schema 对照打出 mismatch） |
| report | `A3.missingMessageTypes` / `A3.missingConditionals` 为空；`A3.edgesMatchExpect === true` |
| 证据 | `evidence/schema/replay-report.md` 节「A3 negatives, edges, loosened control」；`evidence/schema/replay-report.json` 的 `A3`；fixtures 如上 |

放宽对照（`loosenSchema` 去掉 `allOf` 里的 `not` / `if`）若变成 `UNEXPECTED_PASS`，说明条件规则没有真正落到 schema 上，检查失败。

---

### 4. Parity：相关场景复跑

`protocol.ts` 改变运行时 accept/reject 或消息形状时，复跑 gateway sidecar 对拍（产品默认 transport 仍是 native；本命令只跑对拍）。

```bash
source ~/.nvm/nvm.sh && nvm use 22
pnpm build
python tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --scenario all \
  --output /tmp/pilotdeck-agent-loop-parity
python3 -c 'import json,sys; s=json.load(open("/tmp/pilotdeck-agent-loop-parity/summary.json"));
print("scenarios", s.get("scenarios"), "gate", s.get("gateScenarioCount"));
raise SystemExit(0 if s.get("scenarios")==53 and s.get("gateScenarioCount")==53 else 1)'
```

| 项 | 期望 |
| --- | --- |
| runner exit | **0**（1 = oracle/语义差异；2 = 环境/adapter `BLOCKED`，不得当成通过） |
| `summary.json` | `scenarios == 53` 且 `gateScenarioCount == 53` |
| 证据 | `/tmp/pilotdeck-agent-loop-parity/summary.json`（以及 runner 写出的 traces）；PR 把结论摘到 `review/<date>-<task>/evidence/` 或 PR 正文。不要把 `/tmp` traces 提交进 Git。 |

仅改 schema 生成器 / fixtures、**未**改 `validateModuleMessage` 行为时，可用检查 2 的合成 53 场景 replay 代替 live wire；在 PR 正文写明「parity = synthetic replay，非 live」。PR#5 即此口径。

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

T-P1-01 及之后：`crates/` 里对应校验 / 处理必须与 `protocol.ts` **同一 PR** 更新，再：

```bash
cargo test --workspace
```

| 项 | 期望（T-P1-01 起） |
| --- | --- |
| exit | **0** |
| 证据 | 测试日志；`crates/` diff 出现在同一 PR |

---

### 6. 版本号评估（protocolVersion / capabilitiesVersion）

改契约时必须书面评估是否升级，不能只改字段。

锚点（`protocol.ts`）：

- `MODULE_PROTOCOL_VERSION`（文件顶部，当前 `"2.0"`）
- `ModuleResponse.protocolVersion`（约 :212）
- `ModuleCapabilities.capabilitiesVersion`（约 :118）与 `ModuleResponse.capabilitiesVersion`（约 :216）
- `storageConfigVersion` **不是**契约版本，禁止写进 `x-pilotdeck.contractVersions`

```bash
git grep -n "MODULE_PROTOCOL_VERSION\|capabilitiesVersion\|storageConfigVersion" -- src/agent/modules/protocol.ts
```

在 PR 正文或 `review/<date>-<task>/evidence/version-eval.md` 写明三选一：

1. **不升级** — 向后兼容（只加可忽略 optional / 不改 accept 集）。
2. **升级 `MODULE_PROTOCOL_VERSION`** — 消息形状或必填/拒绝规则不兼容。
3. **升级协商的 `capabilitiesVersion`** — 能力广告变化，协议信封仍兼容。

`x-pilotdeck.contractVersions` 是 **annotation**，schema 不 enforce 这两个版本。

| 项 | 期望 |
| --- | --- |
| 命令 | 上面的 `git grep` exit 0，能看到现行常量 |
| 输出物 | 一段「升级 / 不升级 + 理由」 |
| 证据 | PR 正文或 `review/<date>-<task>/evidence/version-eval.md` |

---

### 7. 证据：干净树、gitSha、gitDirty=false

在**干净树**上跑检查 2（replay 会把 provenance 写入报告）：

```bash
git status --porcelain
git rev-parse HEAD
node scripts/replay-module-protocol-schema.mjs
python3 -c 'import json; r=json.load(open("evidence/schema/replay-report.json"));
print("gitSha", r["gitSha"]); print("gitDirty", r["gitDirty"]);
raise SystemExit(0 if r["gitSha"] and r["gitDirty"] is False else 1)'
```

| 项 | 期望 |
| --- | --- |
| `git status --porcelain` | 空 |
| replay exit | **0** |
| `replay-report.json` | `gitSha` == `git rev-parse HEAD`（采集时 HEAD）；`gitDirty === false` |
| 证据 | `evidence/schema/replay-report.json`、`evidence/schema/replay-report.md` |

replay 会重写报告文件。若报告相对采集前提交有 diff，把更新后的报告作为**单独证据提交**（采集 SHA = 该证据提交的 parent；不要把尚未产生的 evidence commit SHA 写进 JSON）。

---

## 已知局限（必须带着责任任务）

| ID | 局限 | 责任 |
| --- | --- | --- |
| **F-5** | Schema 结构在 `scripts/lib/module-protocol-schema.mjs` **手写映射**。只有版本常量、`MODULE_CALL_TARGETS`、`isOutcome` 枚举从源码抽取，外加锚点断言。validator 新增规则或类型上新增字段时，生成器不一定报错，1a/1b 可能仍 PASS。漂移防护 = replay（检查 2–3）+ 人工审查。后续可用路径触发 CI 跑 generate+replay，但 **CI 不在本 PR**。 | **T-P0a-07 本文档**（写明口径） / **日后 CI**（Payne 开绿灯后，可并入 T-P0a-04） |
| **R2-1** | 仓库 reject 方向只有手挑样本（20 负样本 + 9 个应拒边角）。建议在 replay 加确定性字段变异（逐键删除 / 替换为 10 种值），报告变异总数、拒数、错配数。本门禁列为**建议项**，不在本任务实现。 | **T-P0a-04** |
| **R2-3** | 生成 schema 的 `description` 仍可能写 "Generated from"。对外口径统一为 **hand-mapped + source anchors + replay**。 | 本文档；改生成器文案可另切片 |

### 建议项（R2-1，不阻塞本门禁）

实现放 T-P0a-04：对每条 accept 样本逐键删除，并把标量替换为 `null` / `""` / `0` / `-1` / `[]` / `{}` / `true` / `"x"` / 超长字符串 / 错误类型，统计变异数 / 双方 reject 数 / 错配数。本任务只要求在触及 `protocol.ts` 的 PR 里**意识到**手挑负样本覆盖不够。

---

## Contributing

完整片段见仓库根 [CONTRIBUTING.md](../CONTRIBUTING.md)。触及 `src/agent/modules/protocol.ts` 的 PR 必须按本页 1–7 执行，并在 PR 正文逐项打勾或写 N/A 理由。

---

## A3 演练：用 PR#5（T-P0a-01）回溯本清单

PR#5：`pilotdeck-rust/T-P0a-01-protocol-schema`，合入 `1da663a2`。该 PR **未改** `validateModuleMessage` 行为；新增 hand-mapped schema + replay。下面按本门禁逐项打勾（证明清单可执行，不是要求 PR#5 补做 live parity）。

| # | 检查 | PR#5 | 说明 |
| --- | --- | --- | --- |
| 1 | schema regen + 二次空 diff | ✅ | `node scripts/generate-module-protocol-schema.mjs` 写出 `evidence/schema/module-protocol.schema.json`；replay `A1.fileMatchesBuilder=true`，`A1.secondGenerationDiffEmpty=true`，`A1.dirtyTreeRefused=true`。未改 `docs/pilotdeck-module-protocol-v2.schema.json`（既有手写 profile，与 evidence 生成物不是同一份文件）。 |
| 2 | replay 可表达错配 0 | ✅ | `A2`：53 场景合成模板，648 条，648/0，`expressibleMismatches=0`。 |
| 3 | A3 样本 + 放宽对照 FAIL | ✅ | 20 负样本双方均拒；26 边角；`loosened-schema control: FAIL`（三条条件规则 `fail=true`）。 |
| 4 | parity 复跑 | ✅ N/A（已声明） | 无运行时协议改动。A2 用合成模板，**不是** live wire。PR 正文写明该口径。 |
| 5 | Rust adapter | ✅ N/A | T-P1-01 未开始；hello crate 未改。 |
| 6 | 版本评估 | ✅ 不升级 | `protocolVersion.value=2.0`；`capabilitiesVersion` negotiated / annotation；`storageConfigVersion` 非契约。 |
| 7 | gitSha + gitDirty=false | ✅ | `evidence/schema/replay-report.json`：`gitSha=b328626a…`（R1 代码提交），`gitDirty=false`；后续证据提交 `34767840`。 |

命令复现（在干净树、本基线或 PR#5 tip）：

```bash
node scripts/generate-module-protocol-schema.mjs
git diff --exit-code -- evidence/schema/module-protocol.schema.json
node scripts/replay-module-protocol-schema.mjs
```

---

## 本任务空跑（文档 PR 自身）

本 PR 不改 `src/`、不改 CI、不改依赖。对**本 PR 树**执行检查 1a / 1c / 2 / 3 / 5 / 6 / 7 应全部通过（无契约变化）。检查 4 按 PR#5 口径记 N/A。两次故意改 `protocol.ts` 的空跑（G2/G3）在临时分支进行、**不推送**，日志另提交于 `review/2026-10-12-T-P0a-07-protocol-change-gate/evidence/`。
