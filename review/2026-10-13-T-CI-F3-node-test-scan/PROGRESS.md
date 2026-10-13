# T-CI-F3 进度

- 分支：`pilotdeck-rust/T-CI-F3-node-test-scan`
- 基线：`d6ec73d824e74009c47c0254c86db194ad7ce66d`
- draft PR：https://github.com/Eveosev/PilotDeck/pull/13
- 当前 tip：`e148d594c19c4802d643de9dc831bccc04d60331`（实现；本文件回填后会再戳 tip）
- CI（实现 tip）：https://github.com/Eveosev/PilotDeck/actions/runs/38356348095 （Web Regression，进行中）

## Before / after 扫描列表

两边都是相对 `ui/` 的 8 个路径，集合相同：

1. `server/adapters/staffdeck-request-context.test.js`
2. `server/module-request-abort.test.js`
3. `server/public-knowledge-model-selection.test.mjs`
4. `server/staffdeck-approval-authority.test.mjs`
5. `server/staffdeck-public-capabilities.test.mjs`
6. `server/staffdeck-publish-route.test.js`
7. `server/staffdeck-publish-runtime.test.mjs`
8. `server/staffdeck-runtime-readiness.test.mjs`

- Before：CI 内联 walk `ui/server`（PR #12 / run `38348207846`）。
- After：`node scripts/check-web-node-test-scan.mjs --print`（walk `ui/`，同一正则）。

## 匹配检查（正 / 负）

```
node scripts/check-web-node-test-scan.mjs
```

exit **0**。两边打印同一 8 文件，`ok: 8 files; vitest exclude == node --test set`。

```
node scripts/check-web-node-test-scan.mjs --extra-exclude server/does-not-exist.test.js
```

exit **1**。vitest exclude 多出 `server/does-not-exist.test.js`，node --test 仍是 8 个；stderr：`in vitest exclude but not in node --test:`。

## 本地计数

与 Web Regression 相同命令：

- vitest：`Test Files 268 passed (268)` / `Tests 2204 passed (2204)`，0 fail
- `node --test`：8 files，`# tests 40` `# pass 40` `# fail 0`

## 原始日志（不入库）

| 文件 | sha256 | 位置 |
|---|---|---|
| `check-ok.txt` | `d3cdb32daf68d97a84be96c6a230546f0efd596b2acf400700a0fbd7ab95c7a3` | `/tmp/T-CI-F3-node-test-scan/` |
| `check-mismatch.txt` | `a64e604daf279a1327f7c13609f5748ab6159be304f3c0f53aed469be186e5a0` | `/tmp/T-CI-F3-node-test-scan/` |
| `after-print.txt` | `7347bb49b69fae8609302c5f619351370912a0fd3fef568d877fe39ee24932d4` | `/tmp/T-CI-F3-node-test-scan/` |
| `node-test-after.txt` | `33423e377864b17eb4d9fadb3ceee1590db9e8d7b69be974a3c11dcc00bc042f` | `/tmp/T-CI-F3-node-test-scan/` |
| `vitest.txt` | `86906782973e3c42fecba7827294a89376c16be89cfeb632cf219bb8d100e04e` | `/tmp/T-CI-F3-node-test-scan/` |
