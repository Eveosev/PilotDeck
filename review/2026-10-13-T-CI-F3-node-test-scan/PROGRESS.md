# T-CI-F3 进度

- 分支：`pilotdeck-rust/T-CI-F3-node-test-scan`
- 基线：`d6ec73d824e74009c47c0254c86db194ad7ce66d`
- draft PR：https://github.com/Eveosev/PilotDeck/pull/13
- F1–F7 门禁 head：`b87550f4`（Web `38363366655` + Desktop `38363366756` 绿）
- R2 N1–N4 门禁 head：`73761b17`（Web `38367190138` + Desktop `38367190242` 绿）
- R3 m1–m4 叠在 `73761b17` 上；本文件随代码提交，不再追加 tip 自引用

## 扫描列表（8，未变）

相对 `ui/`：`server/adapters/staffdeck-request-context.test.js`、`server/module-request-abort.test.js`、`server/public-knowledge-model-selection.test.mjs`、`server/staffdeck-approval-authority.test.mjs`、`server/staffdeck-public-capabilities.test.mjs`、`server/staffdeck-publish-route.test.js`、`server/staffdeck-publish-runtime.test.mjs`、`server/staffdeck-runtime-readiness.test.mjs`

## 正向

```
node scripts/check-web-node-test-scan.mjs
```

exit **0**，`ok: 8 files`。

`pnpm install --frozen-lockfile --filter pilotdeck --filter pilotdeck-ui` exit **0**。lockfile 无 diff。

## m1 / m2

- `loadPicomatch` 顶部静态 `import { formatMissingDepError, resolveUiPackage } from "./lib/resolve-from-ui.mjs"`，内部只 `await import("picomatch")`。
- picomatch 失败走 `formatMissingDepError`；vite/vitest 失败走 `resolveUiPackage`。两处安装提示都是 `pnpm install --frozen-lockfile`。`formatResolveError` 已删除。

## m3（temp worktree，真改 `ui/vite.config.js` `test.exclude`）

exclude 是函数生成的。每次改完先 `vite.loadConfigFromFile` dump 生效数组，确认新 pattern 已在 `config.test.exclude` 里，再跑 check。

`picomatch.scan().isGlob`：`server/{x}.test.js` = false；`!x` = false；`{config,x}` / `@(config)` = true。

```
WT=/tmp/T-CI-F3-r3
git worktree add --detach "$WT" HEAD
# 拷入本轮 scripts/；symlink node_modules
cd /tmp/T-CI-F3-r3 && node scripts/check-web-node-test-scan.mjs
```

| 改写 | exclude 片段 | 生效 exclude 含该 pattern | exit |
|---|---|---|---|
| 单元素 brace（isGlob false → 字面 + exists） | `server/{x}.test.js` | 是 | **0** |
| 取反（isGlob 之前跳过） | `!server/does-not-exist.test.js` | 是 | **0** |
| 不存在的字面路径 | `server/does-not-exist.test.js` | 是 | **0** |
| brace 真漂移 | `server/routes/{config,x}.test.js` | 是 | **1**（extra `server/routes/config.test.js`） |
| extglob 真漂移 | `server/routes/@(config).test.js` | 是 | **1**（同上） |
| 存在的字面真漂移 | `server/routes/config.test.js` | 是 | **1**（同上） |

## m4

分别挪走 `ui/node_modules/vite` / `ui/node_modules/vitest`：

```
mv ui/node_modules/vite /tmp/vite-hidden-r3
node scripts/check-web-node-test-scan.mjs           # exit 1，恰好 1 行，无堆栈
node scripts/check-web-node-test-scan.mjs --print   # exit 0，仍打印 8 行
mv /tmp/vite-hidden-r3 ui/node_modules/vite
# vitest 同样
```

