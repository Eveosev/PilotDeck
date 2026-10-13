# T-CI-F3 进度

- 分支：`pilotdeck-rust/T-CI-F3-node-test-scan`
- 基线：`d6ec73d824e74009c47c0254c86db194ad7ce66d`
- draft PR：https://github.com/Eveosev/PilotDeck/pull/13
- F1–F7 门禁 head：`b87550f4`（Web `38363366655` + Desktop `38363366756` 绿）
- R2 N1–N4 叠在 `b87550f4` 上；本文件随代码提交，不再追加 tip 自引用

## 扫描列表（8，未变）

相对 `ui/`：`server/adapters/staffdeck-request-context.test.js`、`server/module-request-abort.test.js`、`server/public-knowledge-model-selection.test.mjs`、`server/staffdeck-approval-authority.test.mjs`、`server/staffdeck-public-capabilities.test.mjs`、`server/staffdeck-publish-route.test.js`、`server/staffdeck-publish-runtime.test.mjs`、`server/staffdeck-runtime-readiness.test.mjs`

## 正向

```
node scripts/check-web-node-test-scan.mjs
```

exit **0**，`ok: 8 files`。

`pnpm install --frozen-lockfile --filter pilotdeck --filter pilotdeck-ui` exit **0**。lockfile 无 diff。

## N1（temp worktree，真改 `ui/vite.config.js` `test.exclude`）

```
WT=/tmp/T-CI-F3-n1
git worktree add "$WT" HEAD
# 拷入本轮 scripts/；symlink node_modules
cd /tmp/T-CI-F3-n1 && node scripts/check-web-node-test-scan.mjs
```

| 改写 | exclude 片段 | exit |
|---|---|---|
| brace 等价 | `server/{module-request-abort,module-request-abort}.test.js` 替换 abort 字面量 | **0** |
| extglob 等价 | `server/@(module-request-abort).test.js` 替换 abort 字面量 | **0** |
| brace 真漂移 | 另加 `server/routes/{config,x}.test.js` | **1**（extra `server/routes/config.test.js`） |
| extglob 真漂移 | 另加 `server/routes/@(config).test.js` | **1**（同上） |

## N2

```
mv node_modules/picomatch /tmp/picomatch-hidden-n2
node scripts/check-web-node-test-scan.mjs --print   # exit 0，仍打印 8 行
node scripts/check-web-node-test-scan.mjs           # exit 1，cannot import 'picomatch' + pnpm install --frozen-lockfile
mv /tmp/picomatch-hidden-n2 node_modules/picomatch
```

## N3

根 `vitest.config.js` 的 exclude 加 `'src/**'`：

```
cd /tmp/T-CI-F3-n1 && node scripts/check-web-node-test-scan.mjs
```

exit **0**，仍 `ok: 8 files`。输出无 `ui/src`、无 `extra vs node --test`。根 pattern 只打在相对仓库根的路径（`ui/src/...`），不会当成 `ui/` 相对的 `src/**`。

## 本地计数

- `node --test`：`# tests 40` `# pass 40` `# fail 0`
- vitest：268 files / 2204 cases

## 原始日志（不入库）

| 文件 | sha256 | 位置 |
|---|---|---|
| `n1-brace-eq.txt` | `5b199a376afb78e90664c625d313e09d6c691ac1dc7eb2f57eb0d97499be1a92` | `/tmp/T-CI-F3-node-test-scan/` |
| `n1-extglob-eq.txt` | `5b199a376afb78e90664c625d313e09d6c691ac1dc7eb2f57eb0d97499be1a92` | `/tmp/T-CI-F3-node-test-scan/` |
| `n1-brace-drift.txt` | `c54121007c3a8c86cb7f77674c26d87b2a4cd149a6a1db1807fc93df80c16b9e` | `/tmp/T-CI-F3-node-test-scan/` |
| `n1-extglob-drift.txt` | `c54121007c3a8c86cb7f77674c26d87b2a4cd149a6a1db1807fc93df80c16b9e` | `/tmp/T-CI-F3-node-test-scan/` |
| `n3-root-src.txt` | `5b199a376afb78e90664c625d313e09d6c691ac1dc7eb2f57eb0d97499be1a92` | `/tmp/T-CI-F3-node-test-scan/` |
| `n2-print.txt` | `7347bb49b69fae8609302c5f619351370912a0fd3fef568d877fe39ee24932d4` | `/tmp/T-CI-F3-node-test-scan/` |
| `n2-check-fail.txt` | `153565da739042519692c49e84ae7b4b2b7eb49b126a824f250cbe96dd333eb3` | `/tmp/T-CI-F3-node-test-scan/` |
| `node-test-r2.txt` | `fe94265e0bdf344c26f312548288c4a7328750967e27f27a8da15eed6e7f5adb` | `/tmp/T-CI-F3-node-test-scan/` |
| `vitest-r2.txt` | `6cb5da75b06ff5a2773c10068bf22e35de9b5f757ccfde39de6417f8d1b9117a` | `/tmp/T-CI-F3-node-test-scan/` |
