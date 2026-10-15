import assert from "node:assert/strict";
import test from "node:test";

import {
  STREAM_CHUNK_CHARS_VALUES,
  STREAM_CHUNK_FIELD_PATH,
  STREAM_PREFIX,
  chunkTextByChars,
  isLiveModelStreamScenario,
  liveStreamTextDeltas,
  resolveStreamChunkChars,
  yieldLiveModelStreamDeltas,
} from "./stream-chunks.mjs";

const mockBody = (scenarioId, q) => `MOCK_ANSWER[${scenarioId}]::${q}`;

test("A1 field path is scenarios[].streamChunkChars with values 1|50|500", () => {
  assert.equal(STREAM_CHUNK_FIELD_PATH, "scenarios[].streamChunkChars");
  assert.deepEqual([...STREAM_CHUNK_CHARS_VALUES], [1, 50, 500]);
  assert.equal(resolveStreamChunkChars({}), null);
  assert.equal(resolveStreamChunkChars({ scenarioId: "sidecar_live_model_stream" }), null);
  assert.equal(resolveStreamChunkChars({ streamChunkChars: 1 }), 1);
  assert.equal(resolveStreamChunkChars({ streamChunkChars: 50 }), 50);
  assert.equal(resolveStreamChunkChars({ streamChunkChars: 500 }), 500);
  assert.throws(() => resolveStreamChunkChars({ streamChunkChars: 2 }), /1, 50, or 500/);
  assert.throws(() => resolveStreamChunkChars({ streamChunkChars: "50" }), /1, 50, or 500/);
});

test("live-stream family matches sidecar_live_model_stream and variants", () => {
  assert.equal(isLiveModelStreamScenario({ scenarioId: "sidecar_live_model_stream" }), true);
  assert.equal(isLiveModelStreamScenario({ scenarioId: "sidecar_live_model_stream_chars_50" }), true);
  assert.equal(isLiveModelStreamScenario({ scenarioId: "pure_text" }), false);
  assert.equal(isLiveModelStreamScenario({ scenarioId: "single_tool" }), false);
});

test("A4 default path keeps STREAM_PREFIX plus one whole-body remainder", () => {
  const body = mockBody("sidecar_live_model_stream", "Stream the first delta before provider completion");
  const deltas = liveStreamTextDeltas(body, null);
  assert.equal(deltas.length, 2);
  assert.equal(deltas[0], STREAM_PREFIX);
  assert.equal(deltas[1], body);
  assert.deepEqual(chunkTextByChars(body, null), [body]);
  assert.deepEqual(chunkTextByChars("", null), [""]);
});

test("A4 streamChunkChars=1 is one Unicode char per chunk, not the whole body", () => {
  const body = "A字🎉BC";
  const chunks = chunkTextByChars(body, 1);
  assert.deepEqual(chunks, ["A", "字", "🎉", "B", "C"]);
  assert.equal(chunks.length, Array.from(body).length);
  assert.notEqual(chunks.length, 1);
  const deltas = liveStreamTextDeltas(body, 1);
  assert.equal(deltas.length, 1 + chunks.length);
  assert.equal(deltas[0], STREAM_PREFIX);
});

test("A4 streamChunkChars=50 and 500 yield multiple text_deltas", () => {
  const q50 = "Stream the first delta before provider completion";
  const body50 = mockBody("sidecar_live_model_stream_chars_50", q50);
  assert.ok(Array.from(body50).length > 50);
  const deltas50 = liveStreamTextDeltas(body50, 50);
  assert.ok(deltas50.length >= 3, `50-char path should split body, got ${deltas50.length}`);
  assert.equal(deltas50[0], STREAM_PREFIX);
  assert.equal(deltas50.slice(1).join(""), body50);
  assert.ok(deltas50.slice(1).every((chunk) => Array.from(chunk).length <= 50));

  const q500 = `Stream the first delta before provider completion. ${"x".repeat(1000)}`;
  const body500 = mockBody("sidecar_live_model_stream_chars_500", q500);
  assert.ok(Array.from(body500).length > 500);
  const deltas500 = liveStreamTextDeltas(body500, 500);
  assert.ok(deltas500.length >= 3, `500-char path should split a >500 body, got ${deltas500.length}`);
  assert.equal(deltas500[0], STREAM_PREFIX);
  assert.equal(deltas500.slice(1).join(""), body500);
  assert.ok(deltas500.slice(1).every((chunk) => Array.from(chunk).length <= 500));
});

test("A4 short bodies under 500 chars stay STREAM_PREFIX + one remainder (documented)", () => {
  const short = mockBody("sidecar_live_model_stream", "short");
  assert.ok(Array.from(short).length < 500);
  const deltas = liveStreamTextDeltas(short, 500);
  assert.equal(deltas.length, 2);
  assert.equal(deltas[1], short);
});

test("A2 first text_delta is yielded before provider completion", async () => {
  const order = [];
  const events = [];
  let providerCompleted = false;
  const awaitProvider = async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    providerCompleted = true;
    order.push("provider_completed");
    return "abcdef";
  };
  for await (const event of yieldLiveModelStreamDeltas({
    awaitProvider,
    streamChunkChars: 50,
    onFirstDelta: () => order.push("first_delta"),
    onProviderCompleted: () => order.push("on_provider_completed"),
  })) {
    events.push({ ...event, providerCompleted });
  }
  assert.deepEqual(order.slice(0, 2), ["first_delta", "provider_completed"]);
  assert.equal(events[0].text, STREAM_PREFIX);
  assert.equal(events[0].providerCompleted, false);
  assert.equal(events.at(-1).text, "abcdef");
  assert.equal(events.at(-1).providerCompleted, true);
  assert.ok(events.length >= 2);
});
