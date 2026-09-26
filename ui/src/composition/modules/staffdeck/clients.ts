import { authenticatedFetch } from '../../../utils/api';

type ModuleError = { error?: { message?: string } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, init);
  const body = await response.json().catch(() => ({})) as T & ModuleError;
  if (!response.ok) {
    const error = new Error(body.error?.message || `Module request failed (${response.status}).`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
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

export const staffDeckCopyClient = {
  async call<T>(operation: 'list_agents' | 'list_knowledge_bases' | 'list_skills' | 'import_resources', input: Record<string, unknown> = {}): Promise<T> {
    const body = await request<{ result: T }>('/api/modules/staffdeck-copy/call', {
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
  restartRuntime(): Promise<void>;
  status(sessionKey: string, projectKey?: string): Promise<Record<string, unknown> | null>;
};

export type SopManagementStatus = { enabled: true; methods: string[]; agentId: string };
export type StaffDeckSopManagementClient = {
  status(): Promise<SopManagementStatus>;
  call<T>(operation: string, input?: Record<string, unknown>): Promise<T>;
};

export const staffDeckSopManagementClient: StaffDeckSopManagementClient = {
  status: () => request('/api/modules/sop/management'),
  async call<T>(operation: string, input: Record<string, unknown> = {}) {
    const body = await request<{ result: T }>('/api/modules/sop/management/call', {
      method: 'POST',
      body: JSON.stringify({ operation, input }),
    });
    return body.result;
  },
};

export const staffDeckSopClient: StaffDeckSopClient = {
  listDefinitions: () => request('/api/modules/sop/definitions'),
  async saveDefinition(id, definition) {
    const result = await request<{ definition: SopDefinition; restartRequired: boolean }>(`/api/modules/sop/definitions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ definition }),
    });
    return result;
  },
  async restartRuntime() {
    await request('/api/update/restart', { method: 'POST' });
  },
  async status(sessionKey, projectKey) {
    const query = new URLSearchParams({ sessionKey });
    if (projectKey) query.set('projectKey', projectKey);
    const body = await request<{ status?: Record<string, unknown> }>(`/api/sop/status?${query}`);
    return body.status ?? null;
  },
};
