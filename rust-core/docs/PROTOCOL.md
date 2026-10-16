# Module Protocol 2.0 契约

> 这是 sidecar 与宿主之间**唯一**的接口。本文记录**必须保持**的部分。
> 加字段、改错误文案、调判定顺序都算协议改动——先读 §7 与 §8。

---

## 1. 两个协议，不要混

`pilotdeck-protocol/src/lib.rs:1-2`：

> Boundary compatibility for the fixed PilotDeck product. No host authority or IO.
> **Module 2.0 and Gateway 1.2 are deliberately separate protocols.**

| 常量 | 值 | 谁用 |
|---|---|---|
| `MODULE_PROTOCOL_VERSION` | `"2.0"` | 本 sidecar ↔ 宿主（agent 循环） |
| `GATEWAY_PROTOCOL_VERSION` | `"1.2"` | gateway（阶段 A，不在此仓） |

还有第三个独立的命名空间：**`capabilitiesVersion`**，本 sidecar 用 `"1"`。
三者不可混用；也不要把 gateway 的字段塞进 Module 信封。

> ⛔ 本仓已不含 gateway crate，但那两个常量的定义仍在 `protocol/src/lib.rs:14-15`。
> 不要「顺手」删掉 `GATEWAY_PROTOCOL_VERSION`。

---

## 2. 帧格式：NDJSON，无长度上限

**一行一个 JSON 对象，UTF-8，换行分隔。**

### 写出（sidecar → 宿主）

`stringify_json(value)` 之后追加 `\n`（`transport/src/stdio.rs:403-411`）。

- **stdout 只允许三类**：response · event · error envelope。
- 顶层 `undefined` 视为 `InvalidData: "Module output is undefined."`（`stdio.rs:410`）。
- **唯一**的非 NDJSON stdout 输出是 `--version`（且只在参数恰好为 `["--version"]` 时）。
- 所有诊断、Usage、初始化失败、关闭不完整报告一律走 **stderr**。

### 读入（宿主 → sidecar）

`read_until(b'\n')` → 去尾部 `\n` → 可选再去 `\r`（容忍 CRLF）→
`String::from_utf8_lossy` → 跳过「全部为 JS 空白」的行 → `parse_json`
（`transport/src/server.rs:756-775`；JS 空白定义在 `:1019-1021`）。

解析失败回一个 error 信封：`code: "INVALID_JSON"`，
message `"Module message is not valid JSON."`。

**没有长度上限。** 协议里没有声明任何帧大小限制，
`protocol/tests/codec.rs` 里有一条测试专门断言不存在未声明的 8 MiB 上限
（9 MiB 单字符串 + 20000 字段对象，验证线性）。

> ⚠️ 所以：**不要引入未在协议中声明的长度/大小上限**。那会变成对拍差异。

---

## 3. 值模型：`JsValue` 四态

Module 2.0 承载的是 **JavaScript 值**，不是 Rust 值。`protocol` 为此建了专门的类型。

### 3.1 `Presence` 四态

`protocol/src/wire.rs:8-31`：

| 态 | 含义 |
|---|---|
| `Missing` | 属性不存在（对象查找返回 `None`） |
| `Undefined` | 属性存在且值为 `undefined` |
| `Null` | 值为 `null` |
| `Value(_)` | 有值 |

四者**语义不同**，`ResponseRef.payload/error/final`、`EventRef.messageId`
必须保留四态（`wire.rs:216-217, 283-285`）——**stage-one 校验故意宽松**，
不要把这些可选字段的类型校验塞进 `validate_module_message`。

`Undefined` 与 `Missing` 的差别在序列化时也可见：

- 对象的 `own undefined` 属性 → **序列化时省略**，但**内存中必须还在**；
- 数组元素 `undefined` → 序列化成 `null`。

有测试固定这个行为：clone 之后 `attemptId: undefined` 仍能触发 `UNSUPPORTED_FIELD`，
但经一次 stringify/parse 往返就「消失」且校验通过（`protocol/tests/codec.rs:344-359`）。

### 3.2 `JsString` = UTF-16 code units

`protocol/src/lib.rs:17-19`：

> JavaScript strings contain UTF-16 code units, **including unpaired surrogates**.

- 内部是 `Vec<u16>`。**孤立代理是合法值**，出现在真实数据里。
- `to_utf8()` **显式可失败**（`lib.rs:34-37`）：*identifiers are never silently
  replacement-decoded*。
