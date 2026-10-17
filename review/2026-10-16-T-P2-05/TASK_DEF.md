# TASK_DEF · T-P2-05 · G-P2-D7（rust-core TCP listen + hello token）

> **Changelog（2026-10-16 ~20:50 CST）**：吸收桌面审 + 现状纠错（仍 `unlocked=true`）：①**Q5** 锁定未来打包名 `pilotdeck-agent-loop-sidecar` → `apps/desktop/resources/rust/`；非阻塞补注 Win 带 `.exe`，与 hello 的 `rustHelloDestName`（`apps/desktop/scripts/rust-hello.mjs:13`，同 `:8`/`:35`）一致。②**Q6** 确认倾向：保持连接 + `UNAUTHENTICATED`（桌面 ack）。③Auth 仓内对照纠错：`tcp.rs` 仅 `listening`（`:17`）与 env 读入（`:30-34`）；`authenticated` / `UNAUTHENTICATED` / `constant_time_eq` 在 `sidecar.rs:113`、`:493`、`:502`、`:509`、`:2507-2517`。④产物路径引用拆开：钉死 `rust-core/target/release/pilotdeck-agent-loop-sidecar` ← T-P2-04 `TASK_DEF.md` §2.3-4；「默认仍指探针 / 仓根无该 sidecar 文件名」← `ADOPT_NOTES.md:15-17`（勿混读）。
>
> **Changelog（2026-10-16 ~20:45 CST）**：吸收 QA Formal 意见（Arch 全收）：①P5 三态各写一条可复制命令序列（对齐 `sidecar_tcp.rs:55-94`），错 token 断言响应 JSON **不含** token 原文；②P6 写死 `PILOTDECK_RUST_SIDECAR_BIN` + `PARITY_RUST_SIDECAR_PROOF`（同 T-P2-04 Formal）；③P6 全量 allowlist **仅** `deadline` + `sidecar_budget_limit`，`deadline_during_tool`→Track D 不扩名单，期望文案保持 **51/2/0/0**（分母 53）；④P10 判定列硬条件：设了 `PILOTDECK_AGENT_LOOP_TCP_TOKEN` 时 stdio 快速门仍 0 diff；⑤Q7：提案阶段无 Reviewer；代码 draft PR 仍 Formal → Reviewer（同 #53）。`unlocked=true` 不变。

> 状态：**定稿**·箱本地；`unlocked=true`（见 `UNLOCK.md`，2026-10-16 21:38 CST，真 Payne 经 Payne 分身 1:1 解锁并接受 Arch 倾向）。权威文件：`TASK_DEF.md`。`TASK_DEF-PROPOSAL.md` tip sha256 `ba04757d…21897a1` 已冻结并被本文件取代（§8 Q1–Q7 按 tip 草案倾向落定）。**允许** draft PR / 云端写 `rust-core`；ready / merge 仅 real Payne。禁止 force-push / rebase / amend。
> 日期：2026-10-16。基线：`rust_standalone_alpha1@d740abe1330bbc4a7ca9e2264fed0dad72b9a866`（#53 T-P2-04 merge；tip `47d42414`）。
> 对照：`docs/rust_rebuild/PLAN.md` 任务 T-P2-05（`:52`）/ 门禁 G-P2-D7（`:79-82`）/ G-P2-PERF TCP 轮（`:78`）/ 风险 R4（`:125`）；前置 T-P2-04 `review/2026-10-16-T-P2-04/TASK_DEF.md`（R3）与 `ADOPT_NOTES.md`。
> 团队备忘：同目录 `CONSTRAINTS-FROM-TEAM.md`（桌面 / QA 原文要点）。
> 本文所有仓内 `路径:行号` 均取自 git 对象 `d740abe1`（`git show d740abe1:<path>`，只读）。

## 0. 前置

