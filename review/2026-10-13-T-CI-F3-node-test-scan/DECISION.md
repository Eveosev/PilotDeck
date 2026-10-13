# T-CI-F3 — Web `node --test` 扫描集与 vitest exclude 对齐

- 基线：`rust_standalone_alpha1@d6ec73d824e74009c47c0254c86db194ad7ce66d`
- 分支：`pilotdeck-rust/T-CI-F3-node-test-scan`
- 范围：只改 CI / 测试配置 / 工具。不改产品代码，不改任何测试断言。
- R2 / R3 非 review 改动只限 `scripts/check-web-node-test-scan.mjs` 与 `scripts/lib/*.mjs`。不动 package.json / lockfile / workflow / 配置文件。
- R4 回归测试另加 `scripts/lib/__tests__/check-web-node-test-scan.test.mjs` 与 `.github/workflows/web-regression.yml`（`scripts/lib/**` path filter + 独立 `node --test` step）。

## `ui/vite.config.js` 实际改了什么（相对基线，F2/F7）

不是「只动 test 块」：

- 文件顶部：删掉内联扫描器，改为 `import { listNodeTestFiles } from '../scripts/lib/web-node-test-files.mjs'`
- `test.exclude`：仍展开同一扫描结果（函数生成：`['e2e/**', 'node_modules/**', 'dist/**', ...vitestExcludeNodeTestFiles(__dirname)]`）
- build / server / plugins：**未改**
- Desktop 触发注释已删；Desktop path filter 含 `scripts/lib/**`（不含 `scripts/check-web-node-test-scan.mjs`）

## 决策

1. `scripts/lib/web-node-test-files.mjs`：唯一 `from/import 'node:test'` 扫描；CI `--print` 用它跑 `node --test`。
2. 两边 config import 它展开 `test.exclude`。
3. `scripts/check-web-node-test-scan.mjs` 加载生效 `config.test.exclude`，与 `node --test` 集比较。
4. **N1**：是否 glob 用 `picomatch.scan(p).isGlob`（brace `{a,b}`、extglob `@(x)` 都算 glob）。
5. **N2**：picomatch 仅在匹配时 `await import('picomatch')`；失败用 `formatMissingDepError`（包名 + `pnpm install --frozen-lockfile`）。`--print` 不加载根依赖。
6. **N3**：根 `vitest.config.js` 的 pattern 只匹配相对仓库根的路径；`ui/vite.config.js` 的 pattern 只匹配相对 `ui/` 的路径。根上加 `src/**` 不得把 `ui/src` 算进 Web 集。
7. **N4**：vite/vitest 解析失败合成 `scripts/lib/resolve-from-ui.mjs` 的 `resolveUiPackage`。
8. **m1**：`loadPicomatch` 静态引入 `resolve-from-ui.mjs`，不再动态 import 该 helper。picomatch import 失败走 `formatMissingDepError`，不再使用 `formatResolveError`。
9. **m2**：所有安装提示统一为 `pnpm install --frozen-lockfile`。
10. **m3**：`!pattern` 必须在 `scan().isGlob` 之前单独跳过（`!x` 与单元素 brace `server/{x}.test.js` 的 `isGlob` 都是 false，否则会掉进字面路径分支误报）。字面路径（含 `isGlob === false` 的 `{x}`）先 `existsSync`；文件不存在不得当漂移。tinyglobby 丢弃 `!x`（不是 re-include）。
11. **m4**：解析不到 vite 或 vitest 时只输出一行明确提示、exit 非 0、不打堆栈。`--print` 仍不依赖它们。
12. **R4 F1**：`startsWith("!")` 会把 extglob `!(src)/…` 当 tinyglobby 丢弃的 `!x` 而 fail-open。跳过条件改为 `pattern[0] === "!" && pattern[1] !== "("`。Reviewer 原例 `!(src)/**/projects.test.js` 必须匹配 `server/projects.test.js` 并 exit 1（`6a20f6ed` 为 exit 0）；`!(src)/routes/config.test.js` 仍 exit 1（与 `73761b17` 一致）；`!x` / `!server/does-not-exist.test.js` 仍跳过、exit 0。
13. **R4 F2**：`failResolve` 只压缩缺依赖（`isMissingDepError`：`formatMissingDepError` / `resolveUiPackage`）为一行；vite.config 语法错误等必须带原 stack / file:line。
14. **R4 F3**：`resolveUiPackage("vite")` 只解析一次，结果传给 `loadUiViteConfig`。
15. **R4 回归测试**：`scripts/lib/__tests__/check-web-node-test-scan.test.mjs` 对临时 fixture vite config 跑完整 check（不改真实 `ui/vite.config.js`）。Web CI 独立 step：`node --test 'scripts/lib/__tests__/**/*.mjs'`。`pull_request` path filter 含 `scripts/lib/**`。F2 测试只断言 exit 1 且输出含 file:line；语法错误仍抛原 stack。
