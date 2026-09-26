import type { SkillsPageHost } from './SkillsPageHost';
import { SkillsPageHostProvider } from './SkillsPageHost';
import { PilotDeckDataTable, PilotDeckResourceImportDialog } from './business-primitives';
import type { DistillPageHost } from './DistillPageHost';
import { DistillPageHostProvider } from './DistillPageHost';
import * as React from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { staffDeckCopyClient, staffDeckKnowledgeClient, staffDeckSopManagementClient, type SopDefinition } from '../clients';
import { isCopyTarget, loadCopyDirectory, readCopyAgentScope } from './copy-scope';

// PilotDeck is a single-user host. The SOP management identity is supplied by
// the server-side StaffDeck API-key/agent binding; this value is only the
// local host context required by the source-derived shared page. It must not
// impersonate StaffDeck's example tenant.
export const PILOTDECK_SOP_TENANT_ID = 'pilotdeck-local';

function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined; }
function record(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }

function toSkill(definition: SopDefinition, status = 'published') {
  const content = record(definition.content);
  const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  const nodes = Array.isArray(content.nodes) ? content.nodes : [];
  return {
    ...definition,
    ...content,
    id: definition.id,
    skill_id: text(definition.skill_id) || definition.id,
    name: text(content.name) || text(definition.name) || definition.id,
    version: text(content.version) || text(definition.version) || '1',
    description: text(content.description) || text(definition.description) || '',
    business_domain: text(content.business_domain) || text(definition.business_domain) || '',
    status: text(definition.status) || status,
    updated_at: text(definition.updated_at) || new Date().toISOString(),
    content,
    call_count: Number(definition.call_count) || 0,
    positive_rate: Number(definition.positive_rate) || 0,
    negative_rate: Number(definition.negative_rate) || 0,
    total_call_count: Number(definition.total_call_count) || Number(definition.call_count) || 0,
    total_positive_rate: Number(definition.total_positive_rate) || Number(definition.positive_rate) || 0,
    total_negative_rate: Number(definition.total_negative_rate) || Number(definition.negative_rate) || 0,
    branch_status: text(definition.branch_status) || 'synced',
    draft_id: text(definition.draft_id),
    etag: text(definition.etag),
    trigger_intents: list(content.trigger_intents),
    user_utterance_examples: list(content.user_utterance_examples),
    goal: list(content.goal),
    required_info: list(content.required_info),
    response_rules: list(content.response_rules),
    nodes,
    terminal_node_ids: list(content.terminal_node_ids),
  };
}

function toManagedSkill(row: unknown) {
  const draft = record(row);
  const skillId = text(draft.skill_id) || text(draft.sop_id) || text(draft.id) || 'sop';
  return toSkill({
    ...draft,
    id: skillId,
    skill_id: skillId,
    draft_id: text(draft.draft_id) || text(draft.id),
    version: text(draft.draft_version) || text(draft.version),
    content: record(draft.content),
  } as SopDefinition, text(draft.status) || 'draft');
}

async function management(operation: string, input: Record<string, unknown> = {}): Promise<any> {
  return staffDeckSopManagementClient.call(operation, input);
}

async function listDefinitions(): Promise<any[]> {
  const result = record(await management('list'));
  // Prefer an existing draft for editing. The published row is still the
  // source of truth for version history, but a page save must retain the
  // draft id and etag returned by management.
  const rows = Array.isArray(result.drafts) && result.drafts.length > 0
    ? result.drafts
    : Array.isArray(result.data) ? result.data : [];
  return rows.map(toManagedSkill);
}

