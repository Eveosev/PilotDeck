# deadline_during_tool PilotDeck

- left: `/tmp/tp204-parity/full53/deadline_during_tool.pilotdeck-current-native.jsonl`
- right: `/tmp/tp204-parity/full53/deadline_during_tool.pilotdeck-current-sidecar.jsonl`

FAIL: 1 semantic difference(s).

## Semantic Differences


- `trace.channel[core/parent][6]`
  - left: `null`
  - right: `{"agentScope": "parent", "event": "gateway_submit_failed", "kind": "durable.status", "statusKind": "error", "text": "AgentLoop terminal outcome is result_unknown and host reconciliation found no final result."}`

## Format Warnings

Format warnings do not change exit status. Categories cover envelope + budget + modelView.* + request/requestEvidence/response/state/kind/source/attempt (envelope, budget, modelView, request, requestEvidence, response, state, kind, source, attempt). This run: envelope=46, kind=3. modelView format diffs are order/envelope (canonicalize sorts keys); semantic modelView content remains a FAIL.
49 difference(s). taxonomy={"envelope": 46, "budget": 0, "modelView": 0, "request": 0, "requestEvidence": 0, "response": 0, "state": 0, "kind": 3, "source": 0, "attempt": 0}

- `trace.length` (envelope)
  - left: `13`
  - right: `14`

- `trace[0].invocationId` (envelope)
  - left: `"0837baff45434facbe409ce458c84353"`
  - right: `"af790bf3ba25492baca4a5103c8ed921"`

- `trace[0].sequence` (envelope)
  - left: `1`
  - right: `17`

- `trace[1].invocationId` (envelope)
  - left: `"0837baff45434facbe409ce458c84353"`
  - right: `"af790bf3ba25492baca4a5103c8ed921"`

- `trace[1].sequence` (envelope)
  - left: `2`
  - right: `18`

- `trace[2].invocationId` (envelope)
  - left: `"0837baff45434facbe409ce458c84353"`
  - right: `"af790bf3ba25492baca4a5103c8ed921"`

- `trace[2].sequence` (envelope)
  - left: `3`
  - right: `19`

- `trace[3].invocationId` (envelope)
  - left: `"0837baff45434facbe409ce458c84353"`
  - right: `"af790bf3ba25492baca4a5103c8ed921"`

- `trace[3].sequence` (envelope)
  - left: `4`
  - right: `21`

- `trace[4].invocationId` (envelope)
  - left: `"0837baff45434facbe409ce458c84353"`
  - right: `"af790bf3ba25492baca4a5103c8ed921"`

- `trace[4].sequence` (envelope)
  - left: `5`
  - right: `27`

- `trace[5].invocationId` (envelope)
  - left: `"0837baff45434facbe409ce458c84353"`
  - right: `"af790bf3ba25492baca4a5103c8ed921"`

- `trace[5].sequence` (envelope)
  - left: `6`
  - right: `28`

- `trace[6].invocationId` (envelope)
  - left: `"0837baff45434facbe409ce458c84353"`
  - right: `"af790bf3ba25492baca4a5103c8ed921"`

- `trace[6].sequence` (envelope)
  - left: `7`
  - right: `29`

- `trace[7].invocationId` (envelope)
  - left: `"0837baff45434facbe409ce458c84353"`
  - right: `"af790bf3ba25492baca4a5103c8ed921"`

- `trace[7].sequence` (envelope)
  - left: `8`
  - right: `30`

- `trace[8].invocationId` (envelope)
  - left: `"0837baff45434facbe409ce458c84353"`
  - right: `"af790bf3ba25492baca4a5103c8ed921"`

- `trace[8].sequence` (envelope)
  - left: `9`
  - right: `31`

- `trace[9].invocationId` (envelope)
  - left: `"0837baff45434facbe409ce458c84353"`
  - right: `"af790bf3ba25492baca4a5103c8ed921"`

- `trace[9].sequence` (envelope)
  - left: `10`
  - right: `33`

- `trace[10].agentScope` (envelope)
  - left: `null`
  - right: `"parent"`

- `trace[10].counts` (envelope)
  - left: `{}`
  - right: `null`

- `trace[10].event` (envelope)
  - left: `null`
  - right: `"gateway_submit_failed"`

- `trace[10].invocationId` (envelope)
  - left: `"0837baff45434facbe409ce458c84353"`
  - right: `"af790bf3ba25492baca4a5103c8ed921"`

- `trace[10].kind` (kind)
  - left: `"side_effect.state"`
  - right: `"durable.status"`

- `trace[10].sequence` (envelope)
  - left: `11`
  - right: `35`

- `trace[10].sideEffectCount` (envelope)
  - left: `0`
  - right: `null`

- `trace[10].statusKind` (envelope)
  - left: `null`
  - right: `"error"`

- `trace[10].text` (envelope)
  - left: `null`
  - right: `"AgentLoop terminal outcome is result_unknown and host reconciliation found no final result."`

- `trace[11].compactionBoundaryCount` (envelope)
  - left: `0`
  - right: `null`

- `trace[11].compactionCompletedCount` (envelope)
  - left: `0`
  - right: `null`

- `trace[11].counts` (envelope)
  - left: `null`
  - right: `{}`

- `trace[11].durableStatusCount` (envelope)
  - left: `0`
  - right: `null`

- `trace[11].durableSteerCount` (envelope)
  - left: `0`
  - right: `null`

- `trace[11].invocationId` (envelope)
  - left: `"0837baff45434facbe409ce458c84353"`
  - right: `"af790bf3ba25492baca4a5103c8ed921"`

- `trace[11].kind` (kind)
  - left: `"durable.state"`
  - right: `"side_effect.state"`

- `trace[11].sequence` (envelope)
  - left: `12`
  - right: `36`

- `trace[11].sideEffectCount` (envelope)
  - left: `null`
  - right: `0`

- `trace[12].compactionBoundaryCount` (envelope)
  - left: `null`
  - right: `0`

- `trace[12].compactionCompletedCount` (envelope)
  - left: `null`
  - right: `0`

- `trace[12].durableStatusCount` (envelope)
  - left: `null`
  - right: `0`

- `trace[12].durableSteerCount` (envelope)
  - left: `null`
  - right: `0`

- `trace[12].invocationId` (envelope)
  - left: `"0837baff45434facbe409ce458c84353"`
  - right: `"af790bf3ba25492baca4a5103c8ed921"`

- `trace[12].kind` (kind)
  - left: `"terminal"`
  - right: `"durable.state"`

- `trace[12].outcome` (envelope)
  - left: `"failed"`
  - right: `null`

- `trace[12].output` (envelope)
  - left: `""`
  - right: `null`

- `trace[12].sequence` (envelope)
  - left: `13`
  - right: `38`

- `trace[12].stopReason` (envelope)
  - left: `"unknown"`
  - right: `null`