1. **#53（T-P2-04）已合入** `rust_standalone_alpha1` → merge `d740abe1`；四 crate 在 `rust-core/`。**钉死产物路径** `rust-core/target/release/pilotdeck-agent-loop-sidecar` ← T-P2-04 `TASK_DEF.md` §2.3-4（勿与 ADOPT_NOTES 混读）。**默认路径未切**（仍指探针；仓根无该 sidecar 文件名）证据 ← `ADOPT_NOTES.md:15-17`。
2. 基线 = **`d740abe1`**。解锁时若主线前进，**以解锁时 `origin/rust_standalone_alpha1` tip 为父**，PROVENANCE 记该 SHA 与 `git diff --stat d740abe1 <tip>`。
3. #50 全量 53 基线：**51 pass / 2 trace_diff（`deadline`、`sidecar_budget_limit`）/ 0 profile_gap / 0 BLOCKED，分母 53**。`deadline_during_tool` 抖动属 Track D，**不**扩本任务修绿面。2 条 trace_diff **不阻塞** T-P2-05，但 **阻塞「产品默认路径指过去」**（`PLAN.md:84`）。
4. 探针侧 D7 最小面已在 #46（`PLAN.md:44`、`:52`）：`PILOTDECK_AGENT_LOOP_TCP_TOKEN`、loopback `--listen`、`UNAUTHENTICATED`、常量时间比较。本任务是把等价面落到 **rust-core `pilotdeck-transport`**，不是再改探针。
5. PC2 / PC1#3 / PC3 **仍 open**。本任务采 TCP 性能表，**不自动关 PC2**（关 PC2 须另议；`PLAN.md:50`、`:78`）。
6. post-#53 桌面 smoke #54 Formal PASS（证据-only 勿合）。本任务合入后桌面仍跑常规 X11/Wayland smoke；**sidecar 桌面联调另开任务**。

## 1. 目标

在 `rust-core/pilotdeck-transport` 补 G-P2-D7（T-P2-05 半边）：

1. **`--listen HOST:PORT`**：只绑 loopback（`is_loopback`）；stderr 打印 `listening HOST:PORT`（对齐探针 `tcp.rs:17`），供 harness `wait_for_tcp`。
2. **hello token**：读 `PILOTDECK_AGENT_LOOP_TCP_TOKEN`；未设置 = 开放 loopback；设置后 hello `payload.token` **常量时间比较**；错/缺 → `code: UNAUTHENTICATED`；响应**不回显** token；认证前其它 method 同样拒绝；**stdio 路径不校验**（且 stdio 子进程环境继续删掉该变量，见 `AgentLoopDeploymentProfile.ts:72-74`，本 PR 不改 TS）。
3. **去掉「设了 TCP_PORT 就 exit 2」**（`pilotdeck-agent-loop-sidecar.rs:26-33`）：harness 启动时会注入 `PILOTDECK_AGENT_LOOP_TCP_HOST/PORT`（`run.py:191-192`），wrapper 再转成 `--listen`（`rust-tcp-sidecar.sh:10-12`）。保留对 `PILOTDECK_AGENT_LOOP_FACTORY` 的 exit 2（本任务不接 factory）。
4. **PARITY / PERF** 在 tip 上对 **rust-core TCP 常驻**重跑（见 §5）；证据落 `review/2026-10-16-T-P2-05/**`。
5. **钉死传参契约**（名字可 grep）：见 §2.4。桌面打包接线 **不做**。

**不是**：T-P2-06 supervisor；切产品默认路径；改桌面打包 hello→真 sidecar；修 Track C/D / 关 PC*；UDS / mTLS（`PLAN.md:82`，生产默认前再做）。

## 2. In

### 2.1 rust-core TCP listen（对齐探针，不搬 10ms 轮询）

- 改动面主要在 `rust-core/pilotdeck-transport/`：bin（`src/bin/pilotdeck-agent-loop-sidecar.rs`）、必要时新增 `tcp` 模块或扩展 `stdio`/`server` 的连接入口；**单测**覆盖 loopback 拒绝、`--listen`、auth 三态。
- CLI 对齐探针 `crates/pilotdeck-agent-loop/src/lib.rs:42-65`：
  - 接受 `--listen HOST:PORT` 与 `--listen=HOST:PORT`；
  - `!addr.ip().is_loopback()` → 错误退出（探针文案：`"--listen must bind a loopback address"`）；
  - 无 `--listen` → 保持现有 stdio 行为（含忽略单个 sidecar-path 占位参数，`:77-83`）。