| 隐藏 | check exit | 行数 | 堆栈 | `--print` |
|---|---|---|---|---|
| vite | **1** | 1 | 无 | exit **0**，8 行 |
| vitest | **1** | 1 | 无 | exit **0**，8 行 |

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
| `m3-brace-x.txt` | `1eb84dfb3bd0f2485fbdc7539535f760011ad73618895c8d7ace8ef48acd1d95` | `/tmp/T-CI-F3-node-test-scan/` |
| `m3-negation.txt` | `1eb84dfb3bd0f2485fbdc7539535f760011ad73618895c8d7ace8ef48acd1d95` | `/tmp/T-CI-F3-node-test-scan/` |
| `m3-missing-literal.txt` | `1eb84dfb3bd0f2485fbdc7539535f760011ad73618895c8d7ace8ef48acd1d95` | `/tmp/T-CI-F3-node-test-scan/` |
| `m3-brace-drift.txt` | `3ca9137a368649502a8e395133ab3cba27541573b453521502744c956a5e04b2` | `/tmp/T-CI-F3-node-test-scan/` |
| `m3-extglob-drift.txt` | `3ca9137a368649502a8e395133ab3cba27541573b453521502744c956a5e04b2` | `/tmp/T-CI-F3-node-test-scan/` |
| `m3-literal-drift.txt` | `3ca9137a368649502a8e395133ab3cba27541573b453521502744c956a5e04b2` | `/tmp/T-CI-F3-node-test-scan/` |
| `m3-print.txt` | `7347bb49b69fae8609302c5f619351370912a0fd3fef568d877fe39ee24932d4` | `/tmp/T-CI-F3-node-test-scan/` |
| `m4-hide-vite-check.txt` | `4398a77bfb865d48313e670b3b4a9a5da574562617d65dea0db10a6008d5b720` | `/tmp/T-CI-F3-node-test-scan/` |
| `m4-hide-vite-print.txt` | `cf7cfec2b80ba8140fe135b084886a50259d174ca2159d9c9ec4514b448f57f7` | `/tmp/T-CI-F3-node-test-scan/` |
| `m4-hide-vitest-check.txt` | `a47cf2ce4bcb9f474727a2832050c6b45fee21371c4325e827ba6241d0850c7f` | `/tmp/T-CI-F3-node-test-scan/` |
| `m4-hide-vitest-print.txt` | `cf7cfec2b80ba8140fe135b084886a50259d174ca2159d9c9ec4514b448f57f7` | `/tmp/T-CI-F3-node-test-scan/` |
| `check-ok-r3.txt` | `5b199a376afb78e90664c625d313e09d6c691ac1dc7eb2f57eb0d97499be1a92` | `/tmp/T-CI-F3-node-test-scan/` |
| `node-test-r3.txt` | `2075bbd5013601fe2e6e2f59cb94c74c36fb09e32e7dd2154d8e9b451eb7acdd` | `/tmp/T-CI-F3-node-test-scan/` |
| `vitest-r3.txt` | `98f766449baa6280ddcd0cdaee57f047646f66e5cb3c296cd60b8b8d1ba6d33e` | `/tmp/T-CI-F3-node-test-scan/` |
| `n1-brace-eq.txt` | `5b199a376afb78e90664c625d313e09d6c691ac1dc7eb2f57eb0d97499be1a92` | `/tmp/T-CI-F3-node-test-scan/` |
| `n1-extglob-eq.txt` | `5b199a376afb78e90664c625d313e09d6c691ac1dc7eb2f57eb0d97499be1a92` | `/tmp/T-CI-F3-node-test-scan/` |
| `n1-brace-drift.txt` | `c54121007c3a8c86cb7f77674c26d87b2a4cd149a6a1db1807fc93df80c16b9e` | `/tmp/T-CI-F3-node-test-scan/` |
| `n1-extglob-drift.txt` | `c54121007c3a8c86cb7f77674c26d87b2a4cd149a6a1db1807fc93df80c16b9e` | `/tmp/T-CI-F3-node-test-scan/` |
| `n3-root-src.txt` | `5b199a376afb78e90664c625d313e09d6c691ac1dc7eb2f57eb0d97499be1a92` | `/tmp/T-CI-F3-node-test-scan/` |
| `n2-print.txt` | `7347bb49b69fae8609302c5f619351370912a0fd3fef568d877fe39ee24932d4` | `/tmp/T-CI-F3-node-test-scan/` |
| `n2-check-fail.txt` | `153565da739042519692c49e84ae7b4b2b7eb49b126a824f250cbe96dd333eb3` | `/tmp/T-CI-F3-node-test-scan/` |
| `node-test-r2.txt` | `fe94265e0bdf344c26f312548288c4a7328750967e27f27a8da15eed6e7f5adb` | `/tmp/T-CI-F3-node-test-scan/` |
| `vitest-r2.txt` | `6cb5da75b06ff5a2773c10068bf22e35de9b5f757ccfde39de6417f8d1b9117a` | `/tmp/T-CI-F3-node-test-scan/` |
