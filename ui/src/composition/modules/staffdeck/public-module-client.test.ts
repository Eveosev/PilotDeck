import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '../../../utils/api';
import { createPublicModuleClient } from './public-module-client';

vi.mock('../../../utils/api', () => ({ authenticatedFetch: vi.fn() }));
const fetch = vi.mocked(authenticatedFetch);
beforeEach(() => vi.clearAllMocks());

describe('public capability module transport', () => {
  it('passes a named operation and signal through the local gateway while preserving 202, data and ETag', async () => {
    const controller = new AbortController();
    const body = { id: 'job-owned', status: 'queued', draft: { id: 'draft-owned' } };
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 202, headers: { ETag: '"owner-etag"' } }));
    const client = createPublicModuleClient('/api/modules/staffdeck-public/call');
    const result = await client.call('generate_sop', { body: { title: 'Original' } }, { signal: controller.signal });
    expect(result).toMatchObject({ status: 202, body });
    expect((result.headers as Headers).get('etag')).toBe('"owner-etag"');
    expect(fetch).toHaveBeenCalledWith('/api/modules/staffdeck-public/call', {
      method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'generate_sop', input: { body: { title: 'Original' } } }),
    });
  });

  it('keeps the original HTTP failure and sends no request after cancellation', async () => {
    const raw = '{"error":{"code":"SCOPE_DENIED","message":"Denied"}}';
    fetch.mockResolvedValueOnce(new Response(raw, { status: 403 }));
    const client = createPublicModuleClient('/api/modules/staffdeck-public/call');
    await expect(client.call('list_tools')).rejects.toMatchObject({ name: 'ApiError', status: 403, code: 'SCOPE_DENIED', body: raw });
    const controller = new AbortController();
    controller.abort();
    await expect(client.call('list_tools', {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(() => createPublicModuleClient('/api/v1/agents/private')).toThrow('PilotDeck module');
  });
});
