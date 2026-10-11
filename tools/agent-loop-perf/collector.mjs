/** Optional wall-clock collector used only when PARITY_PERF=1. */

export function createPerfCollector({ enabled = process.env.PARITY_PERF === "1" } = {}) {
  const origin = performance.now();
  const now = () => performance.now() - origin;
  const modelIters = [];
  const streamChunks = [];
  let turnStart = null;
  let turnEnd = null;
  let openModel = null;

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
      modelIters.push(roundMs(now() - openModel));
      openModel = null;
    },
    markStreamChunk() {
      if (enabled) streamChunks.push(now());
    },
    snapshot() {
      const intervals = [];
      for (let index = 1; index < streamChunks.length; index += 1) {
        intervals.push(roundMs(streamChunks[index] - streamChunks[index - 1]));
      }
      return {
        turn_ms: turnStart != null && turnEnd != null ? roundMs(turnEnd - turnStart) : null,
        model_iter_ms: [...modelIters],
        stream_chunk_ms: intervals,
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
