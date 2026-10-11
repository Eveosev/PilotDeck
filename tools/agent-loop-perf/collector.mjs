/** Optional wall-clock collector used only when PARITY_PERF=1. */

export function createPerfCollector({ enabled = process.env.PARITY_PERF === "1" } = {}) {
  const origin = performance.now();
  const now = () => performance.now() - origin;
  const modelIters = [];
  const streamChunks = [];
  const tools = [];
  const marks = [];
  let turnStart = null;
  let turnEnd = null;
  let openModel = null;
  let openTool = null;
  let firstGatewayEvent = null;

  return {
    enabled,
    markTurnStart() {
      if (enabled) turnStart = now();
    },
    markTurnEnd() {
      if (enabled) turnEnd = now();
    },
    markModelStart() {
      if (enabled) openModel = now();
    },
    markModelEnd() {
      if (!enabled || openModel == null) return;
      modelIters.push({ start: openModel, end: now() });
      openModel = null;
    },
    markStreamChunk() {
      if (enabled) streamChunks.push(now());
    },
    markToolStart() {
      if (enabled) openTool = now();
    },
    markToolEnd() {
      if (!enabled || openTool == null) return;
      tools.push({ start: openTool, end: now() });
      openTool = null;
    },
    markFirstGatewayEvent() {
      if (enabled && firstGatewayEvent == null) firstGatewayEvent = now();
    },
    mark(name, extra = {}) {
      if (enabled) marks.push({ name, t: now(), ...extra });
    },
    snapshot() {
      const modelDurations = modelIters.map((item) => roundMs(item.end - item.start));
      const toolDurations = tools.map((item) => roundMs(item.end - item.start));
      const intervals = [];
      for (let index = 1; index < streamChunks.length; index += 1) {
        intervals.push(roundMs(streamChunks[index] - streamChunks[index - 1]));
      }
      const turnMs = turnStart != null && turnEnd != null ? roundMs(turnEnd - turnStart) : null;
      const modelSum = roundMs(modelDurations.reduce((total, value) => total + value, 0));
      const firstModel = modelIters[0];
      const lastModel = modelIters[modelIters.length - 1];
      const between = [];
      for (let index = 1; index < modelIters.length; index += 1) {
        between.push(roundMs(modelIters[index].start - modelIters[index - 1].end));
      }
      const handshake = marks.find((item) => item.name === "handshake_completed");
      const accepted = marks.find((item) => item.name === "stream_accepted");
      return {
        turn_ms: turnMs,
        model_iter_ms: modelDurations,
        stream_chunk_ms: intervals,
        non_model_ms: turnMs == null ? null : roundMs(turnMs - modelSum),
        segments: {
          first_gateway_event_ms:
            turnStart != null && firstGatewayEvent != null ? roundMs(firstGatewayEvent - turnStart) : null,
          pre_model_ms:
            turnStart != null && firstModel ? roundMs(firstModel.start - turnStart) : null,
          model_sum_ms: modelDurations.length ? modelSum : 0,
          between_model_ms: between,
          tool_ms: toolDurations.length ? roundMs(toolDurations.reduce((total, value) => total + value, 0)) : null,
          tool_iter_ms: toolDurations,
          post_model_ms:
            turnEnd != null && lastModel ? roundMs(turnEnd - lastModel.end) : null,
          handshake_ms:
            turnStart != null && handshake ? roundMs(handshake.t - turnStart) : null,
          stream_accepted_ms:
            turnStart != null && accepted ? roundMs(accepted.t - turnStart) : null,
        },
        marks: marks.map((item) => ({
          name: item.name,
          t: roundMs(item.t - (turnStart ?? 0)),
          ...(item.module ? { module: item.module } : {}),
          ...(item.operation ? { operation: item.operation } : {}),
        })),
      };
    },
  };
}

export async function writePerfSnapshot(collector, dest, { readFile, writeFile } = {}) {
  if (!collector?.enabled || !dest) return;
  const snapshot = collector.snapshot();
  snapshot.rss_kb = await readRssKb(readFile);
  const writer = writeFile ?? (await import("node:fs/promises")).writeFile;
  await writer(dest, `${JSON.stringify(snapshot)}\n`, "utf8");
}

function roundMs(value) {
  return Math.round(value * 1000) / 1000;
}

async function readRssKb(readFileImpl) {
  try {
    const reader = readFileImpl ?? (await import("node:fs/promises")).readFile;
    const text = await reader("/proc/self/status", "utf8");
    const match = /^VmRSS:\s+(\d+)\s+kB/m.exec(text);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}
