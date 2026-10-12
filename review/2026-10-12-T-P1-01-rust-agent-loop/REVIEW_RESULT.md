# REVIEW_RESULT — T-P1-01 PR-A Round-1（Eveosev/PilotDeck#8, draft）

- Reviewer: Claude（只读审阅；未 fetch/提交/推送/评论/ready/merge，PR 仍为 draft）
- 范围：`PR.diff` = `git diff 1da663a2..804b9ed5`（code `29babbc7`，41 files）；DECISION.md、QA-ACCEPTANCE.md、PROGRESS.md、`qa-gate-5ea8d3ce/`、`qa-gate-804b9ed5/`（权威）
- 对照源：本地 `1da663a2` 上的 `src/agent/modules/protocol.ts`、`src/agent/modules/transport/{agentLoopSidecarServer,agentLoopSidecarClient,moduleRuntime}.ts`、`evidence/schema/module-protocol.schema.json`、`.github/workflows/rust-hello.yml`、`rust-toolchain.toml`
- 方法说明：本地没有 `804b9ed5`/`29babbc7` 对象。为遵守"只写 REVIEW_RESULT.md"，没有执行 `git fetch`，也没有在本地重建或编译代码。下面的 crate 行号都由 `PR.diff` 新文件 hunk 换算得到（新文件第 L 行 = hunk 起点 + L）。凡标"推演"的结论，都是读代码得出、没有实际运行过。

## 结论：**fail（Round-1）**

按 REVIEW_PROMPT §3（Payne，阻断项）"有存活变异体就不能通过"，F-1 已构成阻断：§3 原文点名的变异"sleep_cancellable 忽略 cancel flag"，在现有测试下可以存活，而 QA 没有跑这个变异。修起来很便宜，只需改测试，不用改实现；改完后请 QA 补跑 M7 组变异。F-2、F-3 应在 ready 前一并修掉。其余是 major/minor，可以在 DECISION 里显式延后。B4 依 21:23 决策**不计入** PR-A，未因 B4 判 fail。

除 F-1 之外，PR-A 主体质量良好：
- 验证器与 `validateModuleMessage` 逐条对齐；
- Value-first 与 last-wins 落实到位；
- 范围干净；
- 9 个变异对照中 8 个直接命中目标（mc 为 manifest 字符串检查）。

---

## 1. 验收映射核对

| QA 项 | 代码（PR 内行号） | 测试 / 证据 | 结论 |
|---|---|---|---|
| B1 hello/capabilities | `protocol.rs:126-132`（handshake 需 payload record）；`sidecar.rs:149-156,399-433` | `protocol::hello_and_capabilities_require_payload_object`、`sidecar::hello_capabilities_handshake`、`sidecar_stdio.rs:9`（s0） | ✅ |
| B1 execute / final⇒outcome / 禁 attemptId·stepId / 事件不带 binding | `protocol.rs:137-183`（attemptId/stepId :176）、`:230-265`（event final⇒outcome :249，禁 binding :258）、`:267-279`（response）；`sidecar.rs:191-275,465-529` | `execute_rejects_missing_fields_and_forbidden_ids`、`event_and_response_enforce_…`、`sidecar_stdio::s1_execute_rejects_forbidden_fields` / `s1_execute_rejects_step_id`（缺口 4 已补） | ✅（与 TS `protocol.ts` execute/event/response 分支逐条比对一致，包括 `"x" in message` 与 `has_key` 等价，`!== undefined` 与 `get().is_some()` 等价，因为 JSON 里没有 undefined） |
| B1 cancel/status | `protocol.rs:213-228,96-102`；`sidecar.rs:277-360` | `cancel_and_status_validate_required_fields`、`cancel_mid_execute_matches_ts_outcome`、`cancel_unknown_and_status_unknown`、`status_and_stale_cancel_…`、`timeout_cancel_is_result_unknown` | ✅ 语义对齐 TS `agentLoopSidecarServer.ts:169-192`（identity、`timeout:{runId}` 映射为 result_unknown、UNKNOWN_OPERATION / IDENTITY_MISMATCH） |
| B1 schema + TS 双判定，错配 0 | `scripts/roundtrip-validate.mjs` | re-gate：emitted 19 → ajv 19 / TS 19，mismatch 0；invalid 20 → ajv / TS / Rust 三方全拒，mismatch 0 | ⚠️ 数字成立，但 19 条中有 3 条不能由仓内测试复现，见 **F-3** |
| B2 resume/ack 返回定义好的错误 | `sidecar.rs:160-169`（RESUME_UNSUPPORTED / ACK_UNSUPPORTED，与 TS `controlFailure` 一致） | `resume_and_ack_are_valid_protocol_but_out_of_scope_for_sidecar`、`s2_…`；变异 m4/m5 均 FAIL | ✅ |
| B4 TS host ↔ Rust | 无 | **延至 PR-B**（DECISION 21:23） | 不计分；对 PR-B B4 门禁的意见见 §5 和 **F-5** |
| B5 malformed / unknown kind / cancel ≤2s | `protocol.rs:349`；`sidecar.rs:110-118`；`sleep_cancellable :599-610` | `rejects_invalid_json_and_unknown_kind`、s0 的 `{truncated`、`sidecar_stdio.rs:201` 的 ≤2s 断言 | ❌ ≤2s 锁定无效，见 **F-1**；非 UTF-8 帧会让进程崩溃，见 **F-2** |
| B6 范围 + build/test/clippy | — | re-gate：`cargo clean` 后 clippy `-D warnings` exit 0，日志含 `Checking pilotdeck-agent-loop`（PR 自带的 cargo-clippy.txt 也已含新 crate） | ✅（工具链是 1.85.1，见 **F-8**） |
| B7 确定性 / 无网络 | — | cargo-test-1/2：30/0，测试名一致 | ✅（emitted 语料内容有竞态，见 F-3） |
| Lock + base 对照 | `tests/lock.rs` | base exit 101（包不存在）。这只证明"crate 是新的"，真正锁行为的是变异组 | ✅（弱对照，已由变异组补足） |

