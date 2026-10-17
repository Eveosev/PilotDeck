# PROVENANCE · T-P2-06

- 基线：`rust_standalone_alpha1` @ `d91ed18be85f6291a8858d40b82ca171c7e0404f`（#56）
- 分支：`cursor/t-p2-06-ts-supervisor-1361`
- 初版 tip：`786c9b4aa36a3c0846a1c47b0a8900153ced265e`（draft PR #58）
- R1 跟进：在该 tip 之上追加新提交，不 rebase / amend / force-push。新 tip 即本文件这次更新所在的提交，SHA 以 `git rev-parse HEAD` 为准，并写在 PR #58 描述里
- 规格：上传的冻结 `TASK_DEF`（sha256 `b0405a32cd97267aadb3b81acecadd096600dcba19974bb9891d68eb573c0fba`）
- 解锁：`unlocked=true`。本 PR 保持 draft。ready / merge 仍等真 Payne
- 工作树相对基线的产品改动在 `src/cli/**`、`tests/**`、`review/2026-10-17-T-P2-06/**`、`docs/rust_rebuild/PLAN.md`、`docs/rust_rebuild/PR_LOG.md`，以及根 `package.json` 的 build 拷贝（把 `tests/cli/fixtures` 送进 dist）。未改 `apps/**`、`ui/**`、`packages/**`、`crates/**`

## 实现选择

- Opt-in **A**：`PILOTDECK_AGENT_LOOP_TCP_SUPERVISE=1`，或 `PILOTDECK_AGENT_LOOP_SIDECAR_COMMAND` / `PILOTDECK_RUST_SIDECAR_BIN` 非空
- 未 opt-in 时，`HOST+PORT` 继续 reuse 外部 listener
- rust-core 走 `--listen`。TS sidecar 走 `PILOTDECK_AGENT_LOOP_TCP_HOST/PORT`，`PORT=0` 时打印 `listening HOST:PORT`
- 固定 `TCP_PORT` 则重启仍 bind 该端口；否则 `:0` 并解析 listening 行
- 默认 transport 仍是 native。未改 `apps/**` `ui/**` `packages/**` `crates/**`

## 工具

- Node `v22.14.0`（测试进程）；`pnpm` `10.32.1`
- rustc `1.99.1 (58cf8f9c3 2026-10-13)`（`rustup toolchain install 1.99.1 --profile minimal`）
- 本次 release 二进制：`rust-core/target/release/pilotdeck-agent-loop-sidecar`
- sha256 `73ca0005e54d12de92b824c9d78bda94533370857faa6a6a16a09d39cc8f891d`
- 构建：`cargo +1.99.1 build --release -p pilotdeck-transport --bin pilotdeck-agent-loop-sidecar`
- 二进制在 `rust-core/.gitignore` 的 `/target/` 下，不入库

## 命令与结果

```text
node --import tsx --test --test-force-exit --test-timeout 120000 \
  tests/cli/agent-loop-tcp-sidecar-supervisor.spec.ts
```

原始输出：`raw/supervisor-tests.txt`。14 tests，pass 14，fail 0，skipped 0，exit 0。本机有可执行 rust-core 二进制，所以 rust-core 用例实际跑过，没有跳过。

其中 rust-core 探针一行：

```text
rust-core probe listen=127.0.0.1:37395 wrong=UNAUTHENTICATED hello=true executeKind=error executeCode=MISSING_EXECUTE_FIELD restartedPid=6427 again=UNAUTHENTICATED
```

错 token 为 `UNAUTHENTICATED` 且响应不含 token；正确 hello 为 ok；缺字段的 execute 立即返回 `MISSING_EXECUTE_FIELD`（协议错误，不是挂起）。`SIGKILL` 后新 pid 在 5s 窗口内再次拒绝错 token。

失败重启不再挂住等待的一行：

```text
m1 failing-restart waitMs=400 waitedMs=400 factoryMs=350 factoryElapsedMs=351 disposeCancelMs=1
```

```text
pnpm exec tsc -p tsconfig.json
node --test --test-force-exit --test-timeout 120000 \
  dist/tests/cli/agent-loop-deployment-profile.spec.js
```

原始输出：`raw/deployment-profile-tests.txt`。6 tests，pass 6，fail 0，exit 0。

## R1 跟进（M1 / M2）

Mac Reviewer R1 对 draft PR #58 给出 conditional_pass（progress_met；0 blocker / 2 major）。下面两条按复现后的代码路径修，不改 opt-in A，也不把默认 transport 从 native 拨开。

### M1 — `waitForAddress` 可中止且有上限

持续失败的重启以前只清掉地址、不设置 `terminalError`，`waitForAddress` 会一直排队。现在每次等待默认用就绪超时，connection factory 把 `connectTimeoutMs` 传进去。超时文案是 `Timed out waiting for the AgentLoop TCP sidecar to listen after Nms.`。`stop()` 在杀进程之前拒绝所有未完成等待；gateway `dispose()` 仍先走这个 `stop()`。重启环本身继续，直到 `stop()`。

证明：fake sidecar 在 `PILOTDECK_FAKE_SIDECAR_FAIL_FILE` 存在时直接退出。先正常 listen，再写这个文件并 `SIGKILL`。随后 `waitForAddress(400)` 在 400ms 返回超时（源码 `waitedMs=400`，上限断言 `< 1200`），factory 传入 350ms 同样超时（`factoryElapsedMs=351`）。接着一次 5000ms 的等待由 `LocalGatewayLifecycleBundle.dispose()` 取消，`disposeCancelMs=1`，错误是 supervisor stopped，不是等到 5000ms。

