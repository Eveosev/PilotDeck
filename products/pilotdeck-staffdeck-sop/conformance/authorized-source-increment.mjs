import assert from 'node:assert/strict';

export const SOURCE_INCREMENT_SCHEMA = 'e2e01-approved-source-anchors/v1';
const instruction = 'If the user message contains a `<stable-source-anchors>` block, preserve every listed source identifier and its tool relationship under `## Files And Artifacts` or a clearly labeled source section. These are host-derived authority facts, not user claims.';
const protectedInstruction = 'If the user message contains a `<compact-summary-anchors>` block, it contains bounded high-priority facts from protected tool turns that are being summarized instead of preserved verbatim. Absorb any task prompts, read skill paths, result paths, result previews, current state, and next actions from those anchors into the Markdown handoff.';

function sourceRelationships(messages) {
  const blocks = messages.flatMap(message => message.content);
  const relationships = [];
  for (const call of blocks) {
    if (call.type !== 'tool_call' || !/skill|file|knowledge/i.test(call.name)) continue;
    const input = JSON.stringify(call.input);
    const bounded = input.length <= 2000 ? input : input.slice(0, 1976) + '\n...[truncated]';
    const values = [bounded];
    for (const result of blocks) {
      if (result.toolCallId !== call.id) continue;
      if (result.type === 'tool_result_reference') {
        values.push(result.path, result.readFilePath ?? '', result.preview);
      } else if (result.type === 'tool_result') {
        // The E2E-01 fixture uses textual owner responses, not media summaries.
        assert.ok(result.content.every(block => block.type === 'text'), 'source increment needs original textual tool results');
        values.push(result.content.map(block => block.text).join('\n'));
      }
    }
    const identifiers = [...new Set(values.join('\n').match(/\b(?:r\d{2}[-_][A-Za-z0-9_.-]+|kdoc[_-][A-Za-z0-9_.-]+|kchunk[_-][A-Za-z0-9_.-]+|(?:skill|file|knowledge|document)[-_][A-Za-z0-9_.:/-]+)\b/gi) ?? [])];
    if (identifiers.length) relationships.push({ toolName: call.name, identifiers });
  }
  return relationships.slice(0, 12);
}

/** Add the separately approved contribution to B0; compare every legacy field intact. */
export function assertAuthorizedSourceIncrement(candidate, baseline, sourceMessages) {
  const relationships = sourceRelationships(sourceMessages);
  const projected = structuredClone(baseline);
  if (relationships.length) {
    const anchorBlock = ['<stable-source-anchors>', ...relationships.map(row => JSON.stringify(row)), '</stable-source-anchors>'].join('\n');
    const control = projected.messages.at(-1);
    assert.equal(control.metadata?.purpose, 'context-summary-control');
    assert.equal(control.content.length, 1);
    assert.equal(control.content[0].type, 'text');
    const text = control.content[0].text;
    assert.ok(!text.includes('<stable-source-anchors>'), 'B0 already has an anchor block; schema needs review');
    assert.ok(text.endsWith('\n\n</internal-compaction-control>'));
    control.content[0].text = text.slice(0, -'\n\n</internal-compaction-control>'.length)
      + '\n\n' + anchorBlock + '\n\n</internal-compaction-control>';
  }
  assert.ok(!projected.systemPrompt.includes(instruction));
  assert.equal(projected.systemPrompt.split(protectedInstruction).length, 2);
  projected.systemPrompt = projected.systemPrompt.replace(protectedInstruction, protectedInstruction + '\n\n' + instruction);
  assert.deepEqual(candidate, projected, 'approved source increment or complete legacy request fields differ');
  return { schema: SOURCE_INCREMENT_SCHEMA, relationships, legacyFieldsCompared: 'complete canonical request', strictB0Equality: false };
}
