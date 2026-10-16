# 开发文档 · PilotDeck Rust sidecar

> 读者：第一次接手这个仓的人（或 AI）。读完这份应该能**改代码、跑测试、判断改动危不危险**。
> 分层与数据流的深入部分在 [ARCHITECTURE.md](ARCHITECTURE.md)，wire 契约在 [PROTOCOL.md](PROTOCOL.md)。

---

## 1. 这个程序是什么

一个 **stdio 子进程**。TS gateway 在启动 agent 循环时，读环境变量
`PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND` 拿到可执行文件路径，然后把它当 sidecar 拉起来，
两边用 **Module Protocol 2.0（一行一个 JSON，NDJSON）** 通信：

```
TS gateway（宿主，未改一行）
   │  spawn <Rust sidecar>
   ▼
┌─────────────────────────────────────────────┐
│ pilotdeck-agent-loop-sidecar                │
│  stdin  ◀── NDJSON 请求（hello / execute /  │
│              cancel / status / module_call  │
│              ／宿主回包）                    │
│  stdout ──▶ NDJSON 响应（capabilities /     │
│              event / response / error）      │
└─────────────────────────────────────────────┘
```

**职责边界非常硬**：sidecar 只有「循环逻辑」。模型调用、工具执行、权限、上下文、
持久化全部由宿主经 `module_call` 提供。sidecar 不读文件、不开网络、不碰用户目录。

进程契约（改入口前必读）：

| 项 | 值 |
|---|---|
| 可接受参数 | 无参数 · `--stdio` · 恰好一个非空且不以 `--` 开头的路径参数（**被忽略**）· `--version` |
| 退出码 0 | 正常结束（`--version` 也走这条） |
| 退出码 2 | 参数非法；或设置了不支持的部署 profile |
| 退出码 3 | 收尾不完整（有 worker 线程没能 join） |
| `--version` stdout | `pilotdeck-agent-loop-sidecar 0.1.0 implementation=rust wire=2.0 source=<git-commit>` |
| stdout | **只允许 Module2 NDJSON**。任何调试输出必须走 stderr |
| 配置 | 必须与 TS 同 cwd 启动（用来对齐相对路径语义） |

那个「被忽略的路径参数」是为了兼容上游：生产 profile 永远以 `args: [sidecarPath]`
拉起 sidecar（`AgentLoopDeploymentProfile.ts:73`）。删掉这个兼容会导致真实部署起不来。

---

## 2. 环境准备

```bash
git clone <this-repo> && cd rust-core

# 工具链由 rust-toolchain.toml 钉死（channel = "1.99"，含 rustfmt/clippy）
rustup show active-toolchain        # 应显示 1.99-*
cargo --version                     # cargo 1.99.x
```

要求：

- **Rust 1.99**（`rust-toolchain.toml`）。manifest 里 `rust-version = "1.93"` 是可编译下限，
  但 CI 与本地都用 1.99；1.99 新出的 lint 必须修，不能靠降级绕开。
- **不需要 Node / Python / 任何外部服务**。这个仓是自洽的：`cargo test` 不联网、不读外部 fixture。
- 网络只在首次 `cargo fetch` 拉 crates.io 依赖时需要。

依赖策略（`Cargo.toml`）：

- 所有第三方依赖**精确钉版本**（`=1.0.151` 这种），不留 `^`。改依赖版本属于需要说明的改动。
- `[workspace.lints.rust] unsafe_code = "forbid"` —— 全仓禁止 `unsafe`。
- `[workspace.lints.clippy] all = "warn"`，而 CI 用 `-D warnings` ⇒ **clippy 警告即失败**。
- `vendor/tiktoken-rs` 被 `exclude` 出 workspace，是上游 fork，按 vendored 代码对待（尽量不改）。

---

## 3. 常用命令

```bash
# 构建（release 是交付形态）
cargo build --release --bin pilotdeck-agent-loop-sidecar

# 三条闸门 = CI 的全部内容，提交前必须本地跑过
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets

# 单 crate
cargo test -p pilotdeck-agent
cargo test -p pilotdeck-transport

# 单测试文件 / 单个测试名
cargo test -p pilotdeck-agent --test request_assembly
cargo test -p pilotdeck-transport --test host_contract same_call_ack_after_cancel
```

自动修复格式：`cargo fmt --all`。
`--all-targets` 很重要：它有 lib 测试、集成测试（`tests/*.rs`）、bin 测试三部分，
漏了 `--all-targets` 会漏测。

当前基线（本仓成立时实测）：

```text
fmt      ✅ 0 差异
clippy   ✅ 0 警告
test     ✅ 37 个测试套件 / 696 项全过
         pilotdeck-agent      479
         pilotdeck-transport  174
         pilotdeck-protocol    27
         pilotdeck-tokenizer   16
```