- **禁止**把探针 `STUB_POLL_MS = 10`（`sidecar.rs:16`、`:1372`）搬进 rust-core 事件循环（`PLAN.md:52`、R5）。
- 构建：`cd rust-core && cargo +1.99.1 build --release --locked -p pilotdeck-transport --bin pilotdeck-agent-loop-sidecar`；产物 **必须**落在 **`rust-core/target/release/pilotdeck-agent-loop-sidecar`**（禁止 `CARGO_TARGET_DIR` 指到仓根 `target/`，见 `ADOPT_NOTES.md:35`）。

### 2.2 Auth 契约（与 #46 / 探针语义对齐）

| 项 | 约定 | 仓内对照（d740abe1） |
|---|---|---|
| Env | `PILOTDECK_AGENT_LOOP_TCP_TOKEN`；trim 后空 = 未设置 | 探针读 env：`tcp.rs:30-34`（仅读入并交给 Sidecar）；`AgentLoopDeploymentProfile.ts:55,161-163` |
| Hello | token 只出现在 hello `payload.token` | TS client `:742-747`；探针 `allow_request` `sidecar.rs:498-513` |
| 比较 | 常量时间（字节级，长度不等也扫完） | 探针 `constant_time_eq`：`sidecar.rs:2507-2517` |
| 失败码 | `UNAUTHENTICATED`；`ok: false`；**body 不含 token 原文** | 探针 `sidecar.rs:493`（非 hello）、`:502`/`:509`（hello 失败）；`:490-495` |
| 未设 token | 与现网开放 loopback 相同（一连即可 hello） | `PLAN.md:80`；探针 `authenticated = … tcp_auth_token.is_none()`：`sidecar.rs:113`（**不在** `tcp.rs`；`tcp.rs:17` 只打 `listening`） |
| stdio | **不**校验 token；部署档删除子进程中的 HOST/PORT/TOKEN | `PLAN.md:81`；`AgentLoopDeploymentProfile.ts:72-74` |

Auth 三态（P5）各需**一条可复制完整命令序列 + 期望**（见 §5「P5 Auth 三态 · 可复制命令」），缺一 Formal FAIL；错 token 响应 JSON **不得**含 token 原文。

### 2.3 包装脚本与身份（对拍）

- Formal / 本地复现继续用 `tools/agent-loop-parity/rust-tcp-sidecar.sh`（已把 HOST/PORT → `--listen`，`:10-12`）。
- 二进制经 R3 符号链接：`rust-core/target/rust-core-proof/pilotdeck-agent-loop` → `../release/pilotdeck-agent-loop-sidecar`（同 T-P2-04；`PLAN.md:124`）。
- 环境：`PILOTDECK_RUST_SIDECAR_BIN=<abs>/rust-core/target/rust-core-proof/pilotdeck-agent-loop`。
- **默认** `rust-tcp-sidecar.sh:8` 仍指向仓根探针 `target/release/pilotdeck-agent-loop` → **本 PR 默认不改**（保持「产品默认未切」可检查）。对拍一律显式设 `PILOTDECK_RUST_SIDECAR_BIN`。
- README 里错误示例路径（`ADOPT_NOTES.md:36`：写 `target/release/pilotdeck-agent-loop-sidecar`）→ **允许**在白名单内改 `tools/agent-loop-parity/README.md` 为 `rust-core/target/release/...` + 注明须 `--listen` / wrapper；**不**改 harness 默认行为。

### 2.4 桌面传参契约（可 grep；本 PR 不接线）

写进证据 `D7_CONTRACT.md`，Formal 用 `grep -n` 核对**文档与实现**一致。名字钉死如下：

