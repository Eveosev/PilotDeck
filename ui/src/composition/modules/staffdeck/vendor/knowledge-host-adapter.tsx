import type { Host } from './KnowledgePageHost';
import { KnowledgePageHostProvider } from './KnowledgePageHost';
import { PilotDeckDataTable, PilotDeckResourceImportDialog } from './business-primitives';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { staffDeckCopyClient, staffDeckKnowledgeClient } from '../clients';
import { staffDeckNotify } from '../host-notify';
import { createCopyContext, isCopyTarget, loadCopyDirectory, readCopyAgentScope, type CopyContext } from './copy-scope';
import './knowledge-host-theme.css';
import { PilotDeckDialog, PilotDeckDialogContent, PilotDeckDialogTitle } from './dialog-primitives';
import { pilotDeckFormalComponents, pilotDeckFormalIcons } from './host-components';
import { renderMarkdownBlocks } from './FormalMarkdown';

function query(path: string): URL { return new URL(path, 'http://staffdeck.local'); }
function record(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }
function decodePathSegment(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}
function optionalQueryInput(url: URL): Record<string, string | boolean> {
  const input: Record<string, string | boolean> = {};
  for (const [queryKey, inputKey] of [['tenant_id', 'tenantId'], ['agent_id', 'agentId'], ['knowledge_base_id', 'knowledgeBaseId'], ['status', 'status'], ['concept_type', 'conceptType'], ['include_all_versions', 'includeAllVersions']] as const) {
    const value = url.searchParams.get(queryKey);
    if (value !== null && value !== '') {
      if (inputKey === 'includeAllVersions') {
        if (!['true', 'false', '1', '0'].includes(value.toLowerCase())) throw new Error('Invalid include_all_versions query value.');
        input[inputKey] = ['true', '1'].includes(value.toLowerCase());
      } else input[inputKey] = value;
    }
  }
  if (url.searchParams.has('include_all_versions')) input.includeAllVersions = ['true', '1'].includes(url.searchParams.get('include_all_versions') || '');
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

async function callKnowledge<T>(path: string, method: 'get' | 'post' | 'put' | 'delete', body?: any, context?: CopyContext): Promise<T> {
  const url = query(path);
  const segments = url.pathname.split('/').filter(Boolean);
  const exact = (...shape: string[]) => segments.length === shape.length && shape.every((part, index) => part === '*' ? Boolean(segments[index]) : part === segments[index]);
  if (segments[0] !== 'api' || segments[1] !== 'enterprise') throw new Error(`Unsupported StaffDeck Knowledge path: ${method} ${path}`);
  const conceptPath = segments[2] === 'knowledge-bases' && segments[4] === 'okf' && segments[5] === 'concepts';
  const allowedLength = segments[2] === 'agents' ? 6
    : segments[2] === 'knowledge-bases' ? (segments[4] === 'okf' ? 6 : 5)
    : segments[2] === 'knowledge' ? (segments[3] === 'knowledge-bases' ? 4 : 6) : 0;
  if (!conceptPath && segments.length > allowedLength) throw new Error(`Unsupported StaffDeck Knowledge path: ${method} ${path}`);
  if (url.pathname === '/api/enterprise/agents' && method === 'get') return await staffDeckCopyClient.call<T>('list_agents');
  if (url.pathname === '/api/enterprise/knowledge-bases' && method === 'get') {
    const sourceAgentId = url.searchParams.get('agent_id');
    if (sourceAgentId && sourceAgentId !== (context ? context.readScope() : pilotDeckAgentScope())) {
      return await staffDeckCopyClient.call<T>('list_knowledge_bases', { sourceAgentId });
    }
    return await knowledge<T>('list_bases', optionalQueryInput(url));
  }
  if (exact('api', 'enterprise', 'agents', '*', 'resources', 'import') && method === 'post') {
    return await staffDeckCopyClient.call<T>('import_resources', {
      targetAgentId: decodePathSegment(segments[3]), sourceAgentId: body?.source_agent_id,
      resourceType: body?.resource_type, resourceIds: body?.resource_ids,
    });
  }
  if (url.pathname === '/api/enterprise/knowledge-bases' && method === 'post') return await knowledge<T>('create_base', { ...(body || {}), ...optionalQueryInput(url) });
  if (url.pathname === '/api/enterprise/knowledge/documents' && method === 'get') return await knowledge<T>('list_documents', optionalQueryInput(url));
  if (url.pathname === '/api/enterprise/knowledge/documents' && method === 'post') return await knowledge<T>('import_document', { ...body, ...optionalQueryInput(url) });
  if (segments[0] === 'api' && segments[1] === 'enterprise' && segments[2] === 'knowledge' && segments[3] === 'documents' && segments[4]) {
    const documentId = decodePathSegment(segments[4]);
    const scope = optionalQueryInput(url);
    if (segments.length === 6 && segments[5] === 'buckets' && method === 'get') return await knowledge<T>('list_document_buckets', { ...scope, documentId });
    if (segments.length === 5 && method === 'get') return await knowledge<T>('get_document', { ...scope, documentId });
    if (segments.length === 5 && method === 'put') return await knowledge<T>('update_document', { ...(body || {}), ...scope, documentId });
    if (segments.length === 5 && method === 'delete') return await knowledge<T>('delete_document', { ...scope, documentId });
    throw new Error(`Unsupported StaffDeck Knowledge document operation: ${method} ${path}`);
  }
  if (exact('api', 'enterprise', 'knowledge', 'knowledge-bases') && method === 'get') return await knowledge<T>('list_bases', optionalQueryInput(url));
  if (exact('api', 'enterprise', 'knowledge-bases', '*', 'versions') && method === 'get') return await knowledge<T>('list_versions', { knowledgeBaseId: decodePathSegment(segments[3]), ...optionalQueryInput(url) });
  if (exact('api', 'enterprise', 'knowledge-bases', '*', 'sync-from-overall') && method === 'post') return await knowledge<T>('sync_base', { ...optionalQueryInput(url), knowledgeBaseId: decodePathSegment(segments[3]) });
  if (exact('api', 'enterprise', 'knowledge-bases', '*', 'promote-to-overall') && method === 'post') return await knowledge<T>('publish_version', { ...optionalQueryInput(url), knowledgeBaseId: decodePathSegment(segments[3]) });
  if (exact('api', 'enterprise', 'knowledge-bases', '*', 'rollback') && method === 'post') return await knowledge<T>('rollback_version', { ...(body || {}), ...optionalQueryInput(url), knowledgeBaseId: decodePathSegment(segments[3]) });
  if (segments[0] === 'api' && segments[1] === 'enterprise' && segments[2] === 'knowledge-bases' && segments[3] && segments[4] === 'okf' && segments[5] === 'concepts') {
    const knowledgeBaseId = decodePathSegment(segments[3]);
    const scope = optionalQueryInput(url);
    if (segments.length === 6 && method === 'get') return await knowledge<T>('list_okf_concepts', { ...scope, knowledgeBaseId });
    if (segments.length > 6 && (method === 'get' || method === 'put')) {
      const conceptId = segments.slice(6).map(decodePathSegment).join('/');
      const input = method === 'get' ? { ...scope, knowledgeBaseId, conceptId } : {
        tenantId: body?.tenant_id, documentId: body?.document_id,
        contentMd: body?.content_md, status: body?.status,
        ...scope, knowledgeBaseId, conceptId,
      };
      const result = await knowledge<any>(method === 'get' ? 'get_okf_concept' : 'upsert_okf_concept', input);
      if (!result || Array.isArray(result) || typeof result.concept_id !== 'string' || typeof result.content_md !== 'string') throw new Error('Knowledge concept response does not match the formal concept contract.');
      return result as T;
    }
    throw new Error(`Unsupported StaffDeck Knowledge concept operation: ${method} ${path}`);
  }
  if (exact('api', 'enterprise', 'knowledge-bases', '*', 'okf', 'export') && method === 'get') return await knowledge<T>('export_okf', { knowledgeBaseId: decodePathSegment(segments[3]), ...optionalQueryInput(url) });
  if (exact('api', 'enterprise', 'knowledge-bases', '*', 'okf', 'lint') && method === 'post') return await knowledge<T>('lint_okf', { ...(body || {}), ...optionalQueryInput(url), knowledgeBaseId: decodePathSegment(segments[3]) });
  if (exact('api', 'enterprise', 'knowledge-bases', '*') && method === 'get') return await knowledge<T>('get_base', { ...optionalQueryInput(url), knowledgeBaseId: decodePathSegment(segments[3]) });
  if (exact('api', 'enterprise', 'knowledge-bases', '*') && method === 'put') return await knowledge<T>('update_base', { ...(body || {}), ...optionalQueryInput(url), knowledgeBaseId: decodePathSegment(segments[3]) });
  if (exact('api', 'enterprise', 'knowledge-bases', '*') && method === 'delete') return await knowledge<T>('delete_base', { ...optionalQueryInput(url), knowledgeBaseId: decodePathSegment(segments[3]) });
  if (exact('api', 'enterprise', 'knowledge', 'search') && method === 'post') return await knowledge<T>('query', { ...(body || {}), ...optionalQueryInput(url) });
  if (exact('api', 'enterprise', 'knowledge', 'okf', 'import') && method === 'post') return await knowledge<T>('import_okf', { ...(body || {}), ...optionalQueryInput(url) });
  if (exact('api', 'enterprise', 'knowledge', 'buckets', '*', 'chunks') && method === 'get') return await knowledge<T>('list_bucket_chunks', { bucketId: decodePathSegment(segments[4]), ...optionalQueryInput(url) });
  if (exact('api', 'enterprise', 'knowledge', 'buckets', '*') && method === 'put') return await knowledge<T>('update_bucket', { ...(body || {}), ...optionalQueryInput(url), bucketId: decodePathSegment(segments[4]) });
  if (exact('api', 'enterprise', 'knowledge', 'chunks', '*') && method === 'put') return await knowledge<T>('update_chunk', { ...(body || {}), ...optionalQueryInput(url), chunkId: decodePathSegment(segments[4]) });
  if (exact('api', 'enterprise', 'knowledge', 'citations', '*') && method === 'get') return await knowledge<T>('resolve_citation', { ...optionalQueryInput(url), chunkId: decodePathSegment(segments[4]) });
  if (exact('api', 'enterprise', 'knowledge', 'jobs', '*', 'cancel') && method === 'post') return await knowledge<T>('cancel_job', { jobId: decodePathSegment(segments[4]), ...optionalQueryInput(url) });
  if (exact('api', 'enterprise', 'knowledge', 'jobs', '*') && method === 'get') return await knowledge<T>('get_job', { jobId: decodePathSegment(segments[4]), ...optionalQueryInput(url) });
  if (exact('api', 'enterprise', 'knowledge', 'jobs') && method === 'get') return await knowledge<T>('list_jobs', { limit: Number(url.searchParams.get('limit') || 20), ...optionalQueryInput(url) });
  if (exact('api', 'enterprise', 'knowledge', 'discoveries', '*', 'confirm') && method === 'post') return await knowledge<T>('confirm_discovery', { suggestionId: decodePathSegment(segments[4]), ...optionalQueryInput(url) });
  if (exact('api', 'enterprise', 'knowledge', 'discoveries', '*', 'reject') && method === 'post') return await knowledge<T>('reject_discovery', { suggestionId: decodePathSegment(segments[4]), ...optionalQueryInput(url) });
  if (exact('api', 'enterprise', 'knowledge', 'discoveries') && method === 'get') return await knowledge<T>('list_discoveries', optionalQueryInput(url));
  throw new Error(`Unsupported StaffDeck Knowledge path: ${method} ${path}`);
}

export const pilotDeckKnowledgePageHost: Host = {
  icons: pilotDeckFormalIcons,
  components: { ...pilotDeckFormalComponents, DataTable: PilotDeckDataTable, ResourceImportDialog: PilotDeckResourceImportDialog },
  api: { get: (path) => callKnowledge(path, 'get'), post: (path, body) => callKnowledge(path, 'post', body), put: (path, body) => callKnowledge(path, 'put', body), delete: (path) => callKnowledge(path, 'delete'), blob: async (path) => {
    const result = record(await callKnowledge(path, 'get'));
    if (typeof result.content_base64 === 'string') {
      const binary = atob(result.content_base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return new Blob([bytes], { type: String(result.media_type || 'application/octet-stream') });
    }
    throw new Error('Knowledge export response is missing its formal content_base64 archive.');
  } },
  navigate: (path: string) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); },
  tenantId: 'tenant_demo', notify: staffDeckNotify, isEnterpriseAdmin: (user) => Boolean(user?.is_admin),
  loadEmployeeDirectory: async () => pilotDeckAgentDirectory(), agentScope: {
    read: pilotDeckAgentScope,
    persist: (value) => { try { window.localStorage.setItem(PILOTDECK_AGENT_SCOPE_KEY, value); } catch {} },
    clear: () => { try { window.localStorage.removeItem(PILOTDECK_AGENT_SCOPE_KEY); } catch {} },
    emit: (value) => { window.dispatchEvent(new CustomEvent('ultrarag-enterprise-agent-scope-change', { detail: { agentId: value } })); },
  },
  visibleEmployeeAgents: (agents) => agents.filter((agent) => !agent.is_overall), canManageEmployeeAgent: (agent) => Boolean(isCopyTarget(agent) && agent.can_manage === true), openGalleryAgentId: (agents) => agents.find((agent) => agent.is_overall)?.id || '', openGalleryImportSourceOptions: (agents) => agents.filter((agent) => agent.is_overall).map((agent) => ({ value: agent.id, label: agent.name || agent.id })), resourceCreatorName: (row) => String(row.created_by_name || ''), renderMarkdownBlocks: (value) => renderMarkdownBlocks(value), getDateLocale: () => 'zh-CN',
};