---

## 4. 仓内导航

```text
pilotdeck-protocol/     线协议边界层。无 IO、无 transport。
  lib.rs                JsString / JsObject / JsValue（JS 语义值模型）
  codec.rs              手写 JSON 解析/序列化（非递归、JS 数字与键序）
  module.rs             Module 2.0 信封第一阶段形状校验
  wire.rs               借用式类型化视图 + Presence 四态
  admission.rs          sidecar 绑定与能力准入
  model.rs              canonical model 域类型（消息/工具/用量/事件）
  snapshots.rs          准入快照（与普通 clone 语义不同）
  tests/                codec.rs(82) · model_admission.rs(26)

pilotdeck-tokenizer/    o200k tokenizer。内嵌词表，纯函数。
  implementation.rs     ranks 解析 + Source 正则（含 JS \s/\S 修正）

pilotdeck-agent/        agent 循环核心（最大，~33k 行）。
  ports.rs              端口/效果边界（HostPort、CallControl...）
  driver.rs             状态机骨架
  turn.rs               单轮 turn 的完整实现（~10.5k 行）
  turn_timeline.rs      事件时间线
  turn_wire.rs          出线投影
  request_assembly.rs   给模型的请求体组装
  request_materialization.rs  请求物化（含 lossless 快照）
  source_model*.rs      源模型归约（source model → 状态）
  session_state*.rs     会话状态读写
  *_policy.rs           纯策略（无副作用，可单测）—— 见 §6.2
  tests/                20 个文件，479 项

pilotdeck-transport/    进程与 IO 边界。产出二进制。
  bin/pilotdeck-agent-loop-sidecar.rs   入口
  stdio.rs              ConnectionOwner：stdin/stdout 所有权与线程
  server.rs             ExecutionServer：帧循环、请求分发、超时、取消
  default_factory.rs    生产组合：把宿主、turn 策略、时钟接起来
  host_operations.rs    宿主调用实现（~2.4k 行）
  factory_payload.rs    工厂 payload 解码
  model_admission.rs    模型准入
  notifications.rs      InstructionBridge（advisory 通知）
  system_clock.rs       JS/Node 语义的日期时间（~815 行 + 35 项测试）
  build.rs              注入 PILOTDECK_SOURCE_COMMIT
  tests/                9 个文件，174 项

vendor/tiktoken-rs/     vendored 上游 crate（exclude 出 workspace）
```

---

## 5. 开发工作流

### 5.1 提交信息

沿用上游约定：`<type>: <一句话>`，type ∈ `feat` / `fix` / `docs` / `chore`，正文中文。
**正文写清「为什么」和「依据」**——这个仓的核心资产是「为什么这样写」，不是代码本身。

建议带上来源trailer（便于追溯是本仓原创还是搬入）：

```text
fix: 修正 xxx 的边界判断

依据：TS 基线 xxx.ts:123 的行为是 ...
影响：不改变 wire 输出，仅内部判定顺序。

Change-By: ai | human | ai+human
Agent:      <工具名>
Model:      <模型名>
Co-authored-by: 郑达奇 <邮箱>
```

### 5.2 改动必须带的证据

1. **三条闸门本地全绿**（fmt / clippy / test），PR 里贴原始输出，不要只说「已通过」。
2. **行为变化要有依据**：引用 TS 基线的 `文件:行号`，或贴一次实测输出。
   不允许「我觉得应该这样」。参照物钉死在 `cc7c4e6`，不是「最新的上游」。
3. **改了 wire 行为** ⇒ 必须说明是否影响对拍；影响就得跑一次对拍（见 §7）。

### 5.3 什么改动是安全的

| 改动类型 | 安全性 |
|---|---|
| 加纯函数、加单元测试 | 安全 |
| 改注释、改文档、`cargo fmt` | 安全 |
| 重构不改变任何 `JsValue` 投影结果 | 安全（但要靠测试证明） |
| 改错误文案 / 错误码 / 判定顺序 | ⚠️ 危险：TS 侧按文案与顺序断言 |
| 改 `JsValue` 序列化（数字、键序、四态） | ⛔ 高危：直接改变 wire 字节 |
| 改默认超时 / 线程数 / 容量上限 | ⚠️ 危险：改变竞态与终态 |
| 加 `unsafe` | ⛔ 被 lint 禁止 |

### 5.4 绝对不要做

