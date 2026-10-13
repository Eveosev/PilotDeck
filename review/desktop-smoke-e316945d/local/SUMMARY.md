# Local chrome smoke on `e316945d`

Host: Ubuntu 24.04.5 LTS x86_64, Node v22.23.3, pnpm 10.32.1, Electron 42.11.1, Weston 13.0.0, Xvfb.

Commands (repo scripts, same as Linux DEB chrome e2e):

```bash
pnpm install --frozen-lockfile
pnpm --filter pilotdeck-desktop run compile
bash apps/desktop/scripts/run-linux-chrome-smoke.sh x11
bash apps/desktop/scripts/run-linux-chrome-smoke.sh wayland
```

| Mode | script | exit | duration | transcript |
|---|---|---|---|---|
| X11 (Xvfb 1440x900 + dbus-run-session) | `run-linux-chrome-smoke.sh x11` | **0** | 2026-10-13T05:59:41Z → 06:00:04Z | `x11-chrome.txt` |
| Wayland (headless Weston + dbus-run-session) | `run-linux-chrome-smoke.sh wayland` | **0** | 2026-10-13T06:00:12Z → 06:00:33Z | `wayland-chrome.txt` |

Both printed:

```
PASS: compact caption and rich About dialog, version copy and project link
{"passed":true,"geometry":{"x":6,"border":"1px","radius":"14px"},...}
```

Unmapped fixture endpoints (expected; chrome smoke does not start the real runtime):

- `/api/taskmaster/installation-status`
- `/api/agents/runtime-config`
- `/api/commands/list`
- `/api/v1/providers`

`/api/modules/runtime` is mocked from `generatedFrontendProfile` (CI-4 / PR #10 path). Search / `:251` is not a chrome-smoke assertion; this run did not contact a live gateway.

Screenshots stay under `outputs/desktop-chrome-review/` (gitignored). SHA-256 inventory: `screenshot-sha256.txt`.

Not run here: `run-linux-display-smoke.sh` (needs installed `/usr/bin/pilotdeck-desktop` from a 22.04 DEB). This host is Ubuntu 24.04 and is not the release build baseline. Packaged-app X11/Wayland on 22.04 x64+arm64 is the lineage CI evidence in `../ci-lineage.md`.