| 角色 | 名字 | 谁读 | 本 PR |
|---|---|---|---|
| 仓内产物（开发/对拍） | 路径 `rust-core/target/release/pilotdeck-agent-loop-sidecar` | 构建 / Formal | ✅ 钉死 |
| Harness 覆盖 bin | `PILOTDECK_RUST_SIDECAR_BIN` | `rust-tcp-sidecar.sh:6`、`rust-stdio-sidecar.sh:10` | ✅ 沿用 |
| Listen 地址（harness 注入） | `PILOTDECK_AGENT_LOOP_TCP_HOST`（默认 `127.0.0.1`）、`PILOTDECK_AGENT_LOOP_TCP_PORT` | wrapper → `--listen`；`run.py:191-192` | ✅ 沿用 |
| Auth | `PILOTDECK_AGENT_LOOP_TCP_TOKEN` | rust-core TCP 与 TS host profile | ✅ rust-core 实现 |
| Host 选 tcp | `PILOTDECK_AGENT_LOOP_TRANSPORT=tcp` | `AgentLoopDeploymentProfile.ts:52-62` | 不改 TS |
| 未来桌面打包落点（**仅文档**） | `apps/desktop/resources/rust/pilotdeck-agent-loop-sidecar`（对齐现 hello：`rust-hello.mjs:8,13,35`）。**非阻塞**：Win 打包文件名带 `.exe`，与 hello 的 `rustHelloDestName`（`rust-hello.mjs:13`：win32 → `${RUST_HELLO_BIN}.exe`）同一套 | 后续桌面任务 | ❌ 本 PR 不创建、不改 `apps/**` |
| 未来桌面启动 | 子进程 argv：`<packaged-bin> --listen 127.0.0.1:<port>`；env 带 `PILOTDECK_AGENT_LOOP_TCP_TOKEN`（若启用） | T-P2-06 / 桌面联调 | ❌ |

当前 chrome smoke **不**走 sidecar（桌面备忘）；合入后 smoke 流程不变。

### 2.5 证据与 PLAN

- 落盘 `review/2026-10-16-T-P2-05/**`：`PROVENANCE.md`、`D7_CONTRACT.md`、`AUTH_MATRIX.md`（三态命令与输出）、`PARITY_TCP.md`、`PERF_TCP.md`、`raw/*.txt`（不用 `*.log`，`.gitignore:7`）。
- **允许**改 `docs/rust_rebuild/PLAN.md`：T-P2-05 行状态；**须**把 T-P2-04 行标为已合入 `d740abe1`（Q1 定稿）。不扩写其它任务。

### 2.6 PR（仅解锁后）

- 标题建议：`T-P2-05: G-P2-D7 rust-core TCP listen + hello token`
- **draft**、线性、不 ready / 不 merge（仅 real Payne）。

## 3. Out

- T-P2-06 supervisor（崩溃续上 listener）
- 切 `PILOTDECK_AGENT_LOOP_TRANSPORT` 产品默认；改 `apps/desktop/**` 打包真 sidecar
- 改 `crates/pilotdeck-agent-loop/**`（探针冻结）
- 修绿 `deadline` / `sidecar_budget_limit` / Track C/D；关闭 PC2/PC1#3/PC3
- UDS / mTLS；接 `PILOTDECK_AGENT_LOOP_FACTORY`
- 把探针 10ms `recv_timeout` 轮询搬进 rust-core
- mark ready / merge / force-push / rebase / amend
- 改 `ui/**` `src/**`（除非开放问题另定）；moduleId 兼容（R8）

## 4. 白名单

| 允许 | 禁止 |
|---|---|
| `rust-core/pilotdeck-transport/**`（listen/auth/测试；必要时 `Cargo.toml` 仅本 crate 依赖若确需） | `crates/**`；根 `Cargo.toml` / `Cargo.lock` / `rust-toolchain.toml` |
| `review/2026-10-16-T-P2-05/**` | `apps/**` `ui/**` `packages/**`（桌面联调另任务） |
| `tools/agent-loop-parity/README.md`（路径/示例订正，可选） | 改 `rust-tcp-sidecar.sh` / `rust-stdio-sidecar.sh` 的**默认**探针路径（除非 Q2 选改且 Formal 更新 P4） |
| `docs/rust_rebuild/PLAN.md`（T-P2-05 状态；T-P2-04 已合入 `d740abe1` 一句） | 覆盖 `evidence/p1/*.json` 冒充关 PC* |
| — | 新增 CI workflow（T-P2-08）；改 `AgentLoopDeploymentProfile.ts`（stdio 删 TOKEN 已存在） |

