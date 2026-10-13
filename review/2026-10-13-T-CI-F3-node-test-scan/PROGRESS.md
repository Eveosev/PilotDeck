# T-CI-F3 进度

- 分支：`pilotdeck-rust/T-CI-F3-node-test-scan`
- 基线：`d6ec73d824e74009c47c0254c86db194ad7ce66d`
- draft PR：https://github.com/Eveosev/PilotDeck/pull/13
- 当前 tip / 门禁 head：`a84ff5b6b8c8dbb1f34c59ee2d994808049e2dc4`
- Web Regression：**success** https://github.com/Eveosev/PilotDeck/actions/runs/38357331902 （web + docker；check `ok: 8 files`；`# tests 40` `# pass 40` `# fail 0`；vitest 268 / 2204）
- Desktop（`ui/**`）：**success** https://github.com/Eveosev/PilotDeck/actions/runs/38357331918 （Checks + Linux/macOS/Windows 全绿）

## Before / after 扫描列表

相对 `ui/` 的 8 个路径，before（PR #12 内联 walk `ui/server`）与 after（`--print` + 两边生效 `test.exclude`）相同：

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

exit **0**。`ui/vite.config.js` exclude、`vitest.config.js` exclude（ui 子集）、`node --test` 三集相同，各 8 文件。

## 负向（temp worktree，真改 exclude）

在 `a84ff5b6` 上 `git worktree add /tmp/T-CI-F3-neg HEAD`，symlink `node_modules` / `ui/node_modules`：

**加一条**（`ui/vite.config.js` 仅 `test.exclude`）：

```
exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'server/routes/config.test.js', ...vitestExcludeNodeTestFiles(__dirname)],
cd /tmp/T-CI-F3-neg && node scripts/check-web-node-test-scan.mjs
```

exit **1**。`ui/vite.config.js: extra vs node --test: server/routes/config.test.js`

**删一条**（先恢复再改同一行）：

```
exclude: ['e2e/**', 'node_modules/**', 'dist/**', ...vitestExcludeNodeTestFiles(__dirname).filter((f) => f !== 'server/module-request-abort.test.js')],
cd /tmp/T-CI-F3-neg && node scripts/check-web-node-test-scan.mjs
```

exit **1**。`ui/vite.config.js: missing vs node --test: server/module-request-abort.test.js`

然后 `git worktree remove --force /tmp/T-CI-F3-neg`。仓内 `ui/vite.config.js` 的 exclude 未改。

## 本地计数

- 检查 exit 0
- `node --test`：8 files，`# tests 40` `# pass 40` `# fail 0`
- vitest（上一轮，exclude 未改行为）：268 files / 2204 cases

## 原始日志（不入库）

| 文件 | sha256 | 位置 |
|---|---|---|
| `check-ok-effective.txt` | `5b199a376afb78e90664c625d313e09d6c691ac1dc7eb2f57eb0d97499be1a92` | `/tmp/T-CI-F3-node-test-scan/` |
| `neg-add.txt` | `c54121007c3a8c86cb7f77674c26d87b2a4cd149a6a1db1807fc93df80c16b9e` | `/tmp/T-CI-F3-node-test-scan/` |
| `neg-remove.txt` | `023f0a0509b251b4730841e06a6544fc5246e28d238bca6a0cceb46c3227b05c` | `/tmp/T-CI-F3-node-test-scan/` |
| `node-test-effective.txt` | `77a0215c6d124b00a953500a0f0e5281add0f3c7c658d1e360a7746cbe812f9e` | `/tmp/T-CI-F3-node-test-scan/` |