- 相等比较按 code unit 逐单元（`encode_utf16`），不做 UTF-8 往返。
- 必须有能力：解析 → 克隆 → 比较 → 再序列化成 `\uXXXX`。

> ⛔ **不要把 `JsString` 降级成 `String`。** 那会静默丢掉孤立代理。

### 3.3 数字：ECMAScript 语义，用 `ryu-js`

必须用 `ryu_js::Buffer::format_finite`（`protocol/src/codec.rs:284,299`）：

| 输入 | 输出 |
|---|---|
| `1e21` | `"1e+21"` |
| `1e20` | `"100000000000000000000"` |
| `9007199254740993` | `9007199254740992` |
| `1e-400` | `0` |
| `-0` / `0` | `"0"` |
| `NaN` / `±Infinity` | `null` |

（`protocol/tests/codec.rs:8-36`）

> ⛔ 不能用 serde_json 的数字输出——它不是 ECMAScript 的 `Number::toString`。

### 3.4 对象键序

`protocol/src/lib.rs:58`：*First insertion owns property order; later writes replace its value.*

序列化顺序（`codec.rs:211-226, 313-341`）：

1. **canonical 数组索引键**（全数字、无前导零、`< u32::MAX`）按**数值升序**在前；
2. 其余键按**插入序**在后。

`insert` 命中已存在的键时：**保留首槽位，替换值**（`lib.rs:85-92`；
测试 `tests/codec.rs:62-73`）。

`PartialEq` **只比 `entries`**，忽略 prototype 与 native tag（`lib.rs:122-126`）；
而 `JsValue::PartialEq` 明确**不是** `JSON.stringify` 身份（`lib.rs:185-187`）——
`-0 == 0`、`NaN != NaN`，键序参与比较。

### 3.5 明确拒绝的能力

`protocol` **不**执行 JS 函数 / getter / `Symbol.toPrimitive` / 原型链查找
（`consumer.rs:115-118`）；**不**声称支持 `Date` / `Map` / `Set` / 循环图 /
`structuredClone`（`model.rs:397-398, 417-419`）。

唯一的例外是**显式建模**的：`JsObject::set_prototype` 是「仅配置」，
不改变 own-property 检查与 JSON 编码；`get_property` 才走原型链（`lib.rs:93-116`）。

### 3.6 全部遍历非递归

`parse` / `stringify` / `clone` / `Debug` / `PartialEq` / `Drop` **全部用显式栈**。

- `codec.rs:1-2`：*All container traversal uses explicit stacks, including failure cleanup.*
- `lib.rs:222-244`：`Drop` 先清空容器再析构子节点，迭代式。
- `codec.rs:349-409`：`clone` 结尾 `assert_eq!(values.len(), 1, "clone traversal assembles one root")`。

测试用 **128 KiB 栈、深度 30000** 验证 parse/stringify/clone/Debug/Eq/drop 都不递归
（`tests/codec.rs:132-163`）。

> ⛔ 新写容器遍历代码必须照做，否则深度攻击会爆栈。

---

## 4. 信封

### 4.1 消息种类

`validate_module_message` 识别这些 `kind`（`protocol/src/module.rs`）：
`hello` · `capabilities` · `execute` · `cancel` · `status` · `resume` · `ack` ·
`module_call` · `event` · `response` · `error`。

`ModuleMethod` 枚举（8 个）是**能力协商用的方法名**：
`execute` · `cancel` · `status` · `resume` · `ack` · `module_call` · `hello` · `capabilities`。

### 4.2 序列约束

| 类型 | 约束 |
|---|---|
| `ModuleSequence` | 有限 ∧ 整数 ∧ ≥ 0（`wire.rs:33-42`） |
| `ResumeSequence` | ≥ -1（`wire.rs:43-52`） |

`wire.rs:32` 的注释很重要：
> Module integers have binary64 semantics; they are not SDK safe integers.

### 4.3 结果与状态

- `ModuleOutcome`：`completed` · `failed` · `cancelled` · `result_unknown`
- `OperationState` · `ExecuteProfile` · `ModuleTarget`（11 个） · `ModuleBinding`

---

## 5. 错误模型

**两套**，不要混：

### 5.1 本地校验失败 → `ValidationError`

```rust
// protocol/src/module.rs:65-69
pub struct ValidationError { code: &'static str, message: String }
```