## 5. 验收表

命令在 tip 干净 worktree；`SIDECAR=rust-core/target/release/pilotdeck-agent-loop-sidecar`；`PROOF=rust-core/target/rust-core-proof/pilotdeck-agent-loop`（symlink → `../release/pilotdeck-agent-loop-sidecar`）；`export PILOTDECK_RUST_SIDECAR_BIN=<abs>/$PROOF`。

| # | 条件 | 判定 / 命令 / 期望 |
|---|---|---|
| P1 | 产物路径 | `cd rust-core && cargo +1.99.1 build --release --locked -p pilotdeck-transport --bin pilotdeck-agent-loop-sidecar` 成功；`test -f rust-core/target/release/pilotdeck-agent-loop-sidecar`；`test ! -e target/release/pilotdeck-agent-loop-sidecar`（仓根无此文件名，除非有人误设 `CARGO_TARGET_DIR`） |
| P2 | loopback-only | `$SIDECAR --listen 0.0.0.0:0` → 非 0 退出且 stderr 含 loopback 约束；`$SIDECAR --listen 127.0.0.1:0` → stderr 匹配 `listening 127.0.0.1:<port>`，进程保活直至杀掉 |
| P3 | 不再因 TCP_PORT 误杀 | `PILOTDECK_AGENT_LOOP_TCP_PORT=9 PILOTDECK_AGENT_LOOP_TCP_HOST=127.0.0.1 $SIDECAR --listen 127.0.0.1:0` 能 listen（不 exit 2）；`PILOTDECK_AGENT_LOOP_FACTORY=/tmp/x $SIDECAR` 仍 exit 2 |
| P4 | 默认路径未切 | `git diff --stat d740abe1 -- apps/ src/ ui/ crates/ packages/` 无输出（若白名单改了 README，则 `tools/` 仅允许 README）；`grep -n 'RUST_HELLO_BIN =' apps/desktop/scripts/rust-hello.mjs` → `8:…hello`；`grep -n 'target/release/pilotdeck-agent-loop"' tools/agent-loop-parity/rust-tcp-sidecar.sh` → `:8` 仍为探针默认；`AgentLoopDeploymentProfile.ts:139` 默认 native 仍在 |
| P5 | **Auth 三态**（缺一 FAIL） | 下节「P5 Auth 三态 · 可复制命令」三态各一条完整序列；完整 stdout/stderr 写入 `AUTH_MATRIX.md`。缺一态或命令不可复现 → FAIL |
| P6 | **PARITY TCP** | 全部满足，缺一项 FAIL：① `cd rust-core && cargo +1.99.1 test --locked -p pilotdeck-transport`（及本 PR 新增 tcp 测例）绿；②**身份证明（同 T-P2-04 Formal / TASK_DEF.md P8〔R2-n5〕）**：先建 `rust-core/target/rust-core-proof/pilotdeck-agent-loop` → `../release/pilotdeck-agent-loop-sidecar`；跑对拍前 **必须** `export PILOTDECK_RUST_SIDECAR_BIN=<abs>/rust-core/target/rust-core-proof/pilotdeck-agent-loop`（`rust-tcp-sidecar.sh:6`）；harness/adapter 仍设 `PARITY_RUST_SIDECAR_PROOF`（`run.py:659`；`adapters/pilotdeck_gateway_impl.mjs:139`）。Formal 核：`echo "$PILOTDECK_RUST_SIDECAR_BIN"` 指向 proof symlink，`readlink -f "$PILOTDECK_RUST_SIDECAR_BIN"` → `…/rust-core/target/release/pilotdeck-agent-loop-sidecar`（**不是**仓根探针 `target/release/pilotdeck-agent-loop`）；证据记 `PARITY_RUST_SIDECAR_PROOF` 路径。③快速门：`python tools/agent-loop-parity/run.py --pilotdeck-root "$PWD" --comparison same-version --surface gateway --sidecar-transport tcp --pilotdeck-tcp-sidecar-cmd tools/agent-loop-parity/rust-tcp-sidecar.sh --scenario pure_text`（及 `single_tool`）各 **×30**，**0 semantic diff**；④全量 53 期望文案固定为 **51 pass / 2 trace_diff / 0 profile_gap / 0 BLOCKED**（分母 53）。允许的 trace_diff 名 **仅** `deadline` + `sidecar_budget_limit`。若出现 `deadline_during_tool` → 记 Track D，**不**扩 allowlist。即使某次跑成 52/1，**也不**放宽期望文案（对照可用，判定仍按 51/2） |
| P7 | **PERF TCP**（对齐 T-P2-04 P9 / T-P2-03） | 同机、同一次采集：`native` vs rust-core **tcp**（`--transports`；sidecar 用 rust-tcp wrapper + `PILOTDECK_RUST_SIDECAR_BIN`），`--model-ms 200`，n=30，场景 `pure_text`、`single_tool`、`sidecar_live_model_stream_chars_50`。**Q2 FAIL**：每场景 model 净 P95 − native model 净 P95 ≤ `max(native×10%, 100ms)`。**D4 只记录**：整 turn 净 P95 差/D4，D4=`max(native turn×10%, 5ms)`。stdio 旧表只并列参考，不作比较基准。不因此关 PC2 |
| P8 | 契约可 grep | `D7_CONTRACT.md` 含 §2.4 表中全部名字；`grep -n 'PILOTDECK_AGENT_LOOP_TCP_TOKEN' rust-core/pilotdeck-transport/src` 有实现命中；`grep -n 'PILOTDECK_RUST_SIDECAR_BIN' tools/agent-loop-parity/rust-tcp-sidecar.sh` → `:6`；文档声明桌面联调另任务、smoke 不强制 sidecar |
| P9 | 白名单 / 历史 | `git diff --name-only <base>..<tip>` ⊆ 白名单；draft；不 ready/merge |
| P10 | stdio 回归烟 | **判定（硬条件，缺一 FAIL）**：①快速门 stdio `pure_text` ×5（或 ×30 若时间允许）**0 diff**（listen 改动未破坏 stdio）；②**在已 `export PILOTDECK_AGENT_LOOP_TCP_TOKEN=production-token` 的环境下**再跑同一 stdio 快速门 `pure_text` ×5，仍须 **0 diff**（stdio 路径不校验 token；部署档删子进程 TOKEN 的既有行为必须保持）。命令示例：`PILOTDECK_RUST_SIDECAR_BIN=<abs>/$PROOF PILOTDECK_AGENT_LOOP_TCP_TOKEN=production-token python tools/agent-loop-parity/run.py --pilotdeck-root "$PWD" --comparison same-version --surface gateway --sidecar-transport stdio --pilotdeck-stdio-sidecar-cmd tools/agent-loop-parity/rust-stdio-sidecar.sh --scenario pure_text`（重复至 ×5） |

