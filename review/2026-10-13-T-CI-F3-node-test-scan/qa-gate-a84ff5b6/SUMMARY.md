# QA gate #13 @ a84ff5b6 — PASS
- Scope: CI/test config/scripts only (8 files incl. review); no product code/assertions.
- Reverse check (local, real config edits): base rc=0; vite add rc=1; vite remove rc=1; root vitest add rc=1.
- Web Regression 38357331902: web+docker success; vitest 268 files/2204 tests; node --test 8 files/40 pass/0 fail/0 skipped; scan check "ok: 8 files".
- Desktop 38357331918: 9/9 jobs success.

## Off-repo artifacts (sha256)
```
14add690b78f2e0fbbd9ae3c1f1c8f0166375ab27402908da2e0f025490f7c75  run-38357331902.json
40670f143ce5e57cbfa99589dda031b72b66b4705bc43e7781eeda59a32ef7e6  run-38357331918.json
465ddaeffc30730ff86642ef21259e7214988a7f01db95f2619860f7ff415bcd  web.log
```
- Tip 848ddb7c (parent a84ff5b6): non-review diff 0 bytes; only PROGRESS.md changed.
