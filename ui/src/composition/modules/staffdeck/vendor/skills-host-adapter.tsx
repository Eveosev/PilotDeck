import type { SkillsPageHost } from './SkillsPageHost';
import { SkillsPageHostProvider } from './SkillsPageHost';
import * as React from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { staffDeckSopClient, staffDeckSopManagementClient, type SopDefinition } from '../clients';

function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined; }
function record(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }

function toSkill(definition: SopDefinition, status = 'published') {
  const content = record(definition.content);
  return {
    ...definition,
    id: definition.id,
    skill_id: text(definition.skill_id) || definition.id,
    name: text(definition.name) || definition.id,
    version: text(definition.version) || '1',
    business_domain: text(definition.business_domain) || '',
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
  };
}

async function management(operation: string, input: Record<string, unknown> = {}): Promise<any> {
  return staffDeckSopManagementClient.call(operation, input);
}

async function listDefinitions(): Promise<any[]> {
  try {
    const result = record(await management('list'));
    const rows = Array.isArray(result.data) ? result.data : [];
    return rows.map((row) => toSkill({ ...record(row), id: text(row.skill_id) || text(row.id) || 'sop' } as SopDefinition, text(row.status) || 'published'));
  } catch {
    const result = await staffDeckSopClient.listDefinitions();
    return result.definitions.map((definition) => toSkill(definition, text(definition.status) || 'draft'));
  }
}

async function callSkillApi<T>(path: string, method: 'get' | 'post' | 'put' | 'delete', body?: any): Promise<T> {
  const match = path.match(/^\/api\/enterprise\/skills\/([^/?]+)(?:\/([^/?]+))?/);
  if (path.startsWith('/api/enterprise/skills?')) return await listDefinitions() as T;
  if (path.startsWith('/api/enterprise/agents?')) return [{ id: 'overall', name: 'StaffDeck', is_overall: true }] as T;
  if (path.startsWith('/api/enterprise/agents/') && path.endsWith('/skills?tenant_id=tenant_demo')) return await listDefinitions() as T;
  if (!match) throw new Error(`Unsupported StaffDeck skills path: ${path}`);
  const sopId = decodeURIComponent(match[1]);
  const suffix = match[2] ? decodeURIComponent(match[2]) : '';
  if (method === 'get' && suffix === 'versions') return await management('list_versions', { sopId }) as T;
  if (method === 'get' && suffix) return await management('get_version', { sopId, version: suffix }) as T;
  if (method === 'post' && suffix === 'publish') return await management('publish', { sopId }) as T;
  if (method === 'post' && suffix === 'archive') return await management('archive', { sopId }) as T;
  if (method === 'post' && suffix === 'draft') return await management('create', { sopId, content: body?.content || {} }) as T;
  if (method === 'post' && suffix === 'rollback') return await management('rollback', { sopId, version: body?.version }) as T;
  if (method === 'delete' && !suffix) return await management('archive', { sopId }) as T;
  throw new Error(`Unsupported StaffDeck skills operation: ${method} ${path}`);
}

export const pilotDeckSkillsPageHost: SkillsPageHost = {
  api: {
    get: (path) => callSkillApi(path, 'get'),
    post: (path, body) => callSkillApi(path, 'post', body),
    put: (path, body) => callSkillApi(path, 'put', body),
    delete: (path) => callSkillApi(path, 'delete'),
  },
  navigate: (path: string) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); },
  tenantId: 'tenant_demo',
  notify: { success: (message) => console.info(message), warning: (message) => console.warn(message), error: (message) => console.error(message) },
  isEnterpriseAdmin: () => true,
  canManageEmployeeAgent: () => true,
  openGalleryAgentId: 'overall',
  openGalleryImportSourceOptions: (agents) => agents.map((agent) => ({ value: agent.id, label: agent.name || agent.id })),
  resourceCreatorName: (row) => text(row.created_by_name) || '',
  visibleEmployeeAgents: (agents, _user, options = {}) => agents.filter((agent) => !agent.is_overall && (!options.activeOnly || agent.active !== false) && agent.id !== options.excludeAgentId),
  readEmployeeScope: () => '',
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
  return <SkillsPageHostProvider value={{ ...pilotDeckSkillsPageHost, navigate: (path) => {
    if (!path.startsWith('/enterprise/skills')) return navigate(path);
    const queryIndex = path.indexOf('?');
    navigate(`/sop${queryIndex >= 0 ? path.slice(queryIndex) : ''}`);
  } }}>{children}</SkillsPageHostProvider>;
}
