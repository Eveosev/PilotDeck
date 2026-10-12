# Desktop SDK runtime packaging — progress

R2/R3 follow-ups. Required items land in this PR; F-* / R2-3 / R2-4 / R3-2–R3-4 stay tracked here (not fixed in the R3 docs commit).

## This round

| ID | Status | Notes |
|---|---|---|
| R2-1 | done | Export `rewriteUiServerSourceImports` and `verifyRuntime` from `build-runtime.mjs`. Tests import those real functions (no source-copied rewrite/verify). Added a test that the relative-import verifier throws when a transitively imported file is missing. Local verifier mutation recorded as FAIL; mutation not committed. |
| R2-2 | done | `isExecutedAsMain()` realpaths both `process.argv[1]` and the `import.meta.url` path before comparing. Test runs the script via a symlink (`--probe-main`). |
| F-7 | approved | Raw logs / screenshots / binaries archived to a Cursor artifact tarball, then deleted in the next commit. PRs #1–#5 `evidence/` untouched. |
| R3-1 | done | Renamed the three CI issue rows (were mislabeled F-2/F-5/F-6) to CI-1/CI-2/CI-3. Registered real F-2/F-5/F-6, R2-3, R2-4, R3-2, R3-3, R3-4 as follow-ups. |
| R3-5 | done | README(s) under `review/` no longer point at deleted files; packaging file count is 4. |

## CI issues (not this PR)

| ID | Owner / next | Plan |
|---|---|---|
| CI-1 | separate UI PR | Linux DEB chrome e2e (`ui/e2e/desktop-chrome.smoke.mjs:237`) expects `.workspace-header h1[data-desktop-no-drag=""]`. Same miss on base `1da663a2` and this PR: neither `h1` in `MainAreaV2.tsx` (L59, L267–274) has the attribute. Unit `MainAreaV2.test.tsx:131` fails identically on both SHAs. Do not mix a UI attribute fix into desktop packaging. |
| CI-2 | CI / maintainer | Windows arm64 PortableGit 504 (job `114797233974`) could not be rerun (`gh run rerun` and Actions API returned 403 / "job cannot be rerun"). Re-run on a later push with a token that can retry failed jobs, or wait for the next Desktop Windows arm64 workflow. Not a packaging-code defect. |
| CI-3 | separate UI PR | Pre-existing Web Regression on `rust_standalone_alpha1`: `ui/src/components/settings/view/about/DesktopAboutSections.test.tsx` cannot find the `updateAndRestart` button role. Outside desktop packaging scope. |

## Follow-up plan (not fixed now)

| ID | Owner / next | Plan |
|---|---|---|
| F-2 | later packaging PR | `rmSync` guard. `materializeRuntimeSdk` (dest), `prepareRuntimeTree` (`.runtime-install` / `runtimeRoot`), and `removeIfExists` call `rmSync(..., { recursive: true, force: true })` with no prefix check. Refuse deletes whose resolved path is outside the intended runtime/install root. |
| F-5 | later packaging PR | Mapping unit test. Export `createRuntimeDependencies` / `FILE_RUNTIME_DEPENDENCIES` (or `verifyRuntimePackageManifest`) and assert `@pilotdeck/sdk` maps to `file:../../../packages/sdk`, not `workspace:*`. |
| F-6 | later packaging PR | Unreachable symlink check and stale sdk under SKIP. After `rmSync`+`copyFiltered`, `lstatSync(dest).isSymbolicLink()` in `materializeRuntimeSdk` cannot fire. `PILOTDECK_DESKTOP_SKIP_RUNTIME_BUILD=1` skips rebuilding `packages/sdk` but still materializes whatever is on disk, so a stale sdk can be staged. |
| R2-3 | later packaging PR | `--probe-main` is a production CLI hook added for the R2-2 symlink test. Gate it behind a test-only env or an exported helper so `node build-runtime.mjs --probe-main` is not public surface. |
| R2-4 | later packaging PR | `verifyRuntimeUiServerRelativeImports` swallows `readFileSync` failures (`catch { continue; }`), so an unreadable queued file never becomes a missing-import error. Treat unreadable targets as missing. |
| R3-2 | later packaging PR | Restore `runtimeRoot` when `verifyRuntime` throws (wrap the L711 assignment in `finally`). Add tests that (1) `verifyRuntime` reaches the L704 `verifyRuntimeUiServerRelativeImports` call, and (2) `isRuntimeTestModule` skips `*.test.*` / `*.spec.*`. |
| R3-3 | later packaging PR | Remove `isExecutedAsMain` silent `catch { return false; }`. A `realpathSync` failure (broken symlink, EPERM) must not be treated as “not main”. |
| R3-4 | later packaging PR | Windows `symlinkSync` EPERM. The R2-2 test creates a symlink to `build-runtime.mjs`; that throws EPERM without Developer Mode. Skip or use a Windows-safe fallback. |
| F-7 | done | Approved. Archive table below; deletion was the following commit (`46ca9718`). |

## F-7 archive

