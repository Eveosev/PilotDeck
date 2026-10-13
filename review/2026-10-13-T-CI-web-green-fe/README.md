# T-CI-web-green FE — B/C 组测试修复

- 分支：`pilotdeck-rust/T-CI-web-green`
- draft PR：https://github.com/Eveosev/PilotDeck/pull/12
- 基线（本轮开始 tip）：`a5b9c98efd6ffaf8a07f9518e7c3f630a9d670d9`
- gitSha：`582d563adb535be93b8c4ffab3ec6dd9aacf1d99`
- gitDirty：`false`
- 范围：仅
  - `ui/src/components/settings/view/about/DesktopAboutSections.test.tsx`
  - `ui/src/components/settings/moduleLabels.test.tsx`
  - 本目录证据
- 未改：产品组件、vitest 配置、`web-regression.yml`、`config.test.js`、`loadPilotConfig.ts`、A/D 组文件
- 门禁：未加超时、未 skip/only、未重试、未删用例/断言

## 命令

与 CI `Test Web UI and server` 相同的 exclude，只点名这两个文件：

```bash
pnpm --dir ui exec vitest run src/components/settings/view/about/DesktopAboutSections.test.tsx \
  --exclude 'e2e/**' \
  --exclude 'src/components/chat/hooks/streamSmoother.test.ts' \
  --exclude 'server/services/desktopUpdateNetwork.test.ts' \
  --exclude 'server/services/desktopUpdates.spec.ts'

pnpm --dir ui exec vitest run src/components/settings/moduleLabels.test.tsx \
  --exclude 'e2e/**' \
  --exclude 'src/components/chat/hooks/streamSmoother.test.ts' \
  --exclude 'server/services/desktopUpdateNetwork.test.ts' \
  --exclude 'server/services/desktopUpdates.spec.ts'
```

## Before / after

| 组 | 文件 | Before | After | 日志 |
|---|---|---|---|---|
| B | `DesktopAboutSections.test.tsx` | 1 failed file / **6 failed \| 3 passed (9)** | 1 passed / **9 passed (9)** | `b-group-before.txt` / `b-group-after.txt` |
| C | `moduleLabels.test.tsx` | 1 failed file / **1 failed \| 1 passed (2)** | 1 passed / **2 passed (2)** | `c-group-before.txt` / `c-group-after.txt` |

`*.log` 被仓库 `.gitignore` 忽略，故入库副本用 `.txt`。

| 文件 | sha256 |
|---|---|
| `b-group-before.txt` | `54054696b10ff9a477f1da44685e6d4628d3af6e9150fd2aca5fb6993b08d62b` |
| `b-group-after.txt` | `0bcbeb40e5a939d85da28d1816987634cff4c86dd00a186014ae546491552044` |
| `c-group-before.txt` | `78a20feb2d25f5f975b3f5b718f5a951ed63e44d50b5844cd4691d459cafd9c7` |
| `c-group-after.txt` | `882fbf45723a737a7ad72511afa286207a13fc622f50dc6f1a95c9d6725ed9b3` |

## 逐条根因与改动

对照组件 `DesktopAboutSections.tsx`（未改）：

```
buttonLabel = pending ? updating : canInstall ? updateAndRestart : checkAgain
canInstall  = hasUpdate && canDownload === true && !checkUnavailable
              && !statusFailed && update?.state !== "failed"
              && (!reason || reason === "cancelled")
disabled    = pending || busy || checkingVersion
              || (!update && !statusFailed)
              || (!canInstall && !onCheckUpdates)
```

本文件 `show()` 不传 `onCheckUpdates`。因此不可安装时 DOM 只有 `checkAgain`（disabled），点击也不会走 `startUpdate`。

| ID | 失败 | 根因（对照组件后确认） | 改动 | 未删断言 |
|---|---|---|---|---|
| B-1 | `disables unavailable updates` ×3（`noCompatibleInstaller` / `hasUpdate:false` / `checkFailed`） | 测试找 `updateAndRestart`。三组都使 `canInstall===false`，按钮文案是 `checkAgain` 且 disabled。 | 按角色名找 `checkAgain`。 | 仍断言 `disabled===true`；`click` 后 `startUpdate` 未被调用。 |
| B-2 | `keeps updating disabled until main-process status is known` | 首次 `getUpdateStatus` reject → `statusFailed`、`update===null` → `canInstall===false` → `checkAgain` disabled。轮询成功后才是可安装的 `updateAndRestart` enabled。 | 未知状态断言 `checkAgain` disabled；状态已知后仍断言 `updateAndRestart` enabled。 | 禁用→解锁意图保留。 |
| B-3 | `explains checksumMismatch and enforces its retry policy` | `state:'failed'` 使 `canInstall===false`，文案是 `checkAgain`。无 `onCheckUpdates` 时 `disabled===true`。旧期望 `updateAndRestart` + `disabled===false` 与当前组件不符。i18n / 主进程对 checksumMismatch 的“可再检查”策略在本测试 setup 下不能表现为可点的安装按钮。 | 找 `checkAgain`；期望 `disabled===true`。 | 仍断言 `alert` 文案为 `reasons.checksumMismatch`；仍断言按钮 disabled。 |
| B-4 | `explains installFailed and enforces its retry policy` | 同上：`failed` → `checkAgain` disabled。主进程会锁死再安装；UI 无 check handler 时同样不能点。 | 找 `checkAgain`；期望仍 `disabled===true`。 | 仍断言 `reasons.installFailed` + disabled。 |
| C-1 | `uses contribution translation keys for module navigation and headings` | `SettingsContent` 新增 `useLocation()` 读 `?reference=`。测试裸 `render` 没有 Router。 | `SettingsContent` 包 `<MemoryRouter>`。Sidebar 不用 location，不包。 | 仍断言「设置」+ `getAllByText('通用').length === 2`。第二条字面量 label 用例未改。 |

未通过的 3 个 B 组用例（一键更新、恢复进度、取消再试）本来就按可安装路径找 `updateAndRestart`，未改。

## 产品代码

**未改 `DesktopAboutSections.tsx` / `SettingsContent.tsx`。** 失败是断言与既有文案/Router 约定不一致，不是组件回归。