function mapKnowledgePath(path: string): string {
  if (path === '/enterprise/knowledge' || path === '/enterprise/knowledge/') return '/knowledge';
  if (path.startsWith('/enterprise/knowledge/')) return `/knowledge/${path.slice('/enterprise/knowledge/'.length)}`;
  return path;
}

export function PilotDeckKnowledgePageProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const context = useMemo(createCopyContext, []);
  const host = useMemo<Host>(() => ({
    ...pilotDeckKnowledgePageHost,
    api: { ...pilotDeckKnowledgePageHost.api,
      get: (path) => callKnowledge(path, 'get', undefined, context),
      post: (path, body) => callKnowledge(path, 'post', body, context),
      put: (path, body) => callKnowledge(path, 'put', body, context),
      delete: (path) => callKnowledge(path, 'delete', undefined, context),
    },
    loadEmployeeDirectory: () => context.loadDirectory(),
    canManageEmployeeAgent: (agent) => Boolean(context.isTarget(agent) && agent.can_manage === true),
    agentScope: { ...pilotDeckKnowledgePageHost.agentScope, read: context.readScope },
  }), [context]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    void context.loadDirectory({ signal: controller.signal }).then(() => { if (mounted) setReady(true); }).catch((cause) => { if (mounted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { mounted = false; controller.abort(); };
  }, [context]);
  if (error) return <div role="alert">{error}</div>;
  if (!ready) return null;
  return <KnowledgePageHostProvider value={{ ...host, tenantId: context.readTenant(), getDateLocale: () => i18n.resolvedLanguage?.startsWith('zh') ? 'zh-CN' : 'en-US', navigate: (path) => navigate(mapKnowledgePath(path)) }}><div className="pilotdeck-knowledge-host">{children}</div></KnowledgePageHostProvider>;
}
