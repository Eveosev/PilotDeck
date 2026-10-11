import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPerfCollector, writePerfSnapshot } from "./collector.mjs";

describe("createPerfCollector", () => {
  it("stays inert when disabled", () => {
    const collector = createPerfCollector({ enabled: false });
    collector.markTurnStart();
    collector.markTurnEnd();
    collector.markModelStart();
    collector.markModelEnd();
    collector.markStreamChunk();
    assert.deepEqual(collector.snapshot(), {
      turn_ms: null,
      model_iter_ms: [],
      stream_chunk_ms: [],
    });
  });

  it("records turn, model iters, and stream intervals", async () => {
    const collector = createPerfCollector({ enabled: true });
    collector.markTurnStart();
    collector.markModelStart();
    await new Promise((resolve) => setTimeout(resolve, 5));
    collector.markStreamChunk();
    await new Promise((resolve) => setTimeout(resolve, 5));
    collector.markStreamChunk();
    collector.markModelEnd();
    collector.markTurnEnd();
    const snapshot = collector.snapshot();
    assert.ok(snapshot.turn_ms > 0);
    assert.equal(snapshot.model_iter_ms.length, 1);
    assert.ok(snapshot.model_iter_ms[0] > 0);
    assert.equal(snapshot.stream_chunk_ms.length, 1);
    assert.ok(snapshot.stream_chunk_ms[0] >= 0);
  });

  it("writes rss when a dest is provided", async () => {
    const writes = [];
    const collector = createPerfCollector({ enabled: true });
    collector.markTurnStart();
    collector.markTurnEnd();
    await writePerfSnapshot(collector, "/tmp/perf.json", {
      readFile: async () => "VmRSS:\t1234 kB\n",
      writeFile: async (dest, body) => {
        writes.push({ dest, body });
      },
    });
    assert.equal(writes.length, 1);
    const payload = JSON.parse(writes[0].body);
    assert.equal(payload.rss_kb, 1234);
    assert.equal(typeof payload.turn_ms, "number");
  });
});