已知错误码（部分）：
`INVALID_KIND` · `MISSING_MESSAGE_ID` · `INVALID_EVENT_FIELD` · `MISSING_OUTCOME` ·
`INVALID_OUTCOME` · `UNSUPPORTED_FIELD` · `MISSING_EXECUTE_FIELD` ·
`MISSING_MODULE_CALL_FIELD` · `INVALID_CANCEL_REQUEST` · `INVALID_STATUS_REQUEST` ·
`INVALID_RESUME_REQUEST` · `INVALID_ACK_REQUEST` · `INVALID_HANDSHAKE_REQUEST` ·
`INVALID_METHOD` · `INVALID_MODULE` · `INVALID_ERROR` · `INVALID_MESSAGE`（wire 层）

### 5.2 线错误信封

```jsonc
{ "kind": "error", "messageId": "...", "code": "...", "message": "...",
  "retryability": "safe" | "unsafe" | "retry_after_status" }
```

`Retryability`：`Safe` · `Unsafe` · `RetryAfterStatus`（`wire.rs:302-309`）。

**transport 自己产生的错误一律 `retryability: "unsafe"`**（`server.rs:846-854`）。

### 5.3 错误优先级 = 契约

**第一个**不合格的字段决定错误码，顺序被测试固定：

- **module 信封**：`kind` → `messageId` → 各 kind 内部字段的既有顺序（`module.rs:155-230`）。
- **admission**：`protocolVersion` → `moduleId` → `moduleInstanceId` →
  `connectionGeneration` → `capabilitiesVersion`；且 capabilities 的
  **mismatch 检查先于方法校验**（`consumer.rs:18-58, 61-113`）。

`consumer.rs:38-58` 的原话：
> Error order is significant even when several fields are invalid.

> ⛔ 改判定顺序 = 改协议行为。会被对拍抓到。

### 5.4 被显式拒绝的字段

| 位置 | 字段 | 结果 |
|---|---|---|
| `event` | `moduleInstanceId` / `connectionGeneration` | `UNSUPPORTED_FIELD`，message `"Connection binding belongs to transport context."` |
| `execute` | `attemptId` / `stepId` | `UNSUPPORTED_FIELD`——**即使值为 `undefined` 也算存在** |

（`module.rs:200-205, 267-272`）

---

## 6. 准入（admission）

准的是**一个已绑定的 sidecar 连接**，不是通用握手。
`admission.rs:1-2`：*These checks do not own a transport, process, operation ledger
or host permission.*

### 6.1 检查顺序

1. **协议版本**：响应里的 `protocolVersion` 必须**逐 code unit 等于** `"2.0"`。
   否则 `UnsupportedVersion`，message 是 JS 模板插值
   `"Sidecar protocol version is unsupported: {v}."`，其中 `{v}` 按 **JS 语义**字符串化：

   | 值 | 字符串化结果 |
   |---|---|
   | missing / `undefined` | `missing` |
   | `±0` | `"0"` |
   | `NaN` / `Infinity` | `NaN` / `Infinity` |
   | `[null,"x",[null,"y"]]` | `,x,,y` |
   | `{}` | `[object Object]` |

   若该值是**含 own `toString` 键**的对象 → 先抛
   `TypeError("Cannot convert object to primitive value")`（`consumer.rs:18-37, 119-169`）。

2. **绑定四字段**：`moduleId` · `moduleInstanceId` · `connectionGeneration` ·
   `capabilitiesVersion` 必须都是**非空字符串**。「非空」= UTF-16 长度 > 0，
   **孤立代理串合法**。错误 message 是
   `"Sidecar handshake response is missing {name}."`。

3. **capabilities**：`payload` 必须是对象；其 `capabilitiesVersion` 必须与 hello
   绑定值**完全相等**（逐 code unit，含孤立代理），否则 `CapabilitiesMismatch`。
   `methods` 必须是数组；每个元素的 `name` 必须**精确**属于
   `{execute, cancel, status, resume, ack}`——大小写敏感、不 trim；
   `hello` / `module_call` / `capabilities` 都被拒，否则 `InvalidMethod`。
   重复项与顺序保留，空数组合法。

4. **其余字段故意不校验**：`enabled` 可以是 `null`、`profiles` 可以是数字……
   它们以原始克隆保留在 `CapabilityMethod.fields`，**包括 own `undefined` 与未知字段**
   （`admission.rs:14-18`）。

### 6.2 副作用分类

