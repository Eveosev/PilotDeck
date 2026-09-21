import { authenticatedFetch } from '../../../utils/api';

type ModuleError = { error?: { message?: string } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, init);
  const body = await response.json().catch(() => ({})) as T & ModuleError;
  if (!response.ok) throw new Error(body.error?.message || `Module request failed (${response.status}).`);
  return body;
}

export type StaffDeckKnowledgeClient = {
  call<T>(operation: string, input?: Record<string, unknown>): Promise<T>;
};

export const staffDeckKnowledgeClient: StaffDeckKnowledgeClient = {
  async call<T>(operation: string, input: Record<string, unknown> = {}) {
    const body = await request<{ result: T }>('/api/modules/knowledge/call', {
      method: 'POST',
      body: JSON.stringify({ operation, input }),
    });
    return body.result;
  },
};

export type SopDefinition = Record<string, unknown> & { id: string };

export type StaffDeckSopClient = {
  listDefinitions(): Promise<{ defaultSopId: string; definitions: SopDefinition[] }>;
  saveDefinition(id: string, definition: SopDefinition): Promise<{ definition: SopDefinition; restartRequired: boolean }>;
  status(sessionKey: string, projectKey?: string): Promise<Record<string, unknown> | null>;
};

export const staffDeckSopClient: StaffDeckSopClient = {
  listDefinitions: () => request('/api/modules/sop/definitions'),
  async saveDefinition(id, definition) {
    const result = await request<{ definition: SopDefinition; restartRequired: boolean }>(`/api/modules/sop/definitions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ definition }),
    });
    if (result.restartRequired) window.dispatchEvent(new Event('pilotdeck:module-runtime-changed'));
    return result;
  },
  async status(sessionKey, projectKey) {
    const query = new URLSearchParams({ sessionKey });
    if (projectKey) query.set('projectKey', projectKey);
    const body = await request<{ status?: Record<string, unknown> }>(`/api/sop/status?${query}`);
    return body.status ?? null;
  },
};
