import { authenticatedFetch } from '../../../utils/api';
import { moduleApiError } from './clients';
import type { PublicCapabilityClient, PublicCapabilityResponse } from './public-capability-adapter';

export type PublicSelectedScope = { kind: 'agent'; agentId: string } | { kind: 'team' };

/** Browser transport for a named operation on the existing PilotDeck module gateway. */
export function createPublicModuleClient(endpoint: string): PublicCapabilityClient & { call(operation: string, input?: Record<string, unknown>, options?: { signal?: AbortSignal; scope?: PublicSelectedScope }): Promise<PublicCapabilityResponse> } {
  if (!/^\/api\/modules\/[a-z0-9/-]+\/call$/.test(endpoint)) {
    throw new Error('The public capability endpoint must be a named PilotDeck module call route.');
  }
  return Object.freeze({
    async call(operation: string, input: Record<string, unknown> = {}, options: { signal?: AbortSignal; scope?: PublicSelectedScope } = {}): Promise<PublicCapabilityResponse> {
      options.signal?.throwIfAborted();
      const response = await authenticatedFetch(endpoint, {
        method: 'POST',
        signal: options.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, input, ...(options.scope ? { scope: options.scope } : {}) }),
      });
      const raw = await response.text();
      options.signal?.throwIfAborted();
      let body: unknown = raw;
      if (raw) {
        try { body = JSON.parse(raw); } catch {
          if (response.ok) throw new Error('Public module response is not JSON.');
        }
      }
      if (!response.ok) throw moduleApiError(response.status, raw, response.statusText);
      return { status: response.status, body, headers: response.headers };
    },
  });
}