- **不要动 `LICENSE` 与 `vendor/tiktoken-rs/LICENSE`**（AGPL 义务）。
- **不要在 stdout 打任何非 NDJSON 内容**（会直接破坏协议帧）。
- **不要把 `JsString` 降级成 `String`**：那会丢掉 WTF-16 语义（见 §6.1）。
- **不要引入未在协议里声明的长度/大小上限**。
- **不要碰用户的 `~/.pilotdeck` 或本机正在跑的 PilotDeck 实例**。

---

## 6. 核心工程约束（不理解这几条就会写出「看起来对但过不了对拍」的代码）

这个仓不是从零设计的系统，而是**为了与一个既有 TypeScript 实现逐字节对齐而存在的实现**。
下面几条是对齐过程中最容易踩的坑。

### 6.1 值模型必须模拟 JavaScript，不是模拟 Rust

`pilotdeck-protocol` 里的 `JsString` / `JsObject` / `JsValue` 是刻意设计的：

- **`JsString` 是 `Vec<u16>`（UTF-16 code unit），不是 `String`。**
  JS 字符串允许**孤立代理**（unpaired surrogate）。这些值会出现在真实数据里，
  必须能解析、克隆、比较、再序列化成 `\uXXXX`。`to_utf8()` 因此**显式可失败**——
  标识符**绝不做有损替换解码**。
- **数字用 `ryu-js` 的 ECMAScript 算法**，不是 serde_json 的。
  `1e21 → "1e+21"`、`1e20 → "100000000000000000000"`、`9007199254740993 → 9007199254740992`、
  `±0 → "0"`、非有限 → `null`。
- **对象键序有规则**：canonical 数组索引键（全数字、无前导零、< 2^32-1）按数值升序在前，
  其余按插入序在后。`insert` 命中已存在键时**保留首槽位、替换值**。
- **`Presence` 四态**：缺少 / `undefined` / `null` / 有值。四者语义不同，
  `own undefined` 属性序列化时被省略但**内存里必须还在**（有测试专门验证：
  clone 后仍能触发 `UNSUPPORTED_FIELD`，经一次 stringify/parse 往返才消失）。

### 6.2 `X.rs` + `X_policy.rs` 的成对约定

`pilotdeck-agent` 里几乎所有恢复/预算/终结逻辑都拆成两个文件：

- **`X_policy.rs`**：纯决策函数。无 IO、无时钟、无锁，输入输出都是值。**好测**。
- **`X.rs`**：带副作用的壳。拿策略的结论去调宿主、写状态、发事件。

例：`output_recovery_policy.rs` 决定「这次失败该不该重试」，`output_recovery.rs` 执行重试。
**改行为改 policy，改接线改壳**。单测绝大多数打 policy 层。

### 6.3 非递归遍历

`parse` / `stringify` / `clone` / `Debug` / `PartialEq` / `Drop` **全部用显式栈实现，不递归**。
测试用 128 KiB 栈、深度 30000 的对象验证这一点（`tests/codec.rs`）。
写新的容器遍历代码时照做，否则深度攻击会爆栈。

### 6.4 时钟与日期要复刻 Node/V8 语义

`system_clock.rs` 不是「用 chrono 格式化一下」。它复刻的是 **Node 22 的 `Date.parse` /
`toISOString` 语义**，包括历史时区 offset 的秒级精度、`TextClip` 限制、
两位年份的补零规则、非 22 小时制时区的 DST gap 处理等。
它有 35 项测试，其中若干是「拿真实 Node 22.22.0 的输出冻结成 fixture」
（`tests/fixtures/node22-date-parse.json` + 同目录 `.mjs` 录制脚本）。
改这里前先读 fixtures 目录的说明，重新录制必须用 **Node v22.22.0**。

### 6.5 并发：线程 + 有界通道，无 tokio

sidecar 是**同步实现**，用 `std::thread` + 有界通道 + 超时，没有 async runtime。
`ConnectionOwner` 持有 stdin/stdout 所有权；`ExecutionServer` 跑帧循环；
worker 执行 turn；宿主调用在 reader 线程上读写，靠 pending-call 账本关联。

因此**取消是竞态敏感**的：有一条测试专门断言「取消先于 ACK 到达」时不能重复派发宿主调用。
改线程结构或超时前，先看 `tests/server_owner.rs` 与 `tests/host_contract.rs`。

---

## 7. 对拍（parity）：这个项目的「验收」

