// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import KnowledgePage from './KnowledgePage';
import SkillsPage from './SkillsPage';
import { DataTable as KnowledgeDataTable } from './KnowledgePageHost';
import { PilotDeckKnowledgePageProvider } from './knowledge-host-adapter';
import { PilotDeckSkillsPageProvider } from './skills-host-adapter';
import { staffDeckCopyClient, staffDeckKnowledgeClient, staffDeckSopClient, staffDeckSopManagementClient } from '../clients';

const agents = [
  { id: 'employee-real', name: 'Employee', is_overall: false, active: true, copy_target: true, can_manage: true },
  { id: 'plaza-real', name: 'Plaza', is_overall: true, active: true, copy_target: false, can_manage: false },
];
const currentUser = { id: 'pd-user', username: 'operator', is_admin: false };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.removeItem('ultrarag_enterprise_agent_scope');
});

describe('PilotDeck shared plaza pages', () => {
  it('selects desktop Knowledge rows through the default shared table', async () => {
    const onRowClick = vi.fn();
    const copiedBase = { id: 'copied-base', name: 'Copied policy' };
    vi.spyOn(staffDeckCopyClient, 'call').mockResolvedValue(agents as never);
    render(<MemoryRouter><PilotDeckKnowledgePageProvider>
      <KnowledgeDataTable
        aria-label="知识库列表"
        columns={[{ key: 'name', title: '名称' }]}
        data={[copiedBase]}
        rowKey={(row: typeof copiedBase) => row.id}
        onRowClick={onRowClick}
      />
    </PilotDeckKnowledgePageProvider></MemoryRouter>);

    fireEvent.click(await screen.findByRole('row', { name: 'Copied policy' }));
    expect(onRowClick).toHaveBeenCalledExactlyOnceWith(copiedBase, 0);
  });

  it('loads a newly copied Knowledge document on its first desktop row click', async () => {
    const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
    vi.spyOn(staffDeckCopyClient, 'call').mockResolvedValue(agents as never);
    vi.spyOn(staffDeckKnowledgeClient, 'call').mockImplementation(async (operation, input = {}) => {
      calls.push({ operation, input });
      if (operation === 'list_bases') return [
        { id: 'old-base', name: 'Existing guide', status: 'active' },
        { id: 'copied-base', name: 'Copied policy', status: 'active' },
      ] as never;
      if (operation === 'list_documents') return [
        { id: 'old-document', knowledge_base_id: 'old-base', filename: 'old.md', title: 'Existing guide' },
        { id: 'copied-document', knowledge_base_id: 'copied-base', filename: 'copied.md', title: 'Copied policy' },
      ] as never;
      return [] as never;
    });
    render(<MemoryRouter><PilotDeckKnowledgePageProvider><KnowledgePage currentUser={currentUser} /></PilotDeckKnowledgePageProvider></MemoryRouter>);

    const table = await screen.findByRole('table', { name: '知识库列表' });
    fireEvent.click(await within(table).findByRole('row', { name: /Copied policy/ }));
    await waitFor(() => expect(calls).toContainEqual({
      operation: 'list_document_buckets',
      input: { agentId: 'employee-real', documentId: 'copied-document', tenantId: 'tenant_demo' },
    }));
    expect(calls).toContainEqual({
      operation: 'list_okf_concepts',
      input: { agentId: 'employee-real', knowledgeBaseId: 'copied-base', tenantId: 'tenant_demo' },
    });
  });

  it('selects a real Knowledge base and submits a scoped copy request', async () => {
    const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
    vi.spyOn(staffDeckCopyClient, 'call').mockImplementation(async (operation, input = {}) => {
      calls.push({ operation, input });
      if (operation === 'list_agents') return agents as any;
      if (operation === 'list_knowledge_bases') return [{ id: 'base-real', name: 'Policy', status: 'active' }] as any;
      if (operation === 'import_resources') return { imported: [{ id: 'base-real' }], missing: [] } as any;
      throw new Error(`Unexpected copy operation: ${operation}`);
    });
    vi.spyOn(staffDeckKnowledgeClient, 'call').mockResolvedValue([] as never);
    render(<MemoryRouter><PilotDeckKnowledgePageProvider><KnowledgePage currentUser={currentUser} /></PilotDeckKnowledgePageProvider></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: /新增/ }));
    fireEvent.click(await screen.findByText('从广场复制'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByText('Policy'));
    fireEvent.click(within(dialog).getByRole('button', { name: /复制|确认/ }));
    expect(calls).toContainEqual({ operation: 'list_knowledge_bases', input: { sourceAgentId: 'plaza-real' } });
    await waitFor(() => expect(calls).toContainEqual({ operation: 'import_resources', input: {
      targetAgentId: 'employee-real', sourceAgentId: 'plaza-real', resourceType: 'knowledge_base', resourceIds: ['base-real'],
    } }));
  });

  it('selects a published SOP and submits a scoped copy request', async () => {
    const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
    vi.spyOn(staffDeckCopyClient, 'call').mockImplementation(async (operation, input = {}) => {
      calls.push({ operation, input });
      if (operation === 'list_agents') return agents as any;
      if (operation === 'list_skills') return [{ id: 'sop-real', skill_id: 'sop-real', name: 'Review', version: '1.0.0', status: 'published', updated_at: '2026-09-27' }] as any;
      if (operation === 'import_resources') return { imported: [{ id: 'sop-real' }], missing: [] } as any;
      throw new Error(`Unexpected copy operation: ${operation}`);
    });
    vi.spyOn(staffDeckSopManagementClient, 'call').mockResolvedValue({ data: [] } as never);
    vi.spyOn(staffDeckSopClient, 'listDefinitions').mockResolvedValue({ defaultSopId: '', definitions: [] });
    render(<MemoryRouter><PilotDeckSkillsPageProvider><SkillsPage currentUser={currentUser} /></PilotDeckSkillsPageProvider></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: /新增/ }));
    fireEvent.click(await screen.findByText('从广场复制'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByText('Review'));
    fireEvent.click(within(dialog).getByRole('button', { name: /复制|确认/ }));
    expect(calls).toContainEqual({ operation: 'list_skills', input: { sourceAgentId: 'plaza-real' } });
    await waitFor(() => expect(calls).toContainEqual({ operation: 'import_resources', input: {
      targetAgentId: 'employee-real', sourceAgentId: 'plaza-real', resourceType: 'skill', resourceIds: ['sop-real'],
    } }));
  });
});
