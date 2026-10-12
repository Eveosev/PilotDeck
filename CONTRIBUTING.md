# Contributing

Workflow: **Fork → feature branch → PR**.

## Module Protocol changes

Any PR that touches one of these paths must follow
[`evidence/protocol-sync-gate.md`](evidence/protocol-sync-gate.md) (T-P0a-07):

```
src/agent/modules/protocol.ts
scripts/lib/module-protocol-schema.mjs
scripts/generate-module-protocol-schema.mjs
scripts/replay-module-protocol-schema.mjs
evidence/schema/fixtures/negative-samples.json
evidence/schema/fixtures/edge-samples.json
evidence/schema/module-protocol.schema.json
evidence/schema/replay-report.json
evidence/schema/replay-report.md
evidence/protocol-sync-gate.md
tools/agent-loop-parity/run.py
tools/agent-loop-parity/scenarios.json
package.json
pnpm-lock.yaml
```

This list must stay **byte-for-byte identical** to the trigger-path list in
[`evidence/protocol-sync-gate.md`](evidence/protocol-sync-gate.md). Change both
files together. CONTRIBUTING is the QA source of truth: verbatim reruns execute
**this** command block.

Comment-only / formatting edits to `protocol.ts` may mark checks 4–6 N/A
in the PR body, but still run 1a + 2. `package.json` / `pnpm-lock.yaml` are
listed because an ajv bump is written into the generated schema and would
make 1a stale. Prerequisite: **Node 22** (engines `>=22.13.0 <23`),
`pnpm install`, clean git tree. The protocol is
**not frozen**. Schema is **hand-mapped + source anchors + replay** (limit
**F-5**). Field-mutation fuzz is **R2-1** (T-P0a-04). Path-triggered CI is
**not** enabled yet.

Do **not** add `--experimental-strip-types` to generate / 1a. Replay re-execs
itself with that flag; **Node < 22.6** (including Node 20) exits **9**.

### Copy-paste checklist (checks 1a, 1c, 2, 3, 7)

Save this block as a file and run it with **`bash -e <file>`** from the repo
root on a clean tree. Do **not** paste the block line-by-line into interactive
zsh: macOS zsh does not enable `interactivecomments` by default, so `# …`
comment lines become `command not found: #`. If you must paste into zsh, run
`setopt interactivecomments` first — or just use `bash -e`. Replay runs
**once**; capture `replay_exit`, copy reports to `/tmp/protocol-sync-replay`,
**restore tracked files first**, then `exit "$replay_exit"` if replay failed
so 2 → 3 → 7 stay on a clean tree.

The fenced block below has no `#` comment lines (zsh-safe if accidentally
pasted). It is the QA verbatim sequence.

```bash
: "save as file; run with bash -e; do not paste into zsh"
set -o pipefail
node -v
git status --porcelain
git rev-parse HEAD

node --input-type=module -e '
import { readFileSync } from "node:fs";
import {
  SCHEMA_PATH,
  buildModuleProtocolSchema,
  extractProtocolContract,
  readProtocolSource,
  stringifySchema,
} from "./scripts/lib/module-protocol-schema.mjs";
const built = stringifySchema(buildModuleProtocolSchema(extractProtocolContract(readProtocolSource())));
const onDisk = readFileSync(SCHEMA_PATH, "utf8");
if (built !== onDisk) {
  console.log("FAIL schema-stale");
  process.exit(1);
}
console.log("PASS schema-current");
'

node scripts/generate-module-protocol-schema.mjs
git diff --exit-code -- evidence/schema/module-protocol.schema.json

export PROTOCOL_REPLAY_OUT="${PROTOCOL_REPLAY_OUT:-/tmp/protocol-sync-replay}"
mkdir -p "$PROTOCOL_REPLAY_OUT"
replay_exit=0
node scripts/replay-module-protocol-schema.mjs | tee "$PROTOCOL_REPLAY_OUT/stdout.txt" || replay_exit=$?
cp evidence/schema/replay-report.json "$PROTOCOL_REPLAY_OUT/replay-report.json"
cp evidence/schema/replay-report.md "$PROTOCOL_REPLAY_OUT/replay-report.md"
git checkout -- evidence/schema/replay-report.json evidence/schema/replay-report.md
test -z "$(git status --porcelain)"
if [ "$replay_exit" -ne 0 ]; then exit "$replay_exit"; fi

python3 -c 'import json,os,sys
r=json.load(open(os.path.join(os.environ["PROTOCOL_REPLAY_OUT"],"replay-report.json")))
print("expressibleMismatches", r["A2"]["expressibleMismatches"])
print("inexpressibleRules", r["A2"]["inexpressibleRules"])
print("A1.reproducible", r["A1"]["reproducible"], "dirtyTreeRefused", r["A1"]["dirtyTreeRefused"])
ok = (r["A2"]["expressibleMismatches"]==0
      and r["A1"]["reproducible"] and r["A1"]["dirtyTreeRefused"])
sys.exit(0 if ok else 1)'

python3 -c 'import json,os,sys
r=json.load(open(os.path.join(os.environ["PROTOCOL_REPLAY_OUT"],"replay-report.json")))
a3=r["A3"]
print("allRejectedByBoth", a3["allRejectedByBoth"])
print("loosened", a3["loosenedSchemaControl"]["result"])
print("missingMessageTypes", a3["missingMessageTypes"])
print("missingConditionals", a3["missingConditionals"])
print("edgesMatchExpect", a3["edgesMatchExpect"])
ok = (a3["allRejectedByBoth"] is True
      and a3["loosenedSchemaControl"]["result"]=="FAIL"
      and a3["missingMessageTypes"]==[]
      and a3["missingConditionals"]==[]
      and a3["edgesMatchExpect"] is True)
sys.exit(0 if ok else 1)'

git status --porcelain
git rev-parse HEAD
python3 -c 'import json,os,subprocess,sys
head=subprocess.check_output(["git","rev-parse","HEAD"], text=True).strip()
r=json.load(open(os.path.join(os.environ["PROTOCOL_REPLAY_OUT"],"replay-report.json")))
print("gitSha", r["gitSha"])
print("gitDirty", r["gitDirty"])
print("HEAD", head)
sys.exit(0 if r["gitSha"]==head and r["gitDirty"] is False else 1)'
```

Checks 4–6 (live parity, Rust adapter, version eval) are in
[`evidence/protocol-sync-gate.md`](evidence/protocol-sync-gate.md).