async function callSkillApi<T>(path: string, method: 'get' | 'post' | 'put' | 'delete', body?: any): Promise<T> {
  const match = path.match(/^\/api\/enterprise\/skills\/([^/?]+)(?:\/([^/?]+))?/);
  const importMatch = path.match(/^\/api\/enterprise\/agents\/([^/?]+)\/resources\/import$/);
  if (importMatch && method === 'post') return await staffDeckCopyClient.call<T>('import_resources', {
    targetAgentId: decodeURIComponent(importMatch[1]), sourceAgentId: body?.source_agent_id,
    resourceType: body?.resource_type, resourceIds: body?.resource_ids,
  });
  if (path.startsWith('/api/enterprise/skills?')) {
    if (method === 'get') return await listDefinitions() as T;
    if (method === 'post') return await management('create', { content: body?.content || {} }) as T;
  }
  if (path.startsWith('/api/enterprise/agents?')) return await loadCopyDirectory() as T;
  if (path.startsWith('/api/enterprise/agents/') && /\/skills\?tenant_id=[^&]+$/.test(path)) {
    if (method !== 'get') throw new Error(`Unsupported StaffDeck skills operation: ${method} ${path}`);
    const sourceAgentId = decodeURIComponent(path.split('/')[4]);
    return await staffDeckCopyClient.call<T>('list_skills', { sourceAgentId });
  }
  if (!match) throw new Error(`Unsupported StaffDeck skills path: ${path}`);
  const sopId = decodeURIComponent(match[1]);
  const suffix = match[2] ? decodeURIComponent(match[2]) : '';
  if (method === 'get' && suffix === 'versions') {
    const result = record(await management('list_versions', { sopId }));
    return (Array.isArray(result.data) ? result.data : result) as T;
  }
  if (method === 'get' && suffix) return await management('get_version', { sopId, version: suffix }) as T;
  if (method === 'post' && suffix === 'publish') {
    const current = await readDefinition(sopId);
    return await management('publish', { sopId, draftId: current.draft_id }) as T;
  }
  if (method === 'post' && suffix === 'archive') return await management('archive', { sopId }) as T;
  if (method === 'post' && suffix === 'draft') return await management('create', { sopId, content: body?.content || {} }) as T;
  if (method === 'post' && suffix === 'rollback') return await management('rollback', { sopId, version: body?.version }) as T;
  if (method === 'delete' && !suffix) return await management('archive', { sopId }) as T;
  throw new Error(`Unsupported StaffDeck skills operation: ${method} ${path}`);
}