## 2. 锁定决策核对

| # | 决策 | 核对 | 结论 |
|---|---|---|---|
| 1 | stdio first，S4 再加 TCP | 全 diff 无 `TcpListener`/`std::net`；`stdio.rs` 只用 stdin/stdout；capabilities 声明 `transport:"stdio"` | ✅ |
| 2 | 新 crate，hello 不动 | 41 个文件中没有 `crates/pilotdeck-agent-loop-hello/**`；re-gate hello diff 为空；根 `Cargo.toml` 只追加 member | ✅ |
| 3 | 重复键 last-wins，Value-first，禁止 derive | grep `Deserialize\|from_str::<\|from_slice\|from_reader\|serde::` 只命中 `protocol.rs:349` 的 `from_str::<Value>` 和一条 doc 注释；依赖只有 `serde_json = "1"`；`execute_duplicate_keys_last_wins_like_json_parse` 已改走 `parse_json_line`（缺口 5），re-gate m6 下三处测试全部 FAIL | ✅ |
| 4 | PR-A = S0–S2，PR-B = S3–S4 | 没有 S3 serde 七项，也没有 TCP | ✅ |
| 5 | 不改 src/CI/deps | 没有改 `src/`、`.github/`、`ui/`、`packages/`、`package*.json`；`Cargo.lock` 只新增 `pilotdeck-agent-loop`（dep 是 base 已有的 `serde_json`） | ✅ |
| 6 | 先 Value，再手写校验；typed struct 放 T-P1-07 | `protocol.rs` 全手写，`Validation` 只做输出类型 | ✅ |
| 7 | B4 延至 PR-B | 已登记 | ✅ |

## 3. 变异对照核对（re-gate `qa-gate-804b9ed5/mutations/`）

我逐个看了 `*.patch`、`*.exit`（全部 101）和日志里的 panic 位置：

