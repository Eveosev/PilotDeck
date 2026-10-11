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
    const snapshot = collector.snapshot();
    assert.equal(snapshot.turn_ms, null);
    assert.deepEqual(snapshot.model_iter_ms, []);
    assert.deepEqual(snapshot.stream_chunk_ms, []);
    assert.equal(snapshot.non_model_ms, null);
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
    assert.ok(snapshot.turn_ms > 8);
    assert.equal(snapshot.model_iter_ms.length, 1);
    assert.ok(snapshot.model_iter_ms[0] > 8);
    assert.equal(snapshot.stream_chunk_ms.length, 1);
    assert.ok(snapshot.stream_chunk_ms[0] > 3);
    assert.ok(snapshot.non_model_ms != null);
    assert.ok(snapshot.non_model_ms >= 0);
  });

  it("derives non_model and between-model gaps", async () => {
    const collector = createPerfCollector({ enabled: true });
    collector.markTurnStart();
    collector.markFirstGatewayEvent();
    collector.markModelStart();
    await new Promise((resolve) => setTimeout(resolve, 4));
    collector.markModelEnd();
    collector.markToolStart();
    await new Promise((resolve) => setTimeout(resolve, 4));
    collector.markToolEnd();
    collector.markModelStart();
    await new Promise((resolve) => setTimeout(resolve, 4));
    collector.markModelEnd();
    collector.markTurnEnd();
    const snapshot = collector.snapshot();
    assert.equal(snapshot.model_iter_ms.length, 2);
    assert.equal(snapshot.segments.between_model_ms.length, 1);
    assert.ok(snapshot.segments.between_model_ms[0] > 3);
    assert.ok(snapshot.segments.tool_ms > 3);
    assert.ok(snapshot.non_model_ms > snapshot.segments.tool_ms - 1);
    assert.ok(snapshot.segments.pre_model_ms != null);
    assert.ok(snapshot.segments.post_model_ms != null);
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
