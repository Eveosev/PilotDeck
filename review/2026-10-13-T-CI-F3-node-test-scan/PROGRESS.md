# T-CI-F3 进度

- 分支：`pilotdeck-rust/T-CI-F3-node-test-scan`
- 基线：`d6ec73d824e74009c47c0254c86db194ad7ce66d`
- draft PR：https://github.com/Eveosev/PilotDeck/pull/13
- 上一门禁 head：`a84ff5b6`（Web `38357331902` + Desktop `38357331918` 绿）
- Reviewer F1–F7 叠在 `848ddb7c` 之上；本文件随该提交，CI 链接见 PR 评论 / 本轮回报（提交后不再为 stamp CI 加 commit）

## Before / after 扫描列表

相对 `ui/` 的 8 个路径，before（PR #12 内联 walk `ui/server`）与 after（`--print` + 两边生效 `test.exclude` + picomatch）相同：

1. `server/adapters/staffdeck-request-context.test.js`
2. `server/module-request-abort.test.js`
3. `server/public-knowledge-model-selection.test.mjs`
4. `server/staffdeck-approval-authority.test.mjs`
5. `server/staffdeck-public-capabilities.test.mjs`
6. `server/staffdeck-publish-route.test.js`
7. `server/staffdeck-publish-runtime.test.mjs`
8. `server/staffdeck-runtime-readiness.test.mjs`

## 匹配检查（正）

```
node scripts/check-web-node-test-scan.mjs
```

exit **0**。两边生效 exclude（ui 子集）与 `node --test` 三集相同，各 8 文件。

`pnpm install --frozen-lockfile --filter pilotdeck --filter pilotdeck-ui` exit **0**。lockfile 只改了 `importers.:.devDependencies.picomatch`（`^4.0.4` → `4.0.4`）；`packages:` 无新包。

## F1 负向 / 等价改写（temp worktree，真改 `test.exclude`）

```
WT=/tmp/T-CI-F3-f1
git worktree add "$WT" HEAD
# 拷入本轮 scripts/ + 去注释后的 ui/vite.config.js；symlink node_modules
```

**(a) `?` glob 多收一个真实 vitest 文件 → 必须非 0**

```
exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'server/routes/config.test.j?', ...vitestExcludeNodeTestFiles(__dirname)],
cd /tmp/T-CI-F3-f1 && node scripts/check-web-node-test-scan.mjs
```

exit **1**。`ui/vite.config.js: extra vs node --test: server/routes/config.test.js`

**(b) 等价零深度 `**` 改写 → 必须 0**

```
exclude: ['e2e/**', 'node_modules/**', 'dist/**', ...vitestExcludeNodeTestFiles(__dirname).map((f) => f === 'server/module-request-abort.test.js' ? 'server/**/module-request-abort.test.js' : f)],
cd /tmp/T-CI-F3-f1 && node scripts/check-web-node-test-scan.mjs
```

exit **0**。`ok: 8 files; both effective excludes == node --test set`

然后 `git worktree remove --force /tmp/T-CI-F3-f1`。仓内 `test.exclude` 仍是共享扫描展开，无 Desktop 触发注释。

## 本地计数

- 检查 exit 0
- `node --test`：8 files，`# tests 40` `# pass 40` `# fail 0`
- vitest：`Test Files 268 passed (268)` / `Tests 2204 passed (2204)`

## 原始日志（不入库）

| 文件 | sha256 | 位置 |
|---|---|---|
| `check-ok-f1.txt` | `5b199a376afb78e90664c625d313e09d6c691ac1dc7eb2f57eb0d97499be1a92` | `/tmp/T-CI-F3-node-test-scan/` |
| `f1-a.txt` | `c54121007c3a8c86cb7f77674c26d87b2a4cd149a6a1db1807fc93df80c16b9e` | `/tmp/T-CI-F3-node-test-scan/` |
| `f1-b.txt` | `5b199a376afb78e90664c625d313e09d6c691ac1dc7eb2f57eb0d97499be1a92` | `/tmp/T-CI-F3-node-test-scan/` |
| `node-test-f1.txt` | `5d3f183bfdfcbf17b4d91fbf32d9e9417c63ca2bfd6c60bf27deddf67899341c` | `/tmp/T-CI-F3-node-test-scan/` |
| `vitest-f1.txt` | `9eec67e28391c7d0adf0ce5d71850389409f79a4d0fe93dda9e98691e790e2a7` | `/tmp/T-CI-F3-node-test-scan/` |
