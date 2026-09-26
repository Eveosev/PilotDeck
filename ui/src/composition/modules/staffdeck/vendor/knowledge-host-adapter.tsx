import type { Host } from './KnowledgePageHost';
import { KnowledgePageHostProvider } from './KnowledgePageHost';
import { BusinessDataTable, BusinessResourceImportDialog } from './SkillsPageHost';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { staffDeckCopyClient, staffDeckKnowledgeClient } from '../clients';
import { isCopyTarget, loadCopyDirectory, readCopyAgentScope } from './copy-scope';

function query(path: string): URL { return new URL(path, 'http://staffdeck.local'); }
function record(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }
function decodePathSegment(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}
function optionalQueryInput(url: URL): Record<string, string> {
  const input: Record<string, string> = {};
  for (const [queryKey, inputKey] of [['tenant_id', 'tenantId'], ['agent_id', 'agentId'], ['knowledge_base_id', 'knowledgeBaseId'], ['status', 'status']] as const) {
    const value = url.searchParams.get(queryKey);
    if (value) input[inputKey] = value;
  }
  return input;
}
const PILOTDECK_AGENT_SCOPE_KEY = 'ultrarag_enterprise_agent_scope';
function pilotDeckAgentScope(): string {
  return readCopyAgentScope();
}
async function pilotDeckAgentDirectory(): Promise<Array<{ id: string; name: string; is_overall: boolean; active: boolean }>> {
  return loadCopyDirectory();
}

async function knowledge<T>(operation: string, input: Record<string, unknown> = {}): Promise<T> {
  return staffDeckKnowledgeClient.call<T>(operation, input);
}

