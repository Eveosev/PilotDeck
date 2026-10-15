# T-P2-01

基线：`rust_standalone_alpha1` @ `4fe9bba19530d5f879e6d89d5a5b312df081f43e`（#44 merge）。
分支：`cursor/t-p2-01-agent-loop-f8ea`。Draft PR 目标 `rust_standalone_alpha1`。线性历史，不 rebase、不 amend、不 force-push。

解锁：Real Payne 1:1，2026-10-15 约 21:27 UTC+8。当晚完成 P2 AgentLoop（RustLoop）重构。
范围：Track A + Track B，这一条 PR 只做核心 AgentLoop。工具与 53 场景分诊不在这里。

## 四项目标

1. 真 host provider 路径。`prepare` 成功且 `payload.prepared.request` 是 object 时，后续 `stream` / `stream_next` 发送这份请求，否则退回 prepare 之前的请求。这和 host `sidecarDefaultModuleDispatcher` 用 stream payload 覆盖已保存 request、以及 `hostModelInvokerPort` 对流发送 `prepared.request` 一致。`--model-ms` 仍是 parity harness，不是这条路径。
2. mR2-1。耐久 thinking 块保留最后一条非空 `signature`，并拼接 `reasoningContent`。空 signature 不写入，也不清掉已有的非空 signature。规则对齐 `src/model/streaming/assembleModelMessage.ts` 的 `applyModelEventToAssembler` / `flushTextBuffers`。第二轮 `prepare` 的 messages 带上这块，Anthropic 一类要求 signature 的 provider 才不会拒。
3. stdio 与 TCP 的最小场景对齐。G5 真实 client payload，以及 `scripts/b4-tcp-host.mjs` 的 B4 对话，stdio 和 TCP 都跑。
4. D7。只做代码里已经有的最小面：TCP hello 的 `payload.token`，比较方式与 Gateway `hello.token` 同类（常量时间比较）。环境变量 `PILOTDECK_AGENT_LOOP_TCP_TOKEN`。未设置时仍是现在的开放 loopback。错误码用已有的 response/error 信封，`UNAUTHENTICATED`。不回显 token。不新增消息种类，不改协议 schema。stdio 不校验这个 token，stdio 部署 profile 会从子进程环境里删掉它，避免 child 继承密钥。

## 为什么改了 `src/**`

host 必须能把同一个 token 放进 hello，真实部署才用得上 D7。

- `src/cli/AgentLoopDeploymentProfile.ts`：TCP profile 在环境变量非空时带上 `authToken`，传给 sidecar runtime factory。stdio profile 删除 `PILOTDECK_AGENT_LOOP_TCP_TOKEN`，与已有的 TCP host/port 删除同一理由。YAML `module-tcp-v2` binding 也读这个环境变量，没有新配置字段。
- `src/agent/modules/transport/agentLoopSidecarClient.ts`：只在 hello 的 payload 上放 `{ token }`。capabilities 仍是 `{}`。
- `tests/cli/agent-loop-deployment-profile.spec.ts`：锁住「未设置则不发明 token」和「stdio 不继承 token」。本环境没有完整 workspace `node_modules`（spec 经 `src/agent/index.ts` 拉到 `edgeclaw-memory-core` 等），这条 node spec 没有跑。Rust crate 测试已跑通。

## 真模型 E2E

脚本：`crates/pilotdeck-agent-loop/scripts/real-model-e2e.mjs`。
它用仓库 devDependency `tsx` 加载生产 `createModelRuntime` / `streamModel`（源码里有 parameter property，Node strip-only 加载不了）。密钥只留在环境变量里，脚本不打印。

无 key（本环境就是这样；`credential=absent`，不是计费调用）：

```bash
node crates/pilotdeck-agent-loop/scripts/real-model-e2e.mjs \
  --bin target/debug/pilotdeck-agent-loop
```

有 key（脚本不替你选 model id）：

```bash
PILOTDECK_REAL_MODEL_PROVIDER=openai|anthropic|google \
PILOTDECK_REAL_MODEL=<model id> \
OPENAI_API_KEY=... \
  node crates/pilotdeck-agent-loop/scripts/real-model-e2e.mjs \
  --bin target/debug/pilotdeck-agent-loop
```

`ANTHROPIC_API_KEY`，或 `GEMINI_API_KEY` / `GOOGLE_API_KEY`，在未设置 `PILOTDECK_REAL_MODEL_PROVIDER` 时选择对应 provider。可选 `PILOTDECK_REAL_MODEL_BASE_URL`。

本环境没有上述 key。fixture 跑通的记录在 `evidence/p1/t-p2-01-real-model.json`（新文件，不覆盖已有 `evidence/p1/*.json`）。outcome `completed`，`mockModelMs` false。Q2 在真模型之后只要求正常返回。没有 live key，所以没有测 A8 / FT-2a，也不报延迟数字。

TCP 认证：

```bash
PILOTDECK_AGENT_LOOP_TCP_TOKEN=<secret> \
  target/debug/pilotdeck-agent-loop --listen 127.0.0.1:0
```

## 测试

`cargo test -p pilotdeck-agent-loop` 在本环境退出码 0。
锁行为的测试包括：

- `thinking_signature_round_trip_keeps_last_non_empty_signature`
- `empty_thinking_signature_is_not_invented`
- `stream_uses_host_prepared_request`
- `tcp_auth_token_gates_hello_and_later_methods`
- `tcp_auth_token_rejects_anonymous_hello`
- stdio / TCP 的 G5 与 B4
- `real_model_stdio_fixture_returns_completed`（会清掉 key，固定走 fixture）

## 不在本 PR

- FT-2a。只有带 key 的运行仍超过 Q2 阈值时才另开。
- 53 场景里失败/阻塞的分诊，以及 tools m2/m4/m5/m6/E1/n1/n3。
- 关闭 PC1#3 / PC3。
- `ui/**`、`apps/**`、协议 schema。
