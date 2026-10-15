/** T-P1-04 live-stream chunking: Unicode code points, not tokens. */

export const STREAM_PREFIX = "STREAM_PREFIX::";
export const STREAM_CHUNK_CHARS_VALUES = Object.freeze([1, 50, 500]);
export const STREAM_CHUNK_FIELD_PATH = "scenarios[].streamChunkChars";

export function isLiveModelStreamScenario(scenario) {
  const id = String(scenario?.scenarioId ?? "");
  return id === "sidecar_live_model_stream" || id.startsWith("sidecar_live_model_stream_");
}

export function resolveStreamChunkChars(scenario) {
  if (scenario == null || !Object.prototype.hasOwnProperty.call(scenario, "streamChunkChars")) {
    return null;
  }
  const value = scenario.streamChunkChars;
  if (!STREAM_CHUNK_CHARS_VALUES.includes(value)) {
    throw new Error(
      `${STREAM_CHUNK_FIELD_PATH} must be 1, 50, or 500 Unicode chars; got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Slice `text` into Unicode code-point chunks.
 *
 * - `chunkChars == null` (default live-stream path): one remainder chunk, including
 *   empty string, so the adapter still yields STREAM_PREFIX + one body delta.
 * - `chunkChars` is 1 | 50 | 500: `1` means one code point per chunk, not the
 *   whole body. Empty text yields no body chunks.
 */
export function chunkTextByChars(text, chunkChars) {
  const content = text ?? "";
  if (chunkChars == null) {
    return [content];
  }
  const chars = Array.from(content);
  if (chars.length === 0) return [];
  const chunks = [];
  for (let index = 0; index < chars.length; index += chunkChars) {
    chunks.push(chars.slice(index, index + chunkChars).join(""));
  }
  return chunks;
}

export function liveStreamTextDeltas(content, streamChunkChars, prefix = STREAM_PREFIX) {
  return [prefix, ...chunkTextByChars(content, streamChunkChars)];
}

/**
 * Yield STREAM_PREFIX before `awaitProvider` resolves, then char-sliced body
 * deltas. The gateway live-stream path (`pilotdeck_gateway_impl.mjs`) calls
 * this via `yieldAdapterLiveModelStream`; A2 / test #8 cover the same helper
 * (no inlined mirror). Breaking this generator must fail those tests.
 */
export async function* yieldLiveModelStreamDeltas({
  prefix = STREAM_PREFIX,
  awaitProvider,
  content,
  streamChunkChars,
  onFirstDelta,
  onProviderCompleted,
} = {}) {
  onFirstDelta?.();
  yield { type: "text_delta", text: prefix };
  const payload = awaitProvider ? await awaitProvider() : undefined;
  onProviderCompleted?.();
  const body = content ?? payload ?? "";
  for (const text of chunkTextByChars(body, streamChunkChars)) {
    yield { type: "text_delta", text };
  }
}

/**
 * Adapter live-stream sequence: request_started → message_start → prefix
 * (before provider) → body deltas → message_end. Yields incrementally so the
 * first `text_delta` is visible before `awaitProvider` resolves.
 *
 * Returns `{ body, deltas }` after the generator finishes (caller uses
 * `deltas.length` for harness `n_chunks`). Test #8 drives this helper; a
 * broken `yieldLiveModelStreamDeltas` / `liveStreamTextDeltas` goes red.
 */
export async function* yieldAdapterLiveModelStream({
  awaitProvider,
  streamChunkChars,
  onFirstDelta,
  onProviderCompleted,
  onChunks,
  provider,
  model,
} = {}) {
  yield { type: "request_started", provider, model };
  yield { type: "message_start", role: "assistant" };
  let body = "";
  for await (const event of yieldLiveModelStreamDeltas({
    awaitProvider: async () => {
      body = (await awaitProvider()) ?? "";
      return body;
    },
    streamChunkChars,
    onFirstDelta,
    onProviderCompleted,
  })) {
    yield event;
  }
  const deltas = liveStreamTextDeltas(body, streamChunkChars);
  onChunks?.(deltas);
  yield { type: "message_end", finishReason: "stop" };
  return { body, deltas };
}