async function callKnowledge<T>(path: string, method: 'get' | 'post' | 'put' | 'delete', body?: any): Promise<T> {
  const url = query(path);
  const segments = url.pathname.split('/').filter(Boolean);
  if (url.pathname === '/api/enterprise/agents' && method === 'get') return await staffDeckCopyClient.call<T>('list_agents');
  if (url.pathname === '/api/enterprise/knowledge-bases' && method === 'get') {
    const sourceAgentId = url.searchParams.get('agent_id');
    if (sourceAgentId && sourceAgentId !== pilotDeckAgentScope()) {
      return await staffDeckCopyClient.call<T>('list_knowledge_bases', { sourceAgentId });
    }
    return await knowledge<T>('list_bases', optionalQueryInput(url));
  }
  if (segments[1] === 'enterprise' && segments[2] === 'agents' && segments[3] && segments[4] === 'resources' && segments[5] === 'import' && method === 'post') {
    return await staffDeckCopyClient.call<T>('import_resources', {
      targetAgentId: decodePathSegment(segments[3]), sourceAgentId: body?.source_agent_id,
      resourceType: body?.resource_type, resourceIds: body?.resource_ids,
    });
  }
  if (url.pathname === '/api/enterprise/knowledge-bases' && method === 'post') return await knowledge<T>('create_base', body || {});
  if (url.pathname === '/api/enterprise/knowledge/documents' && method === 'get') return await knowledge<T>('list_documents', optionalQueryInput(url));
  if (url.pathname === '/api/enterprise/knowledge/documents' && method === 'post') return await knowledge<T>('import_document', { ...body, ...optionalQueryInput(url) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'documents' && segments[4] && segments[5] === 'buckets' && method === 'get') return await knowledge<T>('list_document_buckets', { documentId: segments[4], ...optionalQueryInput(url) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'documents' && segments[4] && method === 'get') return await knowledge<T>('get_document', { documentId: segments[4] });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'documents' && segments[4] && method === 'put') return await knowledge<T>('update_document', { documentId: segments[4], ...(body || {}) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'documents' && segments[4] && method === 'delete') return await knowledge<T>('delete_document', { documentId: segments[4] });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'knowledge-bases') return await knowledge<T>('list_bases');
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge-bases' && segments[3] && segments[4] === 'versions' && method === 'get') return await knowledge<T>('list_versions', { knowledgeBaseId: segments[3], ...optionalQueryInput(url) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge-bases' && segments[3] && segments[4] === 'sync-from-overall' && method === 'post') return await knowledge<T>('sync_base', { knowledgeBaseId: segments[3], agentId: url.searchParams.get('agent_id') || '' });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge-bases' && segments[3] && segments[4] === 'promote-to-overall' && method === 'post') return await knowledge<T>('publish_version', { knowledgeBaseId: segments[3], agentId: url.searchParams.get('agent_id') || '' });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge-bases' && segments[3] && segments[4] === 'rollback' && method === 'post') return await knowledge<T>('rollback_version', { knowledgeBaseId: segments[3], ...(body || {}) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge-bases' && segments[3] && segments[4] === 'okf' && segments[5] === 'concepts' && method === 'get') return await knowledge<T>('list_okf_concepts', { knowledgeBaseId: segments[3], ...optionalQueryInput(url) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge-bases' && segments[3] && segments[4] === 'okf' && segments[5] === 'export' && method === 'get') return await knowledge<T>('export_okf', { knowledgeBaseId: segments[3], ...optionalQueryInput(url) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge-bases' && segments[3] && segments[4] === 'okf' && segments[5] === 'lint' && method === 'post') return await knowledge<T>('lint_okf', { knowledgeBaseId: segments[3], ...optionalQueryInput(url), ...(body || {}) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge-bases' && segments[3] && method === 'put') return await knowledge<T>('update_base', { knowledgeBaseId: segments[3], ...(body || {}) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge-bases' && segments[3] && method === 'delete') return await knowledge<T>('delete_base', { knowledgeBaseId: segments[3] });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'search' && method === 'post') return await knowledge<T>('query', body || {});
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'okf' && segments[4] === 'import' && method === 'post') return await knowledge<T>('import_okf', body || {});
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'buckets' && segments[4] && segments[5] === 'chunks' && method === 'get') return await knowledge<T>('list_bucket_chunks', { bucketId: segments[4], ...optionalQueryInput(url) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'buckets' && segments[4] && method === 'put') return await knowledge<T>('update_bucket', { bucketId: segments[4], ...(body || {}) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'chunks' && segments[4] && method === 'put') return await knowledge<T>('update_chunk', { chunkId: segments[4], ...(body || {}) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'citations' && segments[4] && method === 'get') return await knowledge<T>('resolve_citation', { chunkId: segments[4] });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'jobs' && segments[4] && segments[5] === 'cancel' && method === 'post') return await knowledge<T>('cancel_job', { jobId: decodePathSegment(segments[4]), ...optionalQueryInput(url) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'jobs' && segments[4] && method === 'get') return await knowledge<T>('get_job', { jobId: decodePathSegment(segments[4]), ...optionalQueryInput(url) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'jobs' && method === 'get') return await knowledge<T>('list_jobs', { limit: Number(url.searchParams.get('limit') || 20), ...optionalQueryInput(url) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'discoveries' && segments[4] && segments[5] === 'confirm' && method === 'post') return await knowledge<T>('confirm_discovery', { suggestionId: decodePathSegment(segments[4]), ...optionalQueryInput(url) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'discoveries' && segments[4] && segments[5] === 'reject' && method === 'post') return await knowledge<T>('reject_discovery', { suggestionId: decodePathSegment(segments[4]), ...optionalQueryInput(url) });
  if (segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'discoveries' && method === 'get') return await knowledge<T>('list_discoveries', optionalQueryInput(url));
  throw new Error(`Unsupported StaffDeck Knowledge path: ${method} ${path}`);
}

export const pilotDeckKnowledgePageHost: Host = {
  components: { DataTable: BusinessDataTable, ResourceImportDialog: BusinessResourceImportDialog },
  api: { get: (path) => callKnowledge(path, 'get'), post: (path, body) => callKnowledge(path, 'post', body), put: (path, body) => callKnowledge(path, 'put', body), delete: (path) => callKnowledge(path, 'delete'), blob: async (path) => {
    const result = record(await callKnowledge(path, 'get'));
    if (typeof result.content_base64 === 'string') {
      const binary = atob(result.content_base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return new Blob([bytes], { type: String(result.media_type || 'application/octet-stream') });
    }
    return new Blob([JSON.stringify(result)], { type: 'application/json' });
  } },
  navigate: (path: string) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); },
  tenantId: 'tenant_demo', notify: { success: (message) => console.info(message), warning: (message) => console.warn(message), error: (message) => console.error(message) }, isEnterpriseAdmin: (user) => Boolean(user?.is_admin),
  loadEmployeeDirectory: async () => pilotDeckAgentDirectory(), agentScope: {
    read: pilotDeckAgentScope,
    persist: (value) => { try { window.localStorage.setItem(PILOTDECK_AGENT_SCOPE_KEY, value); } catch {} },
    clear: () => { try { window.localStorage.removeItem(PILOTDECK_AGENT_SCOPE_KEY); } catch {} },
    emit: (value) => { window.dispatchEvent(new CustomEvent('ultrarag-enterprise-agent-scope-change', { detail: { agentId: value } })); },
  },
  visibleEmployeeAgents: (agents) => agents.filter((agent) => !agent.is_overall), canManageEmployeeAgent: (agent) => Boolean(isCopyTarget(agent) && agent.can_manage === true), openGalleryAgentId: (agents) => agents.find((agent) => agent.is_overall)?.id || '', openGalleryImportSourceOptions: (agents) => agents.filter((agent) => agent.is_overall).map((agent) => ({ value: agent.id, label: agent.name || agent.id })), resourceCreatorName: (row) => String(row.created_by_name || ''), renderMarkdownBlocks: (value) => <span>{value}</span>, getDateLocale: () => 'zh-CN',
};

function mapKnowledgePath(path: string): string {
  if (path === '/enterprise/knowledge' || path === '/enterprise/knowledge/') return '/knowledge';
  if (path.startsWith('/enterprise/knowledge/')) return `/knowledge/${path.slice('/enterprise/knowledge/'.length)}`;
  return path;
}

export function PilotDeckKnowledgePageProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    void loadCopyDirectory().then(() => { if (mounted) setReady(true); }).catch((cause) => { if (mounted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { mounted = false; };
  }, []);
  if (error) return <div role="alert">{error}</div>;
  if (!ready) return null;
  return <KnowledgePageHostProvider value={{ ...pilotDeckKnowledgePageHost, navigate: (path) => navigate(mapKnowledgePath(path)) }}>{children}</KnowledgePageHostProvider>;
}
