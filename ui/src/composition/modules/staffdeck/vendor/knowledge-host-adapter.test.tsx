import { describe, expect, it } from 'vitest';
import { pilotDeckKnowledgePageHost } from './knowledge-host-adapter';
import { pilotDeckSkillsPageHost } from './skills-host-adapter';
import { staffDeckCopyClient, staffDeckKnowledgeClient } from '../clients';

describe('PilotDeck Knowledge host authorization boundary', () => {
  it('dispatches a complete scoped concept ID and exact body/response without updating the base', async () => {
    const original = staffDeckKnowledgeClient.call;
    const calls: any[] = [];
    const concept = { id: 'row', concept_id: 'rules/中文', content_md: 'title-only edit', source_refs: [{ document_id: 'doc' }] };
    staffDeckKnowledgeClient.call = async (operation, input) => { calls.push({ operation, input }); return concept as any; };
    try {
      const path = '/api/enterprise/knowledge-bases/base%20id/okf/concepts/rules/%E4%B8%AD%E6%96%87?agent_id=actual-target';
      expect(await pilotDeckKnowledgePageHost.api.put(path, { tenant_id: 'actual-tenant', document_id: 'doc', content_md: 'title-only edit', status: 'active' })).toBe(concept);
      expect(calls[0]).toEqual({ operation: 'upsert_okf_concept', input: { knowledgeBaseId: 'base id', conceptId: 'rules/中文', agentId: 'actual-target', tenantId: 'actual-tenant', documentId: 'doc', contentMd: 'title-only edit', status: 'active' } });
      expect(await pilotDeckKnowledgePageHost.api.get(path + '&tenant_id=actual-tenant')).toBe(concept);
      expect(calls[1]).toEqual({ operation: 'get_okf_concept', input: { knowledgeBaseId: 'base id', conceptId: 'rules/中文', agentId: 'actual-target', tenantId: 'actual-tenant' } });
      await expect(pilotDeckKnowledgePageHost.api.delete!(path)).rejects.toThrow('Unsupported');
      await expect(pilotDeckKnowledgePageHost.api.put('/api/enterprise/knowledge-bases/base/unknown', {})).rejects.toThrow('Unsupported');
      expect(calls).toHaveLength(2);
    } finally { staffDeckKnowledgeClient.call = original; }
  });
  it('does not grant overall administration to an authenticated non-admin user', () => {
    expect(pilotDeckKnowledgePageHost.isEnterpriseAdmin({ id: 'user-1', is_admin: false })).toBe(false);
    expect(pilotDeckKnowledgePageHost.canManageEmployeeAgent({ id: 'agent-1' }, { id: 'user-1', is_admin: false })).toBe(false);
  });

  it('uses the explicit single-user/admin identity supplied by the host', () => {
    expect(pilotDeckKnowledgePageHost.isEnterpriseAdmin({ id: 'user-1', is_admin: true })).toBe(true);
    expect(pilotDeckKnowledgePageHost.canManageEmployeeAgent({ id: 'agent-1' }, { id: 'user-1', is_admin: true })).toBe(false);
  });

  it('loads actual overall and target identities from the formal copy directory', async () => {
    const originalCall = staffDeckCopyClient.call;
    staffDeckCopyClient.call = async () => [
      { id: 'employee-real', name: 'Employee', is_overall: false, active: true, copy_target: true, can_manage: true },
      { id: 'plaza-real', name: 'Plaza', is_overall: true, active: true, copy_target: false },
    ] as any;
    try {
      expect((await pilotDeckKnowledgePageHost.loadEmployeeDirectory()).map((agent) => agent.id)).toEqual(['employee-real', 'plaza-real']);
      expect(pilotDeckKnowledgePageHost.openGalleryAgentId(await pilotDeckKnowledgePageHost.loadEmployeeDirectory())).toBe('plaza-real');
      expect(pilotDeckKnowledgePageHost.canManageEmployeeAgent({ id: 'plaza-real' }, { is_admin: true })).toBe(false);
      expect(pilotDeckKnowledgePageHost.canManageEmployeeAgent({ id: 'employee-real', can_manage: true })).toBe(true);
      expect(pilotDeckKnowledgePageHost.canManageEmployeeAgent({ id: 'employee-real', can_manage: false }, { is_admin: true })).toBe(false);
    } finally { staffDeckCopyClient.call = originalCall; }
  });

  it('maps both shared plaza pages to scoped source reads and formal resource imports', async () => {
    const originalCall = staffDeckCopyClient.call;
    const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
    staffDeckCopyClient.call = async (operation, input = {}) => {
      calls.push({ operation, input });
      return [] as any;
    };
    window.localStorage.setItem('ultrarag_enterprise_agent_scope', 'employee-real');
    try {
      await pilotDeckKnowledgePageHost.api.get('/api/enterprise/knowledge-bases?tenant_id=forged&agent_id=plaza-real');
      await pilotDeckSkillsPageHost.api.get('/api/enterprise/agents/plaza-real/skills?tenant_id=forged');
      await pilotDeckKnowledgePageHost.api.post('/api/enterprise/agents/employee-real/resources/import', { source_agent_id: 'plaza-real', resource_type: 'knowledge_base', resource_ids: ['base-real'], tenant_id: 'forged' });
      await pilotDeckSkillsPageHost.api.post('/api/enterprise/agents/employee-real/resources/import', { source_agent_id: 'plaza-real', resource_type: 'skill', resource_ids: ['sop-real'], tenant_id: 'forged' });
      expect(calls).toEqual([
        { operation: 'list_knowledge_bases', input: { sourceAgentId: 'plaza-real' } },
        { operation: 'list_skills', input: { sourceAgentId: 'plaza-real' } },
        { operation: 'import_resources', input: { targetAgentId: 'employee-real', sourceAgentId: 'plaza-real', resourceType: 'knowledge_base', resourceIds: ['base-real'] } },
        { operation: 'import_resources', input: { targetAgentId: 'employee-real', sourceAgentId: 'plaza-real', resourceType: 'skill', resourceIds: ['sop-real'] } },
      ]);
    } finally { staffDeckCopyClient.call = originalCall; window.localStorage.removeItem('ultrarag_enterprise_agent_scope'); }
  });

  it('resolves plaza copy only from an actual overall agent in either shared page', () => {
    const employee = { id: 'employee-1', is_overall: false };
    const overall = { id: 'overall-actual', is_overall: true };
    for (const host of [pilotDeckKnowledgePageHost, pilotDeckSkillsPageHost]) {
      expect(host.openGalleryAgentId([employee])).toBe('');
      expect(host.openGalleryAgentId([employee, overall])).toBe(overall.id);
      expect(host.openGalleryImportSourceOptions([employee, overall], '开放广场')).toEqual([
        { value: overall.id, label: overall.id },
      ]);
    }
  });
});

