# PROVENANCE · T-P2-06

- 基线：`rust_standalone_alpha1` @ `d91ed18be85f6291a8858d40b82ca171c7e0404f`（#56）
- 分支：`cursor/t-p2-06-ts-supervisor-1361`
- 规格：上传的冻结 `TASK_DEF`（sha256 `b0405a32cd97267aadb3b81acecadd096600dcba19974bb9891d68eb573c0fba`）
- 解锁：`unlocked=true`。本 PR 保持 draft。ready / merge 仍等真 Payne
- 工作树相对基线的产品改动只在 `src/cli/**`、`tests/**`、`review/2026-10-17-T-P2-06/**`、`docs/rust_rebuild/PLAN.md`、`docs/rust_rebuild/PR_LOG.md`

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

原始输出：`raw/supervisor-tests.txt`。13 tests，pass 13，fail 0，exit 0。

其中 rust-core 探针一行：

```text
rust-core probe listen=127.0.0.1:40891 wrong=UNAUTHENTICATED hello=true executeKind=error executeCode=MISSING_EXECUTE_FIELD restartedPid=5587 again=UNAUTHENTICATED
```

错 token 为 `UNAUTHENTICATED` 且响应不含 token；正确 hello 为 ok；缺字段的 execute 立即返回 `MISSING_EXECUTE_FIELD`（协议错误，不是挂起）。`SIGKILL` 后新 pid 在 5s 窗口内再次拒绝错 token。

```text
pnpm exec tsc -p tsconfig.json
node --test --test-force-exit --test-timeout 120000 \
  dist/tests/cli/agent-loop-deployment-profile.spec.js
```

原始输出：`raw/deployment-profile-tests.txt`。6 tests，pass 6，fail 0，exit 0。

这条用编译后的 `dist/src/cli/pilotdeck-agent-loop-sidecar.js` 跑 stdio handshake。源码树里没有旁边的 `.js`，直接对 `tests/cli/*.spec.ts` 跑这条会去找不存在的 js，那是运行方式差异，不是本次 stdio 行为变化。stdio 环境删除 `TCP_HOST` / `TCP_PORT` / `TCP_TOKEN` 的断言在 supervisor 测试里，带 `SUPERVISE=1` 和 `RUST_SIDECAR_BIN` 仍删除这三项。

`tsc` 另有一处既有错误，与本改动无关：`src/cli/sdkCli.ts` 找不到 `@pilotdeck/sdk` 的类型声明。本改动文件没有 `error TS`。

## 自检（P1–P10）

| # | 结果 | 证据 |
|---|---|---|
| P1 | pass | diff 只含白名单路径。无 `apps/` `ui/` `packages/` `crates/` 产品改动 |
| P2 | pass | supervise 测试不预起 sidecar。stderr 日志含 `listening 127.0.0.1:<port>`。gateway 测试同样先 `createLocalGateway` 再连上 |
| P3 | pass | `SIGKILL` 后 5s 内新 pid、再次 hello/execute。固定端口用例重启后端口不变 |
| P4 | pass | rust-core：错 token `UNAUTHENTICATED`、正确 hello ok、重启后仍成立，响应与 `outputTail()` 不含 token |
| P5 | pass | 未设 transport，即使 `SUPERVISE=1`，profile 仍是 `native`。deployment profile 测试默认 native |
| P6 | pass | stdio profile 仍删除 TCP_HOST/PORT/TOKEN。编译后的 stdio sidecar handshake 通过 |
| P7 | pass | 不设 supervise，只给 HOST+PORT，profile 无 `supervise`，连外部 fake listener |
| P8 | pass | `stop()` 后 300ms 内进程已死且 `restartCount` 不变。gateway `dispose()` 后端口不再接受连接 |
| P9 | pass | `raw/supervisor-tests.txt` 覆盖拉起和崩溃续上，exit 0 |
| P10 | pass | `PLAN.md` 把 T-P2-06 写成进行中 / 本 PR / 未合。T-P2-02 #50、T-P2-03 #51、T-P2-05 经 #55 进入 #56、T-P2-01 D 的 deadline 切片已合且 tools 缺口仍 open。tip 头为 `d91ed18b` |

Formal 仍由 QA 复跑。本文件是实现侧自检，不是 Formal PASS。