本仓**不带**对拍装置，也不带 TS 基线。完整的对拍在原始仓
[`zhengdaqi/pilotdeck-rs`](https://github.com/zhengdaqi/pilotdeck-rs) 里做，因为它需要：

- TS 基线 `OpenBMB/PilotDeck@cc7c4e653b15c8b2cec7bcf2d15d41d69396ae85`（`standalone_alpha1`）；
- 上游装置 `tools/agent-loop-parity/`；
- 比较器 `scripts/parity/g03_compare.py`（G03 v1 通道拆分比较器）与驱动 `round.py`。

口径（照抄自上游冻结规约）：

- **比什么**：Rust sidecar **对** TS sidecar（不是对 native）。三个面：语义事件流 ·
  落盘终态 · **发给模型的请求体**。
- **多少遍**：k = 5，**5 遍两两全一致**才算该场景 PASS。k 与 m 必须在**不看任何 Rust 输出**的前提下定死。
- **分母**：53 减去「原版自己就不稳定」的场景数；`|S| < 45` 就停下交人。
- **身份必须可证**：每轮要断言真的跑的是本仓编出来的二进制（sha256 匹配），
  不能只看一句 `implementation=rust`——历史上踩过「adapter 把命令覆盖回 TS，
  自证却是 Rust」的假通过。

本仓的贡献方式是：**在这里改代码 → 编出二进制 → 交回原仓用冻结的尺子量**。
所以本仓的 CI 只需要保证「三条闸门绿 + 测试数不降」，对拍在那边做。

如果要单独把二进制交给对拍：

```bash
cargo build --release --bin pilotdeck-agent-loop-sidecar
shasum -a 256 target/release/pilotdeck-agent-loop-sidecar   # 这个哈希就是身份
PILOTDECK_AGENT_LOOP_TRANSPORT=stdio \
PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND=$PWD/target/release/pilotdeck-agent-loop-sidecar \
  <启动 TS gateway>
```

---

## 8. 验收清单

改完一个任务，逐条过：

- [ ] `cargo fmt --all --check` 无差异
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` 无警告
- [ ] `cargo test --workspace --all-targets` 全过，且**测试总数不少于 696**
      （只减不增要说明为什么）
- [ ] 改动涉及 wire / 错误文案 / 判定顺序 ⇒ 已在对拍侧确认影响
- [ ] 新增行为都有测试覆盖；恢复类逻辑改在 `*_policy.rs` 并补 policy 单测
- [ ] 提交信息写了「为什么」与「依据（文件:行号）」
- [ ] `LICENSE`、`vendor/tiktoken-rs/LICENSE`、`PROVENANCE.md` 未被误改
- [ ] 若改动了搬入文件，`PROVENANCE.md` 的适配例外清单同步更新

---

## 9. 疑难排查

| 症状 | 多半原因 |
|---|---|
| 二进制 `--version` 显示 `source=unregistered-build` | `build.rs` 读不到 git HEAD：不在 git 仓内，或 `.git/HEAD` 不可读。`git rev-parse HEAD` 能过就行 |
| 提交之后 `--version` 里的 `source=` 还是旧值 | macOS 上 `/tmp` 是 `/private/tmp` 的符号链接：`build.rs` 用 git 拿到的绝对路径（`/tmp/...`）与 Cargo 解析的 `CARGO_MANIFEST_DIR`（`/private/tmp/...`）不一致，`cargo:rerun-if-changed` 因此没命中。`touch pilotdeck-transport/build.rs` 强制重编，或把仓放在无符号链接的路径下 |
| 起了 sidecar 但宿主连不上 | 参数被拒（退出码 2）⇒ 检查是否传了多个位置参数；或 cwd 与 TS 不一致 |
| stdout 上出现非 JSON 行 | 有人在代码里 `println!` 了。**所有诊断必须 `eprintln!`** |
| 宿主报 `Sidecar protocol version is unsupported: ...` | 握手回包里的 `protocolVersion` 不是逐 code unit 相等的 `"2.0"` |
| 测试数量比 696 少 | 有测试文件被漏掉；用 `cargo test --workspace --all-targets` 而不是 `cargo test` |
| clippy 在本地过、CI 挂 | 本地没带 `-D warnings`；或本地工具链不是 1.99 |
| 改 `system_clock.rs` 后 fixture 测试挂 | fixture 是用 Node v22.22.0 录的，你的本机 Node 版本不同只会影响**重录**，不影响跑测试；若重录必须用 22.22.0 |

---

## 10. 延伸阅读

| 想了解 | 看哪 |
|---|---|
| 四个 crate 怎么分层、数据怎么流、线程怎么组织 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Module 2.0 的确切字段、错误码、准入顺序 | [PROTOCOL.md](PROTOCOL.md) |
| 每个文件的来源 sha256 与搬入时的适配改动 | [PROVENANCE.md](PROVENANCE.md) |
| 完整的项目意向、真难题、不做什么 | 原仓 `zhengdaqi/pilotdeck-rs` 的 `.42cog/intent.md` |
| 对拍规约原文 | 原仓 `specs/parity/` |
