# T-CI-F3 进度

- 分支：`pilotdeck-rust/T-CI-F3-node-test-scan`
- 基线：`d6ec73d824e74009c47c0254c86db194ad7ce66d`
- draft PR：_pending_
- 当前 tip：_pending_

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

- Before：CI 内联 walk `ui/server`（见 PR #12 / run `38348207846`）。
- After：`node scripts/check-web-node-test-scan.mjs --print`（walk `ui/`，同一正则）。

## 匹配检查（正 / 负）

命令与退出码：

```
node scripts/check-web-node-test-scan.mjs
```

exit **0**。两边打印同一 8 文件，`ok: 8 files; vitest exclude == node --test set`。

```
node scripts/check-web-node-test-scan.mjs --extra-exclude server/does-not-exist.test.js
```

exit **1**。vitest exclude 多出 `server/does-not-exist.test.js`，node --test 仍是 8 个；stderr：`in vitest exclude but not in node --test:`。

## 本地计数

- vitest：_pending_（基线 268 files / 2204 cases）
- `node --test`：_pending_（必须保持 8 files / 40 cases / 0 fail）

装依赖前直跑 `node --test` 会因缺 `yaml` 让 `staffdeck-publish-route.test.js` 加载失败（38 tests / 1 fail）。这是环境，不是扫描集。

## 原始日志（不入库）

| 文件 | sha256 | 位置 |
|---|---|---|
| `check-ok.txt` | `d3cdb32daf68d97a84be96c6a230546f0efd596b2acf400700a0fbd7ab95c7a3` | `/tmp/T-CI-F3-node-test-scan/` |
| `check-mismatch.txt` | `a64e604daf279a1327f7c13609f5748ab6159be304f3c0f53aed469be186e5a0` | `/tmp/T-CI-F3-node-test-scan/` |
| `after-print.txt` | `7347bb49b69fae8609302c5f619351370912a0fd3fef568d877fe39ee24932d4` | `/tmp/T-CI-F3-node-test-scan/` |
| `node-test.txt` | `79e84067c22badbf6f51e5ad1d2b2692b909715cca534323382279a2803bbab1` | `/tmp/T-CI-F3-node-test-scan/`（缺依赖，非正式计数） |
