# T-CI-F3 — Web `node --test` 扫描集与 vitest exclude 对齐

- 基线：`rust_standalone_alpha1@d6ec73d824e74009c47c0254c86db194ad7ce66d`
- 分支：`pilotdeck-rust/T-CI-F3-node-test-scan`
- 范围：只改 CI / 测试配置 / 工具。不改产品代码，不改任何测试断言。
- R2（N1–N4）非 review 改动只限 `scripts/check-web-node-test-scan.mjs` 与 `scripts/lib/*.mjs`。不动 package.json / lockfile / workflow / 配置文件。

## `ui/vite.config.js` 实际改了什么（相对基线，F2/F7）

不是「只动 test 块」：

- 文件顶部：删掉内联扫描器，改为 `import { listNodeTestFiles } from '../scripts/lib/web-node-test-files.mjs'`
- `test.exclude`：仍展开同一扫描结果
- build / server / plugins：**未改**
- Desktop 触发注释已删；Desktop path filter 含 `scripts/lib/**`（不含 `scripts/check-web-node-test-scan.mjs`）

## 决策

1. `scripts/lib/web-node-test-files.mjs`：唯一 `from/import 'node:test'` 扫描；CI `--print` 用它跑 `node --test`。
2. 两边 config import 它展开 `test.exclude`。
3. `scripts/check-web-node-test-scan.mjs` 加载生效 `config.test.exclude`，与 `node --test` 集比较。
4. **N1**：是否 glob 用 `picomatch.scan(p).isGlob`（brace `{a,b}`、extglob `@(x)` 都算 glob）。
5. **N2**：picomatch 仅在匹配时 `await import('picomatch')`；失败打包名 + `pnpm install --frozen-lockfile`。`--print` 不加载根依赖。
6. **N3**：根 `vitest.config.js` 的 pattern 只匹配相对仓库根的路径；`ui/vite.config.js` 的 pattern 只匹配相对 `ui/` 的路径。根上加 `src/**` 不得把 `ui/src` 算进 Web 集。
7. **N4**：vite/vitest 解析失败的 try/catch 合成 `scripts/lib/resolve-from-ui.mjs` 的 `resolveUiPackage` / `formatResolveError`。