| # | 补丁是否命中声称的代码 | 日志中 FAIL 的测试（panic 位置） | 判定 |
|---|---|---|---|
| m1 | ✅ `protocol.rs:176` 去掉 attemptId 判断 | `execute_rejects_…`（protocol.rs:414）、`invalid_messages_…`（roundtrip.rs:165）、`s1_execute_rejects_forbidden_fields`（sidecar_stdio.rs:114） | 被杀 |
| m2 | ✅ 同一行去掉 stepId 判断 | 同上三类，stdio 侧是 `s1_execute_rejects_step_id`（:133） | 被杀（首轮"只有单测覆盖"的缺口已补） |
| m3a | ✅ `sidecar.rs:299` cancel flag 永不置位 | `cancel_mid_execute`（:859）、`timeout_cancel`（:882）、`s2`（:215，outcome 断言） | 被杀 |
| m3b | ✅ flag 延迟 2.5s 才置位 | 同 m3a | 被杀 |
| m3c | ✅ cancel 路径阻塞 2.1s | `s2`（:201，"took 2.10s"） | 被杀 |
| m4 / m5 | ✅ `sidecar.rs:163/168` 改为 *_OK | `status_and_stale_…`（:921/:925）、`s2`（:209/:210） | 被杀 |
| m6 | ✅ `parse_json_line` 改为 first-wins | 3 个测试（protocol.rs:456/634，sidecar.rs:824） | 被杀 |
| mc | ✅ rust-version 改为 1.85 | `crate_rust_version_matches_hello_msrv`（lock.rs:76） | 被杀，但只锁住了 manifest 字符串，不代表 MSRV 能编译 |

**缺失的一组：** §3 原文要求的"ignore cancel flag in sleep_cancellable / raise stub delay"，QA 没有跑。我推演的结果是这组会存活，详见 F-1。另外 re-gate 实际有 **9** 个变异，不是 SUMMARY 和 dispatcher 说的 11 个。`5ea8d3ce` 那一组跑在旧代码上，不能叠加计数。

---

## 4. Findings

### F-1 【blocker】cancel ≤2s 的锁定无效：sleep_cancellable 类变异体存活（推演，置信度高）
- **位置**：
  - `crates/pilotdeck-agent-loop/tests/sidecar_stdio.rs:148`（`delayMs: 800`）、`:201`（`elapsed <= 2s`）；
  - `src/sidecar.rs:840`、`:866`（单测 `delayMs:400`）；
  - 实现在 `src/sidecar.rs:599-610`（sleep_cancellable）、`:496`（发完 agent.message 后的二次 cancel 检查）。
- **证据**：stub 的 delay（800ms / 400ms）**小于**断言的上界 2s，而 `sleep_cancellable` 在循环结束后还会 `return cancel.load()`（:609），`:496` 也会再查一次 flag。下面三个变异体都会通过全部 30 个测试：
  - (a) 删掉循环内的 `if cancel.load() { return true }`（:602）：睡满 800ms 后返回 true，于是 outcome=cancelled，耗时 0.8s ≤ 2s，s2、st-done 和两个单测都 PASS；
  - (b) `sleep_cancellable` 改成 `thread::sleep(delay); false`：发出 agent.message 后，在 :496 走 cancelled terminal（sequence=1），所有 outcome 断言仍是 cancelled，照样 PASS；
  - (c) `STUB_POLL_MS`（:15）调到 5000：一次 slice 取 min(800, 5000)，结果同 (a)。

  m3a/m3b 只破坏了**置 flag** 的一端，m3c 只在 cancel 处理路径里注入延迟，都没有覆盖"执行端不及时响应 flag"这一侧。§3 要求锁住的恰恰是这一侧。
- **修复**（只改测试）：
  - s2 和 `cancel_mid_execute` 的 `delayMs` 改为 ≥5000（比如 10_000）；
  - 断言 terminal 在 2s 内到达；
  - 断言 terminal 的 `sequence == 0`，且 terminal 之前**没有** `agent.message`；
  - 单测加 `Instant` 计时，断言 `elapsed < delay`。

  修完后由 QA 补跑 M7a/b/c（即上面三个变异），三者都必须 exit 101。

### F-2 【major】非 UTF-8 帧会让 sidecar 退出（exit 1），活动 execute 不发 final 就被丢弃，违反 B5
- **位置**：`src/stdio.rs:25-26`（`stdin.lock().lines()` 后接 `let line = line?;`）、`:32`（`sidecar.join()` 被跳过）、`src/main.rs:4-6`。
- **证据**：`BufRead::lines()` 遇到非法 UTF-8 返回 `Err(InvalidData)`，`?` 让 `serve_stdio` 直接返回，于是 `main` 打印 "stdio sidecar failed" 并 `exit(1)`。正在跑的 stub 线程随进程一起被杀，host 收不到 final event。TS 端（`agentLoopSidecarServer.ts:107-123`，readline）会把这类输入当普通坏帧处理：先做替换字符解码，JSON.parse 失败则回 `INVALID_JSON`，然后继续服务。B5 的要求是"malformed / truncated frame → error not crash"。
- **修复**：改用 `read_until(b'\n')` 加 `String::from_utf8`。解码失败时发 `INVALID_JSON` error 并 `continue`，或者先 `from_utf8_lossy` 再交给 `handle_line`，以对齐 Node 的行为。再补一条 stdio 测试：先写入 `b"\xff\xfe\n"`，再发 hello，断言能收到 INVALID_JSON 和 hello 回复，且进程仍然存活。