### P5 Auth 三态 · 可复制命令（对齐 `sidecar_tcp.rs:55-94` / `sidecar.rs:6267-6300`）

前置：P1 产物已存在。仓根执行。变量：

```bash
SIDECAR="$PWD/rust-core/target/release/pilotdeck-agent-loop-sidecar"
TOKEN="production-token"
# 小帮手：读 stderr 的 `listening HOST:PORT`（探针 tcp.rs:17）
wait_addr() { # $1=stderr file
  for _ in $(seq 1 50); do
    line=$(grep -m1 '^listening ' "$1" 2>/dev/null || true)
    [ -n "$line" ] && { echo "${line#listening }"; return 0; }
    sleep 0.1
  done
  echo "FAIL: no listening line in $1" >&2; return 1
}
# 小帮手：对 $ADDR 发一行 JSONL，打印响应行
send_line() { # $1=HOST:PORT  $2=json-line
  python3 - "$1" "$2" <<'PY'
import socket, sys
host, port = sys.argv[1].rsplit(":", 1)
msg = sys.argv[2]
if not msg.endswith("\n"):
    msg += "\n"
s = socket.create_connection((host, int(port)), 2)
s.sendall(msg.encode())
buf = b""
while b"\n" not in buf:
    chunk = s.recv(4096)
    if not chunk:
        break
    buf += chunk
s.close()
sys.stdout.write(buf.decode(errors="replace"))
PY
}
```

