# Desktop SDK runtime packaging fix

Evidence collected on the clean code commit, then added in this follow-up commit.

- gitSha / collectSha: `37fc654e49982ec6ab3b508b96dfb367afaa71b3`
- gitDirty: `false` (recorded before these files were written)
- baseSha: `1da663a21d40ef5e309c86423a235550c79f91ff` (`rust_standalone_alpha1`)
- recordedAt: `2026-10-12T11:49:11Z`

The code commit changes only three files: `apps/desktop/scripts/build-runtime.mjs`, `apps/desktop/runtime/package.json`, `apps/desktop/runtime/pnpm-lock.yaml`.

## Root cause

`9372cd15` added `"@pilotdeck/sdk": "workspace:*"` to the root manifest. The isolated desktop runtime (`8cfa007e`) never received it. `workspace:*` cannot resolve under `--ignore-workspace`, and the CLI entry statically imports `@pilotdeck/sdk`.

## Commands

| Check | Where | Exit |
|---|---|---|
| `verifyRuntimePackageManifest` using 1da663a2 `runtime/package.json` + base mapper | control | **1** |
| `verifyRuntimePackageManifest` after the fix | after | **0** |
| `pnpm --dir apps/desktop/runtime install --frozen-lockfile --ignore-workspace` (D5) | after | **0** |
| `pnpm --filter pilotdeck-desktop test` | after | **0** (148 pass / 0 fail / 1 skip) |
| `node apps/desktop/scripts/build-runtime.mjs` default path, non-rust | after | **0** |
| `git diff 1da663a2 -- .github/workflows/rust-hello.yml` (D5) | after | **0**, empty |

On base, the same manifest check prints:

```
@pilotdeck/sdk: expected workspace:*, found <absent>
ajv: expected ^8.20.0, found <absent>
ajv-formats: expected ^3.0.1, found <absent>
```

CI on the previous Desktop lineage (run `38198749065`, Linux DEB x64) failed at the same throw inside `verifyRuntimePackageManifest` after the UI build, so a full `build-runtime` on 1da663a2 cannot reach module-import verification.

## D3 — SDK is real built files

Raw command transcripts: `verify-manifest.base.txt`, `verify-manifest.after.txt`, `desktop-tests.after.txt`, `runtime-frozen-lockfile.txt`, `build-runtime.after.excerpt.txt`, `rust-hello-untouched.txt`, `d3-sdk-not-symlink.txt`.

See `d3-sdk-not-symlink.txt`. After the default runtime build:

- `apps/desktop/.runtime/app/node_modules/@pilotdeck/sdk` is a **directory**, not a symlink (`readlink: not a symlink`, `stat type=directory`).
- Built output is present: `dist/index.js` and the rest of `packages/sdk` `dist/*.js`.
- `verifyRuntime` also asserts this path exists and is not a symlink, then imports `dist/src/cli/pilotdeck.js`.

## D5 — rust-hello CI untouched

- Code commit does not include `.github/workflows/rust-hello.yml`.
- `git diff 1da663a2 -- .github/workflows/rust-hello.yml` is empty.
- Rust hello on this SHA already succeeded: https://github.com/Eveosev/PilotDeck/actions/runs/38244573407

## Remaining CI red lights (not this bug)

Web Regression on `rust_standalone_alpha1` already fails in `ui/src/components/settings/view/about/DesktopAboutSections.test.tsx` (`updateAndRestart` button role). That is a pre-existing UI test, outside desktop packaging scope.
