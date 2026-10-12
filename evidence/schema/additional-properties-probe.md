# T-P0a-01 additionalProperties probe

Input: `src/agent/modules/protocol.ts` `validateModuleMessage`.
Method: raw JSON text → `JSON.parse` → validator. No protocol change.

| Case | ok | code |
| --- | --- | --- |
| `execute-extra-top-level` | true |  |
| `execute-extra-payload` | true |  |
| `execute-attemptId` | false | UNSUPPORTED_FIELD |
| `execute-stepId` | false | UNSUPPORTED_FIELD |
| `execute-attemptId-and-extra` | false | UNSUPPORTED_FIELD |
| `event-extra-top-level` | true |  |
| `event-extra-payload` | true |  |
| `event-moduleInstanceId` | false | UNSUPPORTED_FIELD |
| `event-connectionGeneration` | false | UNSUPPORTED_FIELD |
| `response-extra-top-level` | true |  |
| `response-extra-payload` | true |  |
| `module-call-extra-top-level-and-payload` | true |  |
| `handshake-extra-top-level-and-payload` | true |  |
| `error-extra-top-level` | true |  |

## Conclusion

- extra top-level fields: **accepted** (`additionalProperties: true`)
- extra payload fields: **accepted** (`additionalProperties: true`)
- rejected by name only: `attemptId`, `connectionGeneration`, `moduleInstanceId`, `stepId`
- schema implication: `additionalProperties: true` plus two `not: required` groups
  (`attemptId`/`stepId`, `moduleInstanceId`/`connectionGeneration`)

gitSha: `b394d2c07346d01ad570aa779139967d291c7c7d`
gitDirty: `false`
