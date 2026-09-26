// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import KnowledgePage from './KnowledgePage';
import SkillsPage from './SkillsPage';
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