### F-3 【major】emitted 往返证据中有 3 条不能由仓内测试复现；live 测试没有覆盖 completed 路径，且语料有竞态
- **位置**：`evidence/t-p1-01/emitted-messages.json:247` 起（`source:"rust-sidecar-completed"`，`inReplyTo:"ex-done"`，pid 后缀 `15d0`；主运行的后缀是 `1587`）；`tests/roundtrip.rs:15-129`（只发 `ex-1`，并紧跟一个 cancel）；`:25`（`delayMs:80`）。
- **证据**：`rust_emitted_messages_roundtrip_schema_and_ts` 里没有任何不带 cancel 的 execute，所以 live 跑 ajv+TS 时**从来没有校验过 `agent.message` 和 `agent.execute.completed`**。这两类恰好是 S1"final⇒outcome"最核心的 Rust 输出，现在只有 Rust 自己的 validator 在单测里检查过（`sidecar.rs:812-813`）。evidence 里的 19 条，是把仓外另一次运行得到的 3 条拼进来的；re-gate 的 `accept-report.json` 也是对这份静态文件跑的。此外 `ex-1` 的 80ms 与 cancel 在竞速，每次跑出的语料可能是 cancelled，也可能是 completed，不满足 B7"同样结果"的精神。
- **修复**：
  - 在 roundtrip 测试里加一个独立的 `ex-done`（不 cancel，等它的 completed final）；
  - `ex-1` 的 delay 拉到 ≥2000，让 cancel 稳定赢；
  - 用测试的实际输出重新生成 `emitted-messages.json`，可以加一个 env 开关让测试落盘；
  - QA 以 live cargo test 为准，而不是对静态文件跑脚本。

### F-4 【major】deadline 语义与 TS sidecar 不一致：没有运行期 deadline 计时，ISO 解析也偏窄
- **位置**：`src/sidecar.rs:217`、`:677-689`（只在开始时检查一次）；`src/time.rs:27`（`strip_suffix('Z')?`）。对照 TS `agentLoopSidecarServer.ts:223-253`、`:697-702`。
- **证据**：TS 在 deadline 未到期时会 `setTimeout(abortForDeadline)`，执行中途到期就产出 `result_unknown` / `DEADLINE_EXCEEDED`。Rust 只在 accept 前判断一次：`operationDeadline = now+100ms` 加 `delayMs = 500` 的组合，TS 判 result_unknown，Rust 判 completed。另外 TS 用 `Date.parse`，接受 `+08:00` 这类偏移；Rust 只认 `Z`，所以一个**已过期**的 `2026-10-12T08:00:00+08:00` 会被当成"没有 deadline"，照常执行。DECISION 风险 3 和 S2 验收写的都是"outcome 与 TS sidecar 一致"。
- **修复**（二选一）：
  - 在 PR-A 内补上：stub 线程在 `sleep_cancellable` 里同时比较 deadline，到期就置 `deadline_exceeded` 和 cancel；`parse_iso_ms` 支持 `±HH:MM`；各补一条测试。
  - 或者在 DECISION 里显式写明"运行期 deadline 延至 PR-B/S3"，并在 PR-B 验收中列为必过项。

