import { describe, expect, it } from 'vitest';
import { pilotDeckKnowledgePageHost } from './knowledge-host-adapter';
import { staffDeckKnowledgeClient } from '../clients';

describe('PilotDeck Knowledge host authorization boundary', () => {
  it('does not grant overall administration to an authenticated non-admin user', () => {
    expect(pilotDeckKnowledgePageHost.isEnterpriseAdmin({ id: 'user-1', is_admin: false })).toBe(false);
    expect(pilotDeckKnowledgePageHost.canManageEmployeeAgent({ id: 'agent-1' }, { id: 'user-1', is_admin: false })).toBe(false);
  });

  it('uses the explicit single-user/admin identity supplied by the host', () => {
    expect(pilotDeckKnowledgePageHost.isEnterpriseAdmin({ id: 'user-1', is_admin: true })).toBe(true);
    expect(pilotDeckKnowledgePageHost.canManageEmployeeAgent({ id: 'agent-1' }, { id: 'user-1', is_admin: true })).toBe(true);
  });

  it('does not invent an employee directory when the module has no directory capability', async () => {
    await expect(pilotDeckKnowledgePageHost.loadEmployeeDirectory()).resolves.toEqual([]);
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
      { method: 'post', path: '/api/enterprise/knowledge/jobs/job-1/cancel', operation: 'cancel_job', input: { jobId: 'job-1' } },
      { method: 'get', path: '/api/enterprise/knowledge/discoveries', operation: 'list_discoveries', input: {} },
      { method: 'post', path: '/api/enterprise/knowledge/discoveries/discovery-1/confirm', operation: 'confirm_discovery', input: { suggestionId: 'discovery-1' } },
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