function skillIdFromPath(path: string): string | undefined {
  const match = path.match(/^\/api\/enterprise\/skills\/([^/?]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

async function readDefinition(skillId: string): Promise<any> {
  const managed = await listDefinitions();
  const managedDefinition = managed.find((item) => item.id === skillId || item.skill_id === skillId);
  if (managedDefinition) return managedDefinition;
  throw new Error(`SOP definition not found in the configured management owner: ${skillId}`);
}

const SOP_CONTENT_FIELDS = new Set([
  'skill_id', 'name', 'version', 'business_domain', 'description', 'capability_scope',
  'step_timeout_seconds', 'trigger_intents', 'user_utterance_examples', 'goal',
  'required_info', 'slot_filling_policy', 'response_rules', 'nodes', 'edges',
  'start_node_id', 'terminal_node_ids', 'interruption_policy',
]);

function skillContent(current: Record<string, any>, body: unknown) {
  const next = { ...record(current.content) };
  const candidate = record(body);
  for (const field of SOP_CONTENT_FIELDS) {
    if (candidate[field] !== undefined) next[field] = candidate[field];
  }
  return { ...next, ...record(candidate.content) };
}

async function callDistillApi<T>(path: string, method: 'get' | 'post' | 'put' | 'delete', body?: any): Promise<T> {
  if (path.startsWith('/api/enterprise/tools')) throw new Error('PilotDeck tools capability is unavailable in this host.');
  if (path.startsWith('/api/enterprise/general-skills')) throw new Error('PilotDeck general-skills capability is unavailable in this host.');
  if (path.startsWith('/api/enterprise/model-configs')) throw new Error('PilotDeck model-configs capability is unavailable in this host.');
  if (path.startsWith('/api/auth/users')) throw new Error('PilotDeck user-directory capability is unavailable in this host.');
  if (path.startsWith('/api/enterprise/knowledge-bases')) return await staffDeckKnowledgeClient.call<T>('list_bases');
  if (path.startsWith('/api/enterprise/skills?')) {
    if (method === 'get') return await listDefinitions() as T;
    if (method === 'post') return await management('create', { content: body?.content || {} }) as T;
  }
  const skillId = skillIdFromPath(path);
  if (skillId && method === 'get' && !path.includes('/versions')) return await readDefinition(skillId) as T;
  if (skillId && method === 'put' && !path.includes('/versions')) {
    const current = await readDefinition(skillId);
    const content = skillContent(current, body);
    if (text(current.draft_id) && text(current.etag)) {
      try {
        const saved = await management('replace_draft', {
          sopId: skillId,
          draftId: current.draft_id,
          etag: current.etag,
          content,
        });
        return toManagedSkill(saved) as T;
      } catch (error) {
        // Publishing can leave a stale draft row in list results. Recreate
        // it only for the explicit not-found conflict; other failures must
        // remain visible to the page.
        if ((error as { status?: number })?.status !== 404) throw error;
      }
    }
    // A published management row may not have a draft yet. Create it with
    // the same owner; lack of management must remain an explicit failure.
    const saved = await management('create', { sopId: skillId, content });
    return toManagedSkill(saved) as T;
  }
  if (method === 'post' && path.startsWith('/api/enterprise/skills/jobs/')) throw new Error('SOP generation streaming is unavailable in the portable PilotDeck definition host.');
  return await callSkillApi<T>(path, method, body);
}

export const pilotDeckSkillsPageHost: SkillsPageHost = {
  components: { DataTable: PilotDeckDataTable, ResourceImportDialog: PilotDeckResourceImportDialog },
  api: {
    get: (path) => callSkillApi(path, 'get'),
    post: (path, body) => callSkillApi(path, 'post', body),
    put: (path, body) => callSkillApi(path, 'put', body),
    delete: (path) => callSkillApi(path, 'delete'),
  },
  navigate: (path: string) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); },
  tenantId: PILOTDECK_SOP_TENANT_ID,
  notify: { success: (message) => console.info(message), warning: (message) => console.warn(message), error: (message) => console.error(message) },
  isEnterpriseAdmin: (user) => Boolean(user?.is_admin),
  canManageEmployeeAgent: (agent) => Boolean(isCopyTarget(agent) && agent.can_manage === true),
  openGalleryAgentId: (agents) => agents.find((agent) => agent.is_overall)?.id || '',
  openGalleryImportSourceOptions: (agents) => agents.filter((agent) => agent.is_overall).map((agent) => ({ value: agent.id, label: agent.name || agent.id })),
  resourceCreatorName: (row) => text(row.created_by_name) || '',
  visibleEmployeeAgents: (agents, _user, options = {}) => agents.filter((agent) => !agent.is_overall && (!options.activeOnly || agent.active !== false) && agent.id !== options.excludeAgentId),
  readEmployeeScope: readCopyAgentScope,
  isTeamScope: (value) => value.startsWith('team:'),
  useClientPagination: <T,>(items: T[], pageSize: number, resetKey: unknown) => {
    const [page, setPage] = React.useState(1);
    React.useEffect(() => setPage(1), [resetKey]);
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    const safePage = Math.min(page, pageCount);
    return { page: safePage, pageCount, setPage, pagedItems: items.slice((safePage - 1) * pageSize, safePage * pageSize) };
  },
};

export function PilotDeckSkillsPageProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let mounted = true;
    void loadCopyDirectory()
      .then(() => management('list'))
      .then(() => { if (mounted) setReady(true); })
      .catch((cause) => { if (mounted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { mounted = false; };
  }, []);
  if (error) return <div role="alert">{error}</div>;
  if (!ready) return null;
  return <SkillsPageHostProvider value={{ ...pilotDeckSkillsPageHost, navigate: (path) => {
    if (!path.startsWith('/enterprise/skills')) return navigate(path);
    const queryIndex = path.indexOf('?');
    navigate(path.includes('/distill') ? `/sop/distill${queryIndex >= 0 ? path.slice(queryIndex) : ''}` : `/sop${queryIndex >= 0 ? path.slice(queryIndex) : ''}`);
  } }}>{children}</SkillsPageHostProvider>;
}

export const pilotDeckDistillPageHost: DistillPageHost = {
  api: {
    get: (path, options) => callDistillApi(path, 'get', options),
    post: (path, body) => callDistillApi(path, 'post', body),
    postWithSignal: (path, body) => callDistillApi(path, 'post', body),
    put: (path, body) => callDistillApi(path, 'put', body),
    delete: (path) => callDistillApi(path, 'delete'),
  },
  streamGet: async () => { throw new Error('SOP generation streaming is unavailable in the portable PilotDeck definition host.'); },
  streamPost: async () => { throw new Error('SOP generation streaming is unavailable in the portable PilotDeck definition host.'); },
  navigate: (path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); },
  tenantId: PILOTDECK_SOP_TENANT_ID,
  notify: { success: (message) => console.info(message), warning: (message) => console.warn(message), error: (message) => console.error(message), info: (message) => console.info(message) },
  readEmployeeScope: () => '',
  isTeamScope: (value) => value.startsWith('team:'),
};

export function PilotDeckDistillPageProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return <DistillPageHostProvider value={{ ...pilotDeckDistillPageHost, navigate: (path, options) => navigate(path, options) }}>{children}</DistillPageHostProvider>;
}