describe('PilotDeck Knowledge host protocol mapping', () => {
  it('maps every formal Knowledge page operation without bypassing the StaffDeck protocol', async () => {
    const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
    const originalCall = staffDeckKnowledgeClient.call;
    staffDeckKnowledgeClient.call = async function <T>(operation: string, input: Record<string, unknown> = {}) {
      calls.push({ operation, input });
      return {} as T;
    };

    const cases: Array<{
      method: 'get' | 'post' | 'put' | 'delete';
      path: string;
      body?: Record<string, unknown>;
      operation: string;
      input: Record<string, unknown>;
    }> = [
      { method: 'get', path: '/api/enterprise/knowledge-bases', operation: 'list_bases', input: {} },
      { method: 'post', path: '/api/enterprise/knowledge-bases', body: { name: 'G4', description: 'fixture' }, operation: 'create_base', input: { name: 'G4', description: 'fixture' } },
      { method: 'get', path: '/api/enterprise/knowledge/documents?knowledge_base_id=base-1', operation: 'list_documents', input: { knowledgeBaseId: 'base-1' } },
      { method: 'post', path: '/api/enterprise/knowledge/documents', body: { knowledgeBaseId: 'base-1', title: 'Policy' }, operation: 'import_document', input: { knowledgeBaseId: 'base-1', title: 'Policy' } },
      { method: 'get', path: '/api/enterprise/knowledge/documents/doc-1', operation: 'get_document', input: { documentId: 'doc-1' } },
      { method: 'put', path: '/api/enterprise/knowledge/documents/doc-1', body: { title: 'Updated' }, operation: 'update_document', input: { documentId: 'doc-1', title: 'Updated' } },
      { method: 'delete', path: '/api/enterprise/knowledge/documents/doc-1', operation: 'delete_document', input: { documentId: 'doc-1' } },
      { method: 'get', path: '/api/enterprise/knowledge-bases/base-1/versions', operation: 'list_versions', input: { knowledgeBaseId: 'base-1' } },
      { method: 'post', path: '/api/enterprise/knowledge-bases/base-1/sync-from-overall?agent_id=agent-1', operation: 'sync_base', input: { knowledgeBaseId: 'base-1', agentId: 'agent-1' } },
      { method: 'post', path: '/api/enterprise/knowledge-bases/base-1/promote-to-overall?agent_id=agent-1', operation: 'publish_version', input: { knowledgeBaseId: 'base-1', agentId: 'agent-1' } },
      { method: 'post', path: '/api/enterprise/knowledge-bases/base-1/rollback', body: { version: 2 }, operation: 'rollback_version', input: { knowledgeBaseId: 'base-1', version: 2 } },
      { method: 'get', path: '/api/enterprise/knowledge-bases/base-1/okf/concepts', operation: 'list_okf_concepts', input: { knowledgeBaseId: 'base-1' } },
      { method: 'get', path: '/api/enterprise/knowledge-bases/base-1/okf/export', operation: 'export_okf', input: { knowledgeBaseId: 'base-1' } },
      { method: 'post', path: '/api/enterprise/knowledge-bases/base-1/okf/lint', body: { strict: true }, operation: 'lint_okf', input: { knowledgeBaseId: 'base-1', strict: true } },
      { method: 'put', path: '/api/enterprise/knowledge-bases/base-1', body: { description: 'kept' }, operation: 'update_base', input: { knowledgeBaseId: 'base-1', description: 'kept' } },
      { method: 'delete', path: '/api/enterprise/knowledge-bases/base-1', operation: 'delete_base', input: { knowledgeBaseId: 'base-1' } },
      { method: 'post', path: '/api/enterprise/knowledge/search', body: { query: 'approval', knowledgeBaseIds: ['base-1'] }, operation: 'query', input: { query: 'approval', knowledgeBaseIds: ['base-1'] } },
      { method: 'post', path: '/api/enterprise/knowledge/okf/import', body: { knowledgeBaseId: 'base-1', archive: 'fixture' }, operation: 'import_okf', input: { knowledgeBaseId: 'base-1', archive: 'fixture' } },
      { method: 'get', path: '/api/enterprise/knowledge/documents/doc-1/buckets?knowledge_base_id=base-1', operation: 'list_document_buckets', input: { documentId: 'doc-1', knowledgeBaseId: 'base-1' } },
      { method: 'get', path: '/api/enterprise/knowledge/buckets/bucket-1/chunks', operation: 'list_bucket_chunks', input: { bucketId: 'bucket-1' } },
      { method: 'put', path: '/api/enterprise/knowledge/buckets/bucket-1', body: { title: 'Section' }, operation: 'update_bucket', input: { bucketId: 'bucket-1', title: 'Section' } },
      { method: 'put', path: '/api/enterprise/knowledge/chunks/chunk-1', body: { content: 'changed', summary: 'kept' }, operation: 'update_chunk', input: { chunkId: 'chunk-1', content: 'changed', summary: 'kept' } },
      { method: 'get', path: '/api/enterprise/knowledge/citations/chunk-1', operation: 'resolve_citation', input: { chunkId: 'chunk-1' } },
      { method: 'get', path: '/api/enterprise/knowledge/jobs?limit=8', operation: 'list_jobs', input: { limit: 8 } },
      { method: 'get', path: '/api/enterprise/knowledge/jobs/job-1', operation: 'get_job', input: { jobId: 'job-1' } },
      { method: 'get', path: '/api/enterprise/knowledge/jobs/job%2F1', operation: 'get_job', input: { jobId: 'job/1' } },
      { method: 'get', path: '/api/enterprise/knowledge/jobs/job%E0%A4%A', operation: 'get_job', input: { jobId: 'job%E0%A4%A' } },
      { method: 'post', path: '/api/enterprise/knowledge/jobs/job-1/cancel', operation: 'cancel_job', input: { jobId: 'job-1' } },
      { method: 'get', path: '/api/enterprise/knowledge/discoveries', operation: 'list_discoveries', input: {} },
      { method: 'post', path: '/api/enterprise/knowledge/discoveries/discovery-1/confirm', operation: 'confirm_discovery', input: { suggestionId: 'discovery-1' } },
      { method: 'post', path: '/api/enterprise/knowledge/discoveries/suggestion%2F5/confirm', operation: 'confirm_discovery', input: { suggestionId: 'suggestion/5' } },
      { method: 'post', path: '/api/enterprise/knowledge/discoveries/suggestion%E0%A4%A/reject', operation: 'reject_discovery', input: { suggestionId: 'suggestion%E0%A4%A' } },
      { method: 'post', path: '/api/enterprise/knowledge/discoveries/discovery-1/reject', operation: 'reject_discovery', input: { suggestionId: 'discovery-1' } },
    ];

    try {
      for (const testCase of cases) {
        if (testCase.method === 'get' || testCase.method === 'delete') {
          await pilotDeckKnowledgePageHost.api[testCase.method](testCase.path);
        } else {
          await pilotDeckKnowledgePageHost.api[testCase.method](testCase.path, testCase.body);
        }
      }
    } finally {
      staffDeckKnowledgeClient.call = originalCall;
    }

    expect(calls).toEqual(cases.map(({ operation, input }) => ({ operation, input })));
    await expect(pilotDeckKnowledgePageHost.api.get('/api/enterprise/knowledge/unsupported')).rejects.toThrow('Unsupported StaffDeck Knowledge path');
  });
});
