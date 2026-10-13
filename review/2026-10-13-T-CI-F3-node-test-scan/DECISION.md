# T-CI-F3 — Web `node --test` 扫描集与 vitest exclude 对齐

- 基线：`rust_standalone_alpha1@d6ec73d824e74009c47c0254c86db194ad7ce66d`
- 分支：`pilotdeck-rust/T-CI-F3-node-test-scan`
- 范围：只改 CI / 测试配置 / 工具。不改产品代码，不改任何测试断言。
- 来源：PR #12 review follow-up（F3）。当时 CI 内联 walk `ui/server`，vitest 用 `ui/vite.config.js` 的 `vitestExcludeNodeTestFiles(__dirname)`，正则相同但两份拷贝，会漂。

## 决策

共用一份扫描器，再用检查脚本锁死两边解析结果：

1. `scripts/lib/web-node-test-files.mjs`：唯一 `from/import 'node:test'` 扫描。
2. `ui/vite.config.js` 与根 `vitest.config.js` 都 import 它（Web suite 仍从 `ui/` 扫）。
3. Web Regression step `Test Web UI node:test files` 先跑 `scripts/check-web-node-test-scan.mjs`，再用 `--print` 的同一列表 `node --test`。
4. 检查脚本：vitest exclude（node:test）必须等于 node --test 集；node --test 不得收入无 `node:test` import 的 vitest 文件。`--extra-exclude` 只加到 exclude 侧，用来证明失配时非 0。

不写死 8 个路径：新的 `ui/**` `node:test` 文件会同时被排除并被跑。当前解析结果仍是那 8 个文件。

## 不改

- 产品代码
- 任何测试断言 / timeout / skip / only
- Docker / 其他 workflow