### F-5 【major，前瞻；不阻断 PR-A】stub 的 final payload 不能被 TS host 消费，PR-B 的 B4 必然失败
- **位置**：`src/sidecar.rs:517-526`（completed：`result:{type,stopReason,turns}`，没有 `sessionId`/`turnId`；`messages:[{role,content}]`）、`:562`（cancelled 的 `payload:{}`）。对照 `agentLoopSidecarClient.ts:1320-1327`（readTerminal）、`~1406-1412`（assertTerminalResult 要求 `result.sessionId/turnId` 与 input 一致）、`:1452-1461`（isAgentTurnResult 要求 sessionId/turnId 是 string）。
- **证据**：host 收到 completed 后会抛 "Sidecar terminal payload does not contain an AgentLoop result."；cancelled 时还要求 `result.type === "aborted"`。schema 和 validator 都放行这些消息（payload 是开放 record），所以 PR-A 的门禁抓不到。这正是 DECISION 风险 2 预言的"stub 形状不一致，要到后面才暴露"。
- **修复**：stub 从 execute 顶层回显 `sessionId`/`turnId`（host 在 `agentLoopSidecarClient.ts:751-752` 发送了这两个字段），result 补齐 `AgentTurnResult` 的必需字段；cancelled 给出 `type:"aborted"` 的 result 和 messages。可以在 PR-A 顺手修，也可以作为 PR-B 进入 B4 前的显式前置项。

### F-6 【minor】cancel 不带 requestId 时，响应写出 `"requestId": null`，而 TS 是省略该键
- **位置**：`src/sidecar.rs:281-284`、`:313`、`:327`；对照 TS `agentLoopSidecarServer.ts:187`（`requestId: message.requestId` 为 undefined，JSON.stringify 会丢掉）。
- **证据**：schema 的 response 对 requestId 不设约束，ajv 和 TS validator 都放行，但字节形状与 TS 不同。host 侧存在 `message.requestId !== this.requestId` 这类比较。emitted 语料里没有覆盖这条路径（单测 `status_and_stale_…` 里的 `cancel-s` 会走到，但没有过 ajv/TS）。
- **修复**：只在 `Some` 时插入 requestId 键；把"不带 requestId 的 cancel"加进 roundtrip 语料。

### F-7 【minor】三方判定只比较 accept/reject 布尔值，不比较拒绝码；关于 Rust 判定的独立性
- **位置**：`scripts/roundtrip-validate.mjs:110-111`（`tripleMatch` 只比 `rustOk === tsOk`）；`tests/roundtrip.rs:164-165`（Rust 判定由 live 计算）。
- **独立性结论**：cargo test `invalid_messages_rejected_by_ajv_ts_and_rust` 在测试进程内调用真实的 `validate_module_message`，逐条断言拒绝（m1/m2 在 :165 失败，证明它是活的），然后把结果交给 node 做 ajv 和 TS 判定。**这一路足够独立。** QA 独立跑出的 `invalid-report.json` 用的是提交进仓的 `rust-decisions.json` 快照，会随代码漂移，只能当佐证，不应作为主证据。
- **修复**：脚本里加一项 `rust.code === validateModuleMessage(...).code` 的码级比较，因为全语料都是负样本，码级一致才算真正对齐。门禁以 live 测试为准。

### F-8 【minor】MSRV 1.83 只锁了字符串；provenance 中 "toolchain":"1.83.0" 缺少实测依据
- **位置**：`evidence/t-p1-01/provenance.json:10`；`tests/lock.rs:69-80`。
- **风险评估（低）**：
  - 新代码用到的最新 API 是 `Option::is_none_or`（1.82 稳定，见 `protocol.rs:217,283`、`sidecar.rs:292`），其余是 `is_some_and`（1.70）、let-else（1.65）、`split_once` 等，没有发现 ≥1.84 的 API 或语法；edition 2021。
  - 依赖与 hello crate 完全相同（serde_json 1.0.154 / serde_core / zmij / itoa / memchr），CI 已经在 1.83.0 上编译过它们。
  - `.github/workflows/rust-hello.yml` 会因 `crates/**`、`Cargo.toml`、`Cargo.lock` 的改动触发，用 `dtolnay/rust-toolchain@1.83.0` 在虚拟 workspace 根执行 `cargo build --release`，也就是会编译新 crate 的 lib+bin。但它**不编译 tests，也不跑 clippy**。
- **修复**：ready 前附上 PR #8 的 rust-hello check 结果，或者跑一次 `cargo +1.83.0 test -p pilotdeck-agent-loop && cargo +1.83.0 clippy -p pilotdeck-agent-loop --all-targets -- -D warnings`。provenance 改为记录 `rustc -V` 的实际输出；如果实际不是 1.83.0，就改正该字段。

