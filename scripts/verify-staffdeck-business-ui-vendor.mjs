#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const upstreamRoot = process.env.STAFFDECK_BUSINESS_UI_ROOT;
if (!upstreamRoot) {
  throw new Error('Set STAFFDECK_BUSINESS_UI_ROOT to the StaffDeck @staffdeck/business-ui package directory.');
}

const vendorRoot = resolve(root, 'ui/src/composition/modules/staffdeck/vendor');
const files = ['KnowledgeGraphCanvas.tsx', 'KnowledgeGraphCanvas.css', 'types.ts', 'SopVersionDetailDialog.tsx'];
const mismatches = [];
for (const file of files) {
  const [upstream, vendor] = await Promise.all([
    readFile(resolve(upstreamRoot, 'src', file), 'utf8'),
    readFile(resolve(vendorRoot, file), 'utf8'),
  ]);
  if (upstream !== vendor) mismatches.push(file);
}

if (mismatches.length > 0) {
  throw new Error(`PilotDeck StaffDeck UI vendor snapshot is stale: ${mismatches.join(', ')}`);
}
process.stdout.write('PilotDeck StaffDeck UI vendor snapshot matches @staffdeck/business-ui 0.1.0.\n');
