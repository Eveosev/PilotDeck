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
tools/agent-loop-parity/run.py
tools/agent-loop-parity/scenarios.json
```

Prerequisite: **Node >= 22**, `pnpm install`, clean git tree. The protocol is
**not frozen**. Schema is **hand-mapped + source anchors + replay** (limit
**F-5**). Field-mutation fuzz is **R2-1** (T-P0a-04). Path-triggered CI is
**not** enabled yet.

Do **not** add `--experimental-strip-types` to generate / 1a. Replay re-execs
itself with that flag; Node 20 exits **9**.

### Copy-paste checklist (checks 1a, 1c, 2, 3, 7)

Run from the repo root on a clean tree. Replay runs **once**; reports go to
`/tmp/protocol-sync-replay`, then tracked files are restored so 2 → 3 → 7
stay on a clean tree.

```bash
# Node >= 22 and a clean tree. pipefail keeps replay's exit through tee.
set -o pipefail
node -v
git status --porcelain
git rev-parse HEAD

# 1a — builder vs on-disk schema (no strip-types flag)
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

# 1c — second generate must be a no-op (commit schema first if 1b wrote a diff)
node scripts/generate-module-protocol-schema.mjs
git diff --exit-code -- evidence/schema/module-protocol.schema.json

# One replay for checks 2, 3, and 7 — then restore tracked reports
export PROTOCOL_REPLAY_OUT="${PROTOCOL_REPLAY_OUT:-/tmp/protocol-sync-replay}"
mkdir -p "$PROTOCOL_REPLAY_OUT"
node scripts/replay-module-protocol-schema.mjs | tee "$PROTOCOL_REPLAY_OUT/stdout.txt"
cp evidence/schema/replay-report.json "$PROTOCOL_REPLAY_OUT/replay-report.json"
cp evidence/schema/replay-report.md "$PROTOCOL_REPLAY_OUT/replay-report.md"
git checkout -- evidence/schema/replay-report.json evidence/schema/replay-report.md
test -z "$(git status --porcelain)"

# 2 — expressible mismatches = 0
python3 -c 'import json,os,sys
r=json.load(open(os.path.join(os.environ["PROTOCOL_REPLAY_OUT"],"replay-report.json")))
print("expressibleMismatches", r["A2"]["expressibleMismatches"])
print("inexpressibleRules", r["A2"]["inexpressibleRules"])
print("A1.reproducible", r["A1"]["reproducible"], "dirtyTreeRefused", r["A1"]["dirtyTreeRefused"])
ok = (r["A2"]["expressibleMismatches"]==0 and r["A2"]["inexpressibleRules"]==0
      and r["A1"]["reproducible"] and r["A1"]["dirtyTreeRefused"])
sys.exit(0 if ok else 1)'

# 3 — A3 both-reject + loosened control FAIL
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

# 7 — gitSha matches HEAD, gitDirty=false (read the temp copy)
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
