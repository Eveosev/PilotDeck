// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import KnowledgePage from './KnowledgePage';
import SkillsPage from './SkillsPage';
import { DataTable as KnowledgeDataTable } from './KnowledgePageHost';
import { PilotDeckDataTable, PilotDeckResourceImportDialog } from './business-primitives';
import { PilotDeckKnowledgePageProvider, pilotDeckKnowledgePageHost } from './knowledge-host-adapter';
import { PilotDeckSkillsPageProvider, pilotDeckDistillPageHost, pilotDeckSkillsPageHost } from './skills-host-adapter';
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
  it('injects the same complete business primitives into Knowledge and Skills', () => {
    for (const host of [pilotDeckKnowledgePageHost, pilotDeckSkillsPageHost]) {
      expect(host.components?.DataTable).toBe(PilotDeckDataTable);
      expect(host.components?.ResourceImportDialog).toBe(PilotDeckResourceImportDialog);
    }
  });

  it('preserves source, target, checkbox and submit contracts in the copy dialog', () => {
    const onSourceChange = vi.fn();
    const onTargetChange = vi.fn();
    const onSelectedChange = vi.fn();
    const onSubmit = vi.fn();
    const dialog = <PilotDeckResourceImportDialog
      open title="Copy" icon={<span>icon</span>} loading={false}
      targets={[{ value: 'employee-real', label: 'Employee' }]}
      targetId="" targetPlaceholder="Select target" onTargetChange={onTargetChange}
      sources={[{ value: 'plaza-real', label: 'Plaza' }]}
      sourceId="" sourcePlaceholder="Select source" onSourceChange={onSourceChange}
      itemsLabel="Resources" items={[{ id: 'base-real', label: 'Policy' }]}
      selectedIds={[]} onSelectedChange={onSelectedChange}
      emptyText="None" note="Scope note" onClose={vi.fn()} onSubmit={onSubmit}
    />;
    const view = render(React.cloneElement(dialog, { loading: true }));

    expect(screen.getByRole('button', { name: '取消' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '复制' })).toHaveProperty('disabled', true);
    view.rerender(dialog);

    expect(onSourceChange).toHaveBeenCalledWith('plaza-real');
    fireEvent.click(screen.getByRole('combobox', { name: '复制到' }));
    fireEvent.click(screen.getByRole('option', { name: 'Employee' }));
    expect(onTargetChange).toHaveBeenCalledWith('employee-real');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Policy' }));
    expect(onSelectedChange).toHaveBeenCalledWith(['base-real']);
    expect(screen.getByText('Scope note')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('selects desktop Knowledge rows through the default shared table', async () => {
    const onRowClick = vi.fn();
    const copiedBase = { id: 'copied-base', name: 'Copied policy' };
    vi.spyOn(staffDeckCopyClient, 'call').mockResolvedValue(agents as never);
    render(<MemoryRouter><PilotDeckKnowledgePageProvider>
      <KnowledgeDataTable
        aria-label="知识库列表"
        columns={[{ key: 'name', title: '名称', dataIndex: 'name' }]}
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
    const nativeDefinitions = vi.spyOn(staffDeckSopClient, 'listDefinitions');
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
    expect(nativeDefinitions).not.toHaveBeenCalled();
  });

  it('shows missing management capability without reading another SOP owner', async () => {
    vi.spyOn(staffDeckCopyClient, 'call').mockResolvedValue(agents as never);
    const error = Object.assign(new Error('StaffDeck public SOP management is not configured.'), { status: 501 });
    vi.spyOn(staffDeckSopManagementClient, 'call').mockRejectedValue(error);
    const nativeDefinitions = vi.spyOn(staffDeckSopClient, 'listDefinitions');

    render(<MemoryRouter><PilotDeckSkillsPageProvider><SkillsPage currentUser={currentUser} /></PilotDeckSkillsPageProvider></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'StaffDeck public SOP management is not configured.');
    expect(screen.queryByRole('table')).toBeNull();
    expect(nativeDefinitions).not.toHaveBeenCalled();
  });

  it('does not use native definitions for a missing managed SOP or a failed managed save', async () => {
    const missing = vi.spyOn(staffDeckSopClient, 'listDefinitions');
    const nativeSave = vi.spyOn(staffDeckSopClient, 'saveDefinition');
    const error = Object.assign(new Error('StaffDeck public SOP management is not configured.'), { status: 501 });
    vi.spyOn(staffDeckSopManagementClient, 'call').mockImplementation(async (operation) => {
      if (operation === 'list') return { data: [{ id: 'sop-real', skill_id: 'sop-real', content: { name: 'Review' } }] } as never;
      throw error;
    });

    await expect(pilotDeckDistillPageHost.api.get('/api/enterprise/skills/other-sop')).rejects.toThrow('configured management owner');
    await expect(pilotDeckDistillPageHost.api.put('/api/enterprise/skills/sop-real', { name: 'Updated review' })).rejects.toThrow('not configured');
    expect(missing).not.toHaveBeenCalled();
    expect(nativeSave).not.toHaveBeenCalled();
  });

  it('keeps unrelated published SOPs and reads the editable draft through get_draft', async () => {
    const operations: string[] = [];
    vi.spyOn(staffDeckSopManagementClient, 'call').mockImplementation(async (operation) => {
      operations.push(operation);
      if (operation === 'list') return {
        data: [
          { id: 'published-a', skill_id: 'published-a', name: 'Published A', version: '1.0.0', content: { skill_id: 'published-a', name: 'Published A' } },
          { id: 'published-b', skill_id: 'published-b', name: 'Published B', version: '1.0.0', content: { skill_id: 'published-b', name: 'Published B' } },
        ],
        drafts: [
          { id: 'draft-a', sop_id: 'published-a', status: 'draft', draft_version: '1.0.1', etag: 'etag-a', content: { skill_id: 'published-a', name: 'Draft A' } },
          { id: 'historical-b', sop_id: 'published-b', status: 'published', draft_version: '1.0.0', etag: 'stale', content: { skill_id: 'published-b', name: 'Stale Published Draft B' } },
        ],
      } as never;
      if (operation === 'get_draft') return { id: 'draft-a', sop_id: 'published-a', draft_version: '1.0.1', etag: 'etag-current', content: { skill_id: 'published-a', name: 'Current Draft A' } } as never;
      throw new Error(`Unexpected management operation: ${operation}`);
    });
    const nativeDefinitions = vi.spyOn(staffDeckSopClient, 'listDefinitions');

    const rows = await pilotDeckSkillsPageHost.api.get<any[]>('/api/enterprise/skills?tenant_id=pilotdeck-local');
    expect(rows.map((row) => row.skill_id)).toEqual(['published-a', 'published-b']);
    expect(rows[0].name).toBe('Draft A');
    expect(rows[1].name).toBe('Published B');
    expect(rows[1].draft_id).toBeUndefined();

    const published = await pilotDeckDistillPageHost.api.get<any>('/api/enterprise/skills/published-b');
    expect(published.name).toBe('Published B');
    expect(published.draft_id).toBeUndefined();

    const editable = await pilotDeckDistillPageHost.api.get<any>('/api/enterprise/skills/published-a');
    expect(editable.name).toBe('Current Draft A');
    expect(editable.etag).toBe('etag-current');
    expect(operations).toContain('get_draft');
    expect(nativeDefinitions).not.toHaveBeenCalled();
  });
});