#### 态 A · 无 token（开放 loopback）

```bash
unset PILOTDECK_AGENT_LOOP_TCP_TOKEN
rm -f /tmp/p5-none.err
"$SIDECAR" --listen 127.0.0.1:0 >/dev/null 2>/tmp/p5-none.err &
PID=$!
ADDR=$(wait_addr /tmp/p5-none.err) || { kill $PID 2>/dev/null; exit 1; }
RESP=$(send_line "$ADDR" '{"kind":"request","messageId":"hello-1","method":"hello","payload":{}}')
echo "$RESP"
# 期望：一行 JSON，`"ok":true`，`"inReplyTo":"hello-1"`（可继续 capabilities）
python3 -c 'import json,sys; r=json.loads(sys.argv[1]); assert r.get("ok") is True and r.get("inReplyTo")=="hello-1", r' "$RESP"
kill $PID 2>/dev/null; wait $PID 2>/dev/null || true
```

#### 态 B · 错 token / 缺 token（`UNAUTHENTICATED`，响应不含 token 原文）

```bash
export PILOTDECK_AGENT_LOOP_TCP_TOKEN="$TOKEN"
rm -f /tmp/p5-bad.err
"$SIDECAR" --listen 127.0.0.1:0 >/dev/null 2>/tmp/p5-bad.err &
PID=$!
ADDR=$(wait_addr /tmp/p5-bad.err) || { kill $PID 2>/dev/null; exit 1; }
# B1: hello 无 token（对齐 sidecar_tcp.rs:75）
RESP1=$(send_line "$ADDR" '{"kind":"request","messageId":"hello-bad","method":"hello","payload":{}}')
echo "$RESP1"
python3 -c 'import json,sys
r=json.loads(sys.argv[1]); tok=sys.argv[2]
assert r.get("ok") is False and r.get("code")=="UNAUTHENTICATED", r
assert tok not in sys.argv[1], "token plaintext leaked in response JSON"
print("B1 OK")' "$RESP1" "$TOKEN"
# B2: hello 错 token（对齐 sidecar.rs:6282）
RESP2=$(send_line "$ADDR" '{"kind":"request","messageId":"hello-wrong","method":"hello","payload":{"token":"nope"}}')
echo "$RESP2"
python3 -c 'import json,sys
r=json.loads(sys.argv[1]); tok=sys.argv[2]
assert r.get("ok") is False and r.get("code")=="UNAUTHENTICATED", r
assert tok not in sys.argv[1], "token plaintext leaked in response JSON"
print("B2 OK")' "$RESP2" "$TOKEN"
# B3: 认证前非 hello 仍拒（对齐 sidecar.rs:6276-6280）
RESP3=$(send_line "$ADDR" '{"kind":"request","messageId":"caps-early","method":"capabilities","payload":{}}')
echo "$RESP3"
python3 -c 'import json,sys; r=json.loads(sys.argv[1]); assert r.get("code")=="UNAUTHENTICATED", r; print("B3 OK")' "$RESP3"
kill $PID 2>/dev/null; wait $PID 2>/dev/null || true
```

**错 token 硬断言**：`RESP*` 整行字符串 **不得** 包含 `production-token`（token 原文）；协议错误响应即可，**不**要求 TCP RST。

#### 态 C · 正确 token（可正常会话）