| 类型 | 值 | 用途 |
|---|---|---|
| `CallEffect` | `ReadOnly` · `Advance` · `SideEffect` | 宿主决定未知接收的处置 |
| `ReplayDisposition` | `ReuseRecorded` · `QueryStatus` · `RejectConflict` | 重放策略 |

`admission.rs:75-82`：*Advance calls … must reconcile unknown acceptance through the
owning ledger. They are not safe to resend.*

`admission` **不**做：不校验 correlation（`messageId`/`inReplyTo` 由 transport 的
pending-call 账本持有）、不校验绑定与当前连接上下文是否一致（宿主职责）、
不做超时/取消/重放执行。

---

## 7. 运行时能力白名单

**注意：本 crate 里定义的那 8 张 host 方法白名单常量当前没有消费者**
（`module.rs:71-110` 的 `read_host_methods` 只是「过滤广告方法，保留原顺序与重复」）。
**实际运行时白名单在 transport**：

`transport/src/server.rs:855-880`：

| 方法 | 状态 |
|---|---|
| `execute` · `cancel` · `status` | ✅ enabled |
| `resume` · `ack` | ❌ 显式 `enabled: false` |

`AdvertisedMethods::supports`（`transport/src/lib.rs:51-62`）只把 module/operation
当**成员判定**，注释明确 **not authority grants**。

---

## 8. 必须保持的 bug-compatible 契约（清单）

改动前逐条核对。每一条背后都有测试。

1. **JS 数字格式**用 `ryu-js`：非有限 → `null`，`±0 → "0"`，最短往返文本。
2. **对象键序**：canonical 数组索引键数值升序在前，其余插入序；命中保留首槽位取最后值；
   `own undefined` 序列化省略、数组元素 `undefined` → `null`，但**内存中必须仍在**。
3. **WTF-16 无损**：孤立代理可解析、克隆、比较、再序列化为 `\uXXXX`；
   标识符禁用替换解码。
4. **错误优先级**：module 按 kind→messageId→字段顺序；admission 按
   version→moduleId→moduleInstanceId→connectionGeneration→capabilitiesVersion，
   且 capabilities mismatch 先于 method 校验。
5. **拒绝的字段**：event 带绑定字段、execute 带 `attemptId`/`stepId` → `UNSUPPORTED_FIELD`
   （值为 `undefined` 也算存在）。
6. **序列约束**：`ModuleSequence` 有限整数 ≥0；`ResumeSequence` ≥ -1；
   模块整数是 binary64 而非 SDK safe integer。
7. **stage-one 故意宽松**：不要把可选字段类型校验塞进 `validate_module_message`；
   必须保留 `Missing`/`Undefined`/`Null`/`Value` 四态。
8. **准入快照语义**：`capture_boundary` 用 `JsValue` clone（保 own `undefined` + WTF-16，
   **不经** stringify）；`capture_request` 必须 detach `ProviderEcho`，
   而普通内容 clone 仍共享 `Arc`（`protocol/src/snapshots.rs:9-30`）。
9. **迭代式遍历**：parse/stringify/clone/Debug/Eq/Drop 一律不递归；
   clone 收尾断言恰好组装出一个根。
10. **无长度上限**：不得引入协议未声明的帧/输入大小上限。
11. **三协议隔离**：`"2.0"` / `"1.2"` / `capabilitiesVersion` 不可混用。

---

## 9. 一次典型交互

```
宿主                                    sidecar
 │                                        │
 │  ── hello {binding...} ──────────────▶ │
 │  ◀───────────── capabilities ────────  │   protocolVersion "2.0"
 │                                        │   moduleId "pilotdeck-agent-loop"
 │                                        │   capabilitiesVersion "1"
 │  ── execute {profile, config...} ────▶ │
 │  ◀───── event (流式) ─────────────────  │   ┐
 │  ◀───── event ───────────────────────  │   ├ 期间 sidecar 反向发起
 │  ── module_call ◀────────────────────  │   ┘ module_call 请求宿主能力
 │  ── response ────────────────────────▶ │
 │  ◀───── response (turn result) ──────  │
 │                                        │
 │  ── cancel / status ─────────────────▶ │   可与上面的流并发
```

握手回包里 sidecar 用固定的 `moduleId = "pilotdeck-agent-loop"`、
`capabilitiesVersion = "1"`，`moduleInstanceId` 与 `connectionGeneration`
各带一个 uuid v4（`transport/src/bin/pilotdeck-agent-loop-sidecar.rs:46-58`）。
`server.rs:290-320` 负责回填这些字段。
