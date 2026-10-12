#!/usr/bin/env node
/**
 * Generate evidence/schema/module-protocol.schema.json from protocol.ts.
 * Deterministic. Refuses to run on a dirty git tree. No protocol changes.
 */
import { writeFileSync } from "node:fs";
import {
  PROTOCOL_REL,
  SCHEMA_PATH,
  SCHEMA_REL,
  assertCleanTree,
  buildModuleProtocolSchema,
  compileSchema,
  extractProtocolContract,
  readProtocolSource,
  stringifySchema,
} from "./lib/module-protocol-schema.mjs";

try {
  assertCleanTree("generate-module-protocol-schema");
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(2);
}

const source = readProtocolSource();
const contract = extractProtocolContract(source);
const schema = buildModuleProtocolSchema(contract);
compileSchema(schema);
const text = stringifySchema(schema);
writeFileSync(SCHEMA_PATH, text);

console.log(`generated ${SCHEMA_REL} from ${PROTOCOL_REL}`);
console.log(`protocolVersion=${contract.protocolVersion}`);
console.log(`capabilitiesVersion=${contract.capabilitiesVersionField}`);
console.log(`notContract=${contract.storageConfigVersionField}`);