Tarball (not in git; Cursor `list_artifacts` dir):

- path: `/opt/cursor/artifacts/review_2026-10-12-desktop-sdk-runtime-fix_raw.tar.gz`
- sha256: `97d545f18d3bcfad4f3bc0ad884a306dd015c605150e5a3fd8ef83143f571a36`
- size: 168275
- files: 37 (every raw log / screenshot / JSON dump under this review dir)

| path | sha256 | size | capture gitSha |
|---|---|---:|---|
| `review/2026-10-12-desktop-sdk-runtime-fix/build-runtime.after.excerpt.txt` | `69cf353c20f64dda991d301bd6b8894be767deef59e5034ddbad1d227e411adf` | 2558 | `d60aee42341073b12977d0bd8e858a80d7d7bf0c` |
| `review/2026-10-12-desktop-sdk-runtime-fix/d3-sdk-not-symlink.txt` | `2e811f40b276063b795ceeaef4031a3754efa158668eab125ed430e50a85e6d7` | 1814 | `d60aee42341073b12977d0bd8e858a80d7d7bf0c` |
| `review/2026-10-12-desktop-sdk-runtime-fix/desktop-tests.after.txt` | `232066033d7c45c7d7a990094f82b6a1ec07c9f4204f2f38334ca0e2c56cafe9` | 587 | `d60aee42341073b12977d0bd8e858a80d7d7bf0c` |
| `review/2026-10-12-desktop-sdk-runtime-fix/evidence.json` | `2e67bad56011ada761cb4ae864b5bb6f7d0912874b0b1b4bde87e476e62b5385` | 1841 | `d60aee42341073b12977d0bd8e858a80d7d7bf0c` |
| `review/2026-10-12-desktop-sdk-runtime-fix/provenance.json` | `d849f00283faee7010bb9382867a114a6feb5674b4d0a647da31b0d762931aac` | 99 | `d60aee42341073b12977d0bd8e858a80d7d7bf0c` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/build-runtime.after.txt` | `12f641e6e9e802c2799977b5394bacdd85678ff9136c0da4bd47d16af70e0eeb` | 523 | `524cb673362ca04ce02cab17b22f9d69b6a07b55` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/d1-manifest.txt` | `23ac6562c586795acac5ec65ae5b74718052c133250ae152d38cad5a0f4b6b11` | 2188 | `524cb673362ca04ce02cab17b22f9d69b6a07b55` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/d6-after.txt` | `7a588118ebced7a54c24b2f4c770337721fde4dc0e4993b0ad8d3b06dbaede2e` | 312 | `524cb673362ca04ce02cab17b22f9d69b6a07b55` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/d6-control-d60aee42.txt` | `7dcabdc99e5a14a94f2af846782ec6e791a38de6c3ab9089d3d6e5010db8438a` | 1253 | `524cb673362ca04ce02cab17b22f9d69b6a07b55` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/d6-mutation-revert-mjs.txt` | `703c227217ad083cc6c058c77f6d41c7a9dd880334d6e6ebbd2c6bf01055bfb8` | 1251 | `524cb673362ca04ce02cab17b22f9d69b6a07b55` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/evidence.json` | `aae88cc700fdc9be9fee76412efdab153edbbc27c9e96d05c0c111bac097016c` | 1803 | `524cb673362ca04ce02cab17b22f9d69b6a07b55` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/launch-result.txt` | `cac4f147f3abe43d37af24a9ca8f24d93e465cc633da006f1fc111d29642d6e5` | 49 | `524cb673362ca04ce02cab17b22f9d69b6a07b55` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/legacy-deb-e2e/blob-ids.txt` | `b265257dbe6e1588b0fa1c14a0f2d7ef63d8e63970d8a3e24951841697bb999c` | 420 | `b904d8faafdc88d2975b88127d86f1f053f3f92f` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/legacy-deb-e2e/e2e-1da663a2.txt` | `46070b625184d9e4a93cbb7dfc0726a8e2e03551547d2e120fea2d7df4a6b7d8` | 275 | `b904d8faafdc88d2975b88127d86f1f053f3f92f` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/legacy-deb-e2e/e2e-524cb673.txt` | `a7226e6cbde30099ab06d1e2ca329df530696e228e228adb30ca86882ed47fe8` | 3463 | `b904d8faafdc88d2975b88127d86f1f053f3f92f` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/legacy-deb-e2e/evidence.json` | `3a08a715a3eac5b78703fe48452b52e34b4696bd768c517202d58fb46cf92979` | 1363 | `b904d8faafdc88d2975b88127d86f1f053f3f92f` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/legacy-deb-e2e/exits.txt` | `c07da21bd66c01bad5ec5d0d5969c7dc23652c292989196e5800e05ea4e74727` | 82 | `b904d8faafdc88d2975b88127d86f1f053f3f92f` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/legacy-deb-e2e/h1-1da663a2.txt` | `4118a71a27a83a3204d97c3ad042cd877544f7672587f08704630b72ddf4bb99` | 793 | `b904d8faafdc88d2975b88127d86f1f053f3f92f` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/legacy-deb-e2e/h1-524cb673.txt` | `b8f9df56b45de59ea072eb616a0e4f9c4d744936600e34fe74bfaebe74d1dbbd` | 793 | `b904d8faafdc88d2975b88127d86f1f053f3f92f` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/legacy-deb-e2e/pr-files.txt` | `fea4ed2e5055704f5af6b9c360f2cba2a26538318fca5ca7ca4b8d18e08eba14` | 1629 | `b904d8faafdc88d2975b88127d86f1f053f3f92f` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/legacy-deb-e2e/provenance.txt` | `545d35f8e6f3bae65d2d3e1701e480e0f4c8b55ba4ce19037a43f5c8662845e3` | 247 | `b904d8faafdc88d2975b88127d86f1f053f3f92f` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/legacy-deb-e2e/ui-diff-names.txt` | `614f4bdcc81329bdb1f6fc46d6624174742a2309c200a843a897932af3467a7c` | 67 | `b904d8faafdc88d2975b88127d86f1f053f3f92f` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/legacy-deb-e2e/unit-1da663a2.txt` | `70044834499c5522fc13c29d2524680aa1ed4e6f6e6a2eff76147f1b9fac644c` | 1197 | `b904d8faafdc88d2975b88127d86f1f053f3f92f` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/legacy-deb-e2e/unit-524cb673.txt` | `943301c1229a902760c1ba9e6f6703ab8be913cb6936281d7d3d0da1f2031923` | 1186 | `b904d8faafdc88d2975b88127d86f1f053f3f92f` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/packaged-app-xvfb.png` | `ac7c74db1d17e719f1431d4ff405e4de58e48f6ffc946678ad4e8289803dde5b` | 161585 | `524cb673362ca04ce02cab17b22f9d69b6a07b55` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/packaged-app.launch.txt` | `f973c28cd53a217f203630c59707530df07d2a4f5c9421987c0e4e3d23b06b24` | 357 | `524cb673362ca04ce02cab17b22f9d69b6a07b55` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/packaged-app.runtime.txt` | `19dce65b020480c4d8f4662d452f50704ad660a772dffb42c64ccc38d16f6e4a` | 3124 | `524cb673362ca04ce02cab17b22f9d69b6a07b55` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/provenance.json` | `df6023f5fbd8a8d6216942c5846791ba2224b0f54ff6733253ed5ddaae96839d` | 143 | `524cb673362ca04ce02cab17b22f9d69b6a07b55` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/r2-followup/desktop-tests.summary.txt` | `ba74e808ce653c83623db4edb9c5a510e2fec44f78962fa5a7f2063e4e8b0856` | 230 | `b9c7897870dd0495d845aaab529b175896bbf2d4` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/r2-followup/evidence.json` | `4e0bc077bd1d57cc128334ca133e44e366401188e7fea91d0aa228d9c5ed94b6` | 1045 | `b9c7897870dd0495d845aaab529b175896bbf2d4` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/r2-followup/provenance.txt` | `69418e6e0670297b24a2e7f8dbb867680c5f3396df85fc495c74dab505d3e19d` | 371 | `b9c7897870dd0495d845aaab529b175896bbf2d4` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/r2-followup/r2-1-mutation-fail.txt` | `49865e4d21998eb66bb789d0d278cdabfe0e74127fe92b458a5955b67000defc` | 1126 | `b9c7897870dd0495d845aaab529b175896bbf2d4` |
| `review/2026-10-12-desktop-sdk-runtime-fix/round2/r2-followup/r2-imports-after.txt` | `871c737288b25bef9714e059906b089e1fd8ec84a70139d2da8dc27ab5602f45` | 720 | `b9c7897870dd0495d845aaab529b175896bbf2d4` |
| `review/2026-10-12-desktop-sdk-runtime-fix/runtime-frozen-lockfile.txt` | `0cffae8ad783a09e7a33d6bc2dc1b006c48661bc89e83fdebcefbcec8a8c3332` | 369 | `d60aee42341073b12977d0bd8e858a80d7d7bf0c` |
| `review/2026-10-12-desktop-sdk-runtime-fix/rust-hello-untouched.txt` | `037f19314b880d781b076bccf88527bb7a376c14942be17aed16be70b46f19b9` | 165 | `d60aee42341073b12977d0bd8e858a80d7d7bf0c` |
| `review/2026-10-12-desktop-sdk-runtime-fix/verify-manifest.after.txt` | `9295ec5693cdc065c44ee152397869ac41dd9e8d130e2d6339e9d6915ca4ea67` | 99 | `d60aee42341073b12977d0bd8e858a80d7d7bf0c` |
| `review/2026-10-12-desktop-sdk-runtime-fix/verify-manifest.base.txt` | `72c60d9f19e14270d7b3eec54e9268fbdaf2dfd57fa9110a2c2e5f1dfc384d5f` | 225 | `d60aee42341073b12977d0bd8e858a80d7d7bf0c` |
