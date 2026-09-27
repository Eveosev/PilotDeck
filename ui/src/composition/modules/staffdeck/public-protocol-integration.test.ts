import { describe, expect, it, vi } from 'vitest';
import { createPublicCapabilityClient, decodePublicJobEvents } from '../../../../shared/staffdeck-public-capabilities.mjs';
import { createPublicCapabilityAdapter } from './public-capability-adapter';
import { ApiError } from './vendor/DistillPageHost';

describe('committed public protocol consumed by the gateway-facing adapter', () => {
  it('keeps default authorization and dirty rewrite refusals at zero transport requests', async () => {
    const transport = vi.fn();
    const blocked = createPublicCapabilityAdapter({
      client: createPublicCapabilityClient({ agentId: 'agent', transport }),
      decodeEvents: decodePublicJobEvents,
    });
    const denied = await blocked.collection('list_tools').catch(error => error);
    expect(denied).toBeInstanceOf(ApiError);
    expect(denied).toMatchObject({ status: 403, code: 'PUBLIC_OPERATION_NOT_AUTHORIZED' });
    const preview = createPublicCapabilityAdapter({
      client: createPublicCapabilityClient({ agentId: 'agent', transport, authorizedOperations: ['rewrite_saved_sop'] }),
      decodeEvents: decodePublicJobEvents,
    });
    await expect(preview.acceptedJob('rewrite_saved_sop', {
      sopId: 'sop', dirty: true, body: { instruction: 'Rewrite' },
    })).rejects.toMatchObject({ status: 409, code: 'PUBLIC_PREVIEW_REQUIRED' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('retains real 202 and result envelopes without a second write', async () => {
    const job = { id: 'job', status: 'queued', extension: 'owner' };
    const result = { job: { id: 'job', status: 'completed' }, result: { draft: { id: 'draft-row', sop_id: 'sop', etag: '"source"', content: { nodes: [] } } }, error: {} };
    const transport = vi.fn()
      .mockResolvedValueOnce({ status: 202, body: job, headers: { etag: '"accepted"' } })
      .mockResolvedValueOnce({ status: 200, body: result, headers: { etag: '"result"' } });
    const adapter = createPublicCapabilityAdapter({
      client: createPublicCapabilityClient({ agentId: 'agent', transport, authorizedOperations: ['generate_sop', 'get_job_result'] }),
      decodeEvents: decodePublicJobEvents,
    });
    expect(await adapter.acceptedJob('generate_sop', { body: { title: 'Title', raw_content: 'Source' } }))
      .toEqual({ status: 202, body: job, headers: { etag: '"accepted"' } });
    const response = await adapter.response('get_job_result', { jobId: 'job' });
    expect(response.body).toBe(result);
    expect(response.headers).toEqual({ etag: '"result"' });
    expect(transport.mock.calls.map(([request]) => [request.method, request.path])).toEqual([
      ['POST', 'agents/agent/sops:generate'], ['GET', 'jobs/job/result'],
    ]);
  });

  it('consumes real UTF-8 SSE frames before acknowledging IDs and preserves an empty reset', async () => {
    const bytes = new TextEncoder().encode('id: 4\r\nevent: progress\r\ndata: 中文\r\n\r\nid:\nevent: completed\ndata: actual\n\n');
    const transport = vi.fn().mockImplementation(async () => ({
      status: 200,
      body: (async function* () { for (const byte of bytes) yield new Uint8Array([byte]); })(),
    }));
    const adapter = createPublicCapabilityAdapter({
      client: createPublicCapabilityClient({ agentId: 'agent', transport, authorizedOperations: ['job_events'] }),
      decodeEvents: decodePublicJobEvents,
    });
    const seen: string[] = [];
    expect(await adapter.events({ jobId: 'job', lastEventId: '3',
      onEvent: event => { seen.push(`event:${event.id}:${event.event}:${event.data}`); },
      onConsumedId: id => { seen.push(`cursor:${id}`); },
    })).toEqual({ lastEventId: '' });
    expect(seen).toEqual(['event:4:progress:中文', 'cursor:4', 'event::completed:actual', 'cursor:']);
    expect(transport.mock.calls[0][0].headers['Last-Event-ID']).toBe('3');
    await adapter.events({ jobId: 'job', lastEventId: '', onEvent: () => {} });
    expect(transport.mock.calls[1][0].headers).not.toHaveProperty('Last-Event-ID');
  });
});