### M2 — dist / `npm test` 入口

`npm test` 是 `npm run build && node --test --test-force-exit --test-concurrency 8 --test-timeout 300000 "dist/tests/**/*.test.js" "dist/tests/**/*.spec.js"`。`tsc` 不拷贝 `.mjs` fixture。build 现在把 `tests/cli/fixtures` 拷到 `dist/tests/cli/fixtures`。rust-core 用例在二进制不可执行时用字符串原因 skip（`{ skip: reason ?? false }`），二进制在时仍然执行。

全仓库 400 多个 spec 没有整包重跑。下面是同一条 `node --test` 入口，只覆盖这次新增的编译规格，以及编译后的 deployment profile 规格。`tsc` 仍有既有错误 `src/cli/sdkCli.ts` 找不到 `@pilotdeck/sdk`；本改动文件没有 `error TS`（`raw/tsc.txt`）。

```text
node --test --test-force-exit --test-concurrency 8 --test-timeout 300000 \
  dist/tests/cli/agent-loop-tcp-sidecar-supervisor.spec.js
```

原始输出：`raw/dist-supervisor-tests.txt`。14 tests，pass 14，fail 0，skipped 0，exit 0。fixture `dist/tests/cli/fixtures/fake-agent-loop-tcp-sidecar.mjs` 存在且可执行。rust-core 探针：

```text
rust-core probe listen=127.0.0.1:34351 wrong=UNAUTHENTICATED hello=true executeKind=error executeCode=MISSING_EXECUTE_FIELD restartedPid=6659 again=UNAUTHENTICATED
```

同一 dist 规格，把 `PILOTDECK_T_P2_06_RUST_BIN` 指到不存在的路径：

```text
ok 14 - rust-core sidecar is supervised across a crash with the hello token # SKIP rust-core sidecar binary is not executable at /tmp/pilotdeck-missing-rust-core-bin
# tests 14
# pass 13
# fail 0
# skipped 1
```

原始输出：`raw/dist-supervisor-skip-no-bin.txt`。exit 0。这条没有静默当成 pass。dist 上的 M1 一行是 `m1 failing-restart waitMs=400 waitedMs=401 factoryMs=350 factoryElapsedMs=352 disposeCancelMs=0`。

这条用编译后的 `dist/src/cli/pilotdeck-agent-loop-sidecar.js` 跑 stdio handshake。源码树里没有旁边的 `.js`，直接对 `tests/cli/*.spec.ts` 跑这条会去找不存在的 js，那是运行方式差异，不是本次 stdio 行为变化。stdio 环境删除 `TCP_HOST` / `TCP_PORT` / `TCP_TOKEN` 的断言在 supervisor 测试里，带 `SUPERVISE=1` 和 `RUST_SIDECAR_BIN` 仍删除这三项。

`tsc` 另有一处既有错误，与本改动无关：`src/cli/sdkCli.ts` 找不到 `@pilotdeck/sdk` 的类型声明。本改动文件没有 `error TS`。

## 自检（P1–P10）

| # | 结果 | 证据 |
|---|---|---|
| P1 | pass | 无 `apps/` `ui/` `packages/` `crates/` 产品改动。根 `package.json` 只给 build 增加 fixture 拷贝 |
| P2 | pass | supervise 测试不预起 sidecar。stderr 日志含 `listening 127.0.0.1:<port>`。gateway 测试同样先 `createLocalGateway` 再连上 |
| P3 | pass | `SIGKILL` 后 5s 内新 pid、再次 hello/execute。固定端口用例重启后端口不变 |
| P4 | pass | rust-core：错 token `UNAUTHENTICATED`、正确 hello ok、重启后仍成立，响应与 `outputTail()` 不含 token。dist 路径在二进制存在时同样跑过 |
| P5 | pass | 未设 transport，即使 `SUPERVISE=1`，profile 仍是 `native`。deployment profile 测试默认 native |
| P6 | pass | stdio profile 仍删除 TCP_HOST/PORT/TOKEN。编译后的 stdio sidecar handshake 通过 |
| P7 | pass | 不设 supervise，只给 HOST+PORT，profile 无 `supervise`，连外部 fake listener |
| P8 | pass | `stop()` 后 300ms 内进程已死且 `restartCount` 不变。gateway `dispose()` 后端口不再接受连接。失败重启的 in-flight `waitForAddress` 由 dispose 取消（`disposeCancelMs=1`） |
| P9 | pass | `raw/supervisor-tests.txt` 覆盖拉起、崩溃续上和失败重启超时，14 pass / 0 fail，exit 0 |
| M1 | pass | 持续失败的重启下，400ms / 350ms 等待在上限内拒绝；dispose 取消 5000ms 等待。见 `raw/supervisor-tests.txt` 与 `raw/dist-supervisor-tests.txt` |
| M2 | pass | fixture 进入 `dist/tests/cli/fixtures`。dist 规格 14 pass。缺二进制时 rust-core 用例 skip，13 pass / 1 skipped / 0 fail，exit 0。见 `raw/dist-supervisor-skip-no-bin.txt` |
| P10 | pass | `PLAN.md` 把 T-P2-06 写成进行中 / 本 PR / 未合。T-P2-02 #50、T-P2-03 #51、T-P2-05 经 #55 进入 #56、T-P2-01 D 的 deadline 切片已合且 tools 缺口仍 open。tip 头为 `d91ed18b` |

Formal 仍由 QA 复跑。本文件是实现侧自检，不是 Formal PASS。