```bash
export PILOTDECK_AGENT_LOOP_TCP_TOKEN="$TOKEN"
rm -f /tmp/p5-ok.err
"$SIDECAR" --listen 127.0.0.1:0 >/dev/null 2>/tmp/p5-ok.err &
PID=$!
ADDR=$(wait_addr /tmp/p5-ok.err) || { kill $PID 2>/dev/null; exit 1; }
RESP=$(send_line "$ADDR" "{\"kind\":\"request\",\"messageId\":\"hello-ok\",\"method\":\"hello\",\"payload\":{\"token\":\"$TOKEN\"}}")
echo "$RESP"
python3 -c 'import json,sys
r=json.loads(sys.argv[1])
assert r.get("ok") is True and r.get("inReplyTo")=="hello-ok", r
payload=r.get("payload") or {}
assert "token" not in payload, r
print("C OK")' "$RESP"
# 认证后 capabilities 应 ok
RESP2=$(send_line "$ADDR" '{"kind":"request","messageId":"caps-ok","method":"capabilities","payload":{}}')
echo "$RESP2"
python3 -c 'import json,sys; r=json.loads(sys.argv[1]); assert r.get("ok") is True, r; print("C caps OK")' "$RESP2"
kill $PID 2>/dev/null; wait $PID 2>/dev/null || true
unset PILOTDECK_AGENT_LOOP_TCP_TOKEN
```

三态完整命令与输出落入 `AUTH_MATRIX.md`。缺一态 → Formal FAIL。

P5–P8、P10 任一不满足 → QA Formal FAIL。

## 6. 与 T-P2-04 的关系

| | T-P2-04（已合） | T-P2-05（本提案） |
|---|---|---|
| 门禁 | G-P2-ADOPT | G-P2-D7（+ PERF TCP 轮） |
| 产物路径 | 钉死 `rust-core/target/release/pilotdeck-agent-loop-sidecar` | **沿用**；首次让该二进制真正 `--listen` |
| 对拍形态 | stdio 每 turn 拉起 | **常驻 TCP**（关 PC2 的前提形态，`PLAN.md:50`） |
| 默认路径 | 未切 | **仍不切** |
| 桌面 | 仍只打包 hello | 仍不打包真 sidecar；契约先写进 `D7_CONTRACT.md` |
| 遗留 | README 错误 TCP 路径（`ADOPT_NOTES.md:36`） | 本任务可订正 README |

## 7. 本文件边界与流程

1. **已解锁**：`UNLOCK.md` 已落盘；本文件为权威定稿。
2. 允许 draft PR / 云端改 `rust-core/pilotdeck-transport/**`（白名单）；**禁止** ready / merge / force-push / rebase / amend（仅 real Payne）。
3. QA Formal 对 PR tip；桌面合入后常规 chrome smoke（不强制 sidecar）；证据 PR 勿合。
4. T-P2-06 / 桌面 sidecar 联调 = **后续独立解锁**。

## 8. 已定决策（真 Payne 1:1：接受 Arch 倾向 / tip 草案倾向）

| # | 问题 | 定稿 |
|---|---|---|
| Q1 | `PLAN.md` T-P2-04 行是否在本 PR 标成「已合入 `d740abe1`」？ | **是**（一行状态） |
| Q2 | 是否改 `rust-tcp-sidecar.sh:8` 默认 bin → rust-core 路径？ | **否**（保持探针默认；对拍用 `PILOTDECK_RUST_SIDECAR_BIN`） |
| Q3 | 本 PR 是否改 `tools/agent-loop-parity/README.md` TCP 示例路径？ | **是**（消化 `ADOPT_NOTES` 已知项 2） |
| Q4 | TCP PERF 过 Q2 后是否关 PC2？ | **只附结果、不关 PC2** |
| Q5 | 未来桌面打包文件名？ | **锁定** `apps/desktop/resources/rust/pilotdeck-agent-loop-sidecar`；Win `.exe` 同 `rustHelloDestName`（`rust-hello.mjs:13`）；本 PR 不接线 `apps/**` |
| Q6 | Auth 失败行为？ | **保持连接 + `UNAUTHENTICATED`**（对齐 #46） |
| Q7 | Reviewer？ | 代码 draft PR：**Formal → Reviewer**（同 #53） |

## 9. 成功标准（解锁后给实现）

- draft PR + P1–P10 证据齐全，可被 QA Formal 只读复核。
- 读者清楚：**rust-core 能常驻 TCP + 最小 hello token ≠ 产品已默认切过去 ≠ 桌面已打包真 sidecar**。
- 下一步候选：T-P2-06 supervisor；桌面 sidecar 联调；PC2 关闭决议；Track D。
