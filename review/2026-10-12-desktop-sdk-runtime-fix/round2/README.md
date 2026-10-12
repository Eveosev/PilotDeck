# Round 2 — ui/server `.mjs` rewrite and import resolution

Collected on the clean code commit, then added here.

- gitSha / collectSha: `e9cd55478a7502d037f8843a413c28f1839e951b`
- gitDirty: `false` (recorded before these files were written)
- recordedAt: `2026-10-12T12:53:33.503Z`

Code commits in this round:

- `efa1d2b156363bec558bfc4f6b983dee6cb7bce8` — rewrite `.mjs` and add transitive import check
- `e9cd55478a7502d037f8843a413c28f1839e951b` — start from production `ui/server` entries only (skip `*.test.*` / `*.spec.*`)

## D6

`node --test apps/desktop/scripts/ui-server-runtime-imports.test.mjs`

| Tree | Exit | Output names `publicHostWire.js` |
|---|---|---|
| d60aee42 `build-runtime.mjs` + new test | **1** | yes (`d6-control-d60aee42.txt`) |
| mutation: only `extensions` back to `.js` | **1** | yes (`d6-mutation-revert-mjs.txt`) |
| e9cd5547 | **0** | n/a (`d6-after.txt`) |

## D1 manifest (full, includes sdk)

See `d1-manifest.txt`. The sdk line is:

```
OK @pilotdeck/sdk: expected file:../../../packages/sdk, found file:../../../packages/sdk
```

`verifyRuntimePackageManifest: PASS`

## Packaged DEB launch

- Built `PilotDeck-0.1.0-linux-amd64.deb` with electron-builder (host is Ubuntu 24.04, so the 22.04 glibc gate was skipped; this is a local smoke, not a release artifact).
- Installed to `/opt/PilotDeck`.
- Launched under xvfb. UI server started: `PilotDeck Web UI ready: http://127.0.0.1:3001`.
- No `ERR_MODULE_NOT_FOUND`. Installed `.mjs` imports `../../dist/src/composition/publicHostWire.js`. `src/` is absent from the runtime tree.
- Screenshot: `packaged-app-xvfb.png`. Logs: `packaged-app.runtime.txt`.

## Windows arm64 504

`gh run rerun --job 114797233974` and the Actions API both returned 403 / "job cannot be rerun" / "Resource not accessible by integration".