### F-9 【minor】execute 重入与 operation 生命周期和 TS 有细微差异
- **位置**：`src/sidecar.rs:362-375`（accept_operation）、`:579-582`（record_final 遇到已有 outcome 就早退）。
- **证据**：
  - 对一个已经结束、不再 active 的 operationId，用**不同 runId** 再 execute：TS 在 `moduleRuntime.ts:30` 抛 `OPERATION_RUN_MISMATCH`，Rust 静默接受并跑 stub。
  - 用同一 runId 再 execute：Rust 会发出新的 completed final，但 status 仍是第一次的 outcome。
- **修复**：在 accept 时比对 runId，不一致就回 `OPERATION_IDENTITY_MISMATCH`。也可以留到 T-P1-03 parity，但要登记。

### F-10 【minor】handle_execute 先检查、后插入不是原子操作；JoinHandle 只增不减；delayMs 不设上限
- **位置**：`src/sidecar.rs:197-238`（active 检查与插入之间锁被释放）、`:274`（joins 一直累积）、`:612-618`（`delayMs` 取自 wire payload，任意 u64）、`:501-528`（record_final 与 clear_active 之间的窗口里，cancel 仍会回 `ok:true`）。
- **证据**：目前 stdio 是单线程 dispatch，所以无害。但 `Sidecar::handle_line(&self)` 是 pub 的，S4 引入 TCP 多连接后会出现竞态。长连接下 handle 无限增长。stdin EOF 后 `join()` 会等一个 wire 指定的超长 delay，等同于进程挂起。
- **修复**：PR-B 时把检查和插入合进同一把锁；完成即回收 handle（或改用 `thread::Builder` 加 detach 计数）；给 `delayMs` 设上限（比如 60s）。

### F-11 【minor，按 F-7 policy 不阻断】`review/2026-10-12-T-P1-01-rust-agent-loop/evidence/**`（13 个文件）与 `evidence/t-p1-01/**` 重复，merge 前应删除。

### F-12 【minor，文档】
- re-gate 实际是 9 个变异（m1, m2, m3a, m3b, m3c, m4, m5, m6, mc），不是 11 个。
- PROGRESS.md 第 5–6 行仍写 tip `5ea8d3ce`、34 files，与当前的 804b9ed5 / 41 files 不符；PROGRESS 第 28 行写的 "toolchain 1.83.0" 与 QA 实测的 1.85.1 冲突（见 F-8）。

---

## 5. 对 PR-B 中 B4 门禁定义的意见
1. **口径不一致**：QA-ACCEPTANCE 第 6 行写的是 hello→capabilities→execute→status→cancel，DECISION 21:23 写的是"一条 pure_text，整 turn 正常收尾"。请统一，建议两者都要：一条 completed turn，加一条 cancel turn。
2. **指定被测的 host 入口**：明确用 `AgentLoopSidecarClient` + `stdioAgentLoopSidecarConnection`（后续 TCP 用 `tcpAgentLoopSidecarConnection`）。通过标准要写成"`AgentLoop.run` 返回 `result.type==="success"`（cancel 轮为 `aborted`），sessionId/turnId 与 input 一致，没有抛错"，而不是只看进程 exit code。这一条目前必然失败，见 F-5。
3. **"base FAIL 对照"本身偏弱**：base 上没有这个二进制，spawn 失败只能证明"crate 是新的"。建议改用或追加变异对照，例如去掉 final 的 `outcome`、改坏 `result.turnId`、让 cancel 不生效，要求 E2E 必须 FAIL。
4. **S4 TCP 重跑**：要求同一套 B1/B4 用例在 `--listen 127.0.0.1:0` 下逐条重跑，并记录实际端口与连接参数。

## 6. Round-2 前的最小清单
- [ ] F-1：拉长 delay，加 sequence/agent.message 断言，单测加计时；QA 补跑 M7a/b/c，全部 exit 101（**阻断**）
- [ ] F-2：非 UTF-8 帧回 INVALID_JSON 而不是退出，并补 stdio 测试
- [ ] F-3：roundtrip live 语料加入 completed 路径并消除竞态，evidence 由测试输出重新生成
- [ ] F-4 / F-5：PR-A 内修复，或在 DECISION 中显式延后并写进 PR-B 必过项
- [ ] F-8：附 1.83.0 编译/测试结果（rust-hello CI 或本地 `+1.83.0`）
- PR 保持 draft。
