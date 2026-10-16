# deadline PilotDeck

- left: `/tmp/tp204-parity/full53/deadline.pilotdeck-current-native.jsonl`
- right: `/tmp/tp204-parity/full53/deadline.pilotdeck-current-sidecar.jsonl`

FAIL: 2 semantic difference(s).

## Semantic Differences


- `trace.channel[core/parent][3]~[3].durableStopReason`
  - left: `"aborted_streaming"`
  - right: `null`

- `trace.channel[core/parent][3]~[3].resultType`
  - left: `"aborted"`
  - right: `null`

## Format Warnings

Format warnings do not change exit status. Categories cover envelope + budget + modelView.* + request/requestEvidence/response/state/kind/source/attempt (envelope, budget, modelView, request, requestEvidence, response, state, kind, source, attempt). This run: envelope=16. modelView format diffs are order/envelope (canonicalize sorts keys); semantic modelView content remains a FAIL.
16 difference(s). taxonomy={"envelope": 16, "budget": 0, "modelView": 0, "request": 0, "requestEvidence": 0, "response": 0, "state": 0, "kind": 0, "source": 0, "attempt": 0}

- `trace[0].invocationId` (envelope)
  - left: `"b24f00a1c9554006ba022871df5e7b46"`
  - right: `"2a7606003bc54fa49756694cf3c3f357"`

- `trace[0].sequence` (envelope)
  - left: `1`
  - right: `16`

- `trace[1].invocationId` (envelope)
  - left: `"b24f00a1c9554006ba022871df5e7b46"`
  - right: `"2a7606003bc54fa49756694cf3c3f357"`

- `trace[1].sequence` (envelope)
  - left: `2`
  - right: `18`

- `trace[2].invocationId` (envelope)
  - left: `"b24f00a1c9554006ba022871df5e7b46"`
  - right: `"2a7606003bc54fa49756694cf3c3f357"`

- `trace[2].sequence` (envelope)
  - left: `3`
  - right: `19`

- `trace[3].invocationId` (envelope)
  - left: `"b24f00a1c9554006ba022871df5e7b46"`
  - right: `"2a7606003bc54fa49756694cf3c3f357"`

- `trace[3].sequence` (envelope)
  - left: `4`
  - right: `22`

- `trace[4].invocationId` (envelope)
  - left: `"b24f00a1c9554006ba022871df5e7b46"`
  - right: `"2a7606003bc54fa49756694cf3c3f357"`

- `trace[4].sequence` (envelope)
  - left: `5`
  - right: `24`

- `trace[5].invocationId` (envelope)
  - left: `"b24f00a1c9554006ba022871df5e7b46"`
  - right: `"2a7606003bc54fa49756694cf3c3f357"`

- `trace[5].sequence` (envelope)
  - left: `6`
  - right: `26`

- `trace[6].durableStopReason` (envelope)
  - left: `"aborted_streaming"`
  - right: `null`

- `trace[6].invocationId` (envelope)
  - left: `"b24f00a1c9554006ba022871df5e7b46"`
  - right: `"2a7606003bc54fa49756694cf3c3f357"`

- `trace[6].resultType` (envelope)
  - left: `"aborted"`
  - right: `null`

- `trace[6].sequence` (envelope)
  - left: `7`
  - right: `27`
