// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolRenderer } from '../components/chat/tools/ToolRenderer';
import { AgentFileArtifactGroup } from '../components/chat-v2/MessageFileCards';
import MessageRowV2 from '../components/chat-v2/MessageRowV2';
import { getPermissionPanel } from '../components/chat/tools/configs/permissionPanelRegistry';
import { activateAssembly, getActiveAssembly, setActiveAssembly } from './runtime';
import type { Assembly } from './contracts';
import { buildSopDefinition, nodeDraftKey, SopPermissionPanel } from './modules/staffdeck-sop';
import { FormalKnowledgeOperations, type KnowledgeModuleClient } from './modules/staffdeck/vendor/KnowledgeOperations';
import { FormalSopManagement, type SopManagementClient } from './modules/staffdeck/vendor/SopManagement';
import KnowledgeGraphCanvas from './modules/staffdeck/vendor/KnowledgeGraphCanvas';
import type { SopDefinition } from './modules/staffdeck/clients';
import { normalizedToChatMessages } from '../components/chat/hooks/useChatMessages';
import type { NormalizedMessage } from '../stores/useSessionStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }) }));

afterEach(() => { cleanup(); setActiveAssembly(null); });

function assembly(overrides: Partial<Assembly> = {}): Assembly {
  return {
    selections: [], pages: [], settings: [], chatExtensions: [], toolRenderers: [], artifactRenderers: [], permissionPanels: [], historyFallbacks: [],
    ...overrides,
  } as Assembly;
}

describe('active composition consumers', () => {
  it('renders custom tool, artifact, and historical fallback contributions', () => {
    const Tool = () => <div>custom tool rendered</div>;
    const Artifact = () => <div>custom artifact rendered</div>;
    const History = () => <div>historical module fallback rendered</div>;
    setActiveAssembly(assembly({
      toolRenderers: [{ id: 'tool', label: 'Tool', toolNames: ['remote_lookup'], component: Tool }],
      artifactRenderers: [{ id: 'artifact', label: 'Artifact', artifactMimeTypes: ['application/x-staffdeck-citation'], component: Artifact }],
      historyFallbacks: [{ moduleId: 'removed.module', contribution: { id: 'history', label: 'History', component: History } }],
    }));
    const view = render(<ToolRenderer toolName="remote_lookup" toolInput={{ q: 'x' }} mode="input" />);
    expect(screen.getByText('custom tool rendered')).toBeTruthy();
    view.unmount();
    render(<AgentFileArtifactGroup project={null} artifacts={[{ id: 'citation', name: 'citation', path: 'citation', mimeType: 'application/x-staffdeck-citation', operation: 'created', source: 'tool', status: 'complete', size: 1, sha256: 'test', createdAt: '2026-01-01T00:00:00Z' }]} />);
    expect(screen.getByText('custom artifact rendered')).toBeTruthy();
    cleanup();
    render(<MessageRowV2 message={{ id: 'old', moduleId: 'removed.module', type: 'assistant', content: 'old', timestamp: '2026-01-01T00:00:00Z' }} prevMessage={null} provider="pilotdeck" selectedProject={null} createDiff={() => []} />);
    expect(screen.getByText('historical module fallback rendered')).toBeTruthy();
  });

  it('registers permission panels and runs lifecycle cleanup', async () => {
    const Panel = () => <div />;
    const init = vi.fn(() => vi.fn());
    const dispose = vi.fn();
    const active = assembly({
      permissionPanels: [{ id: 'approval', label: 'Approval', toolNames: ['operator_approval'], component: Panel }],
      selections: [{ slot: 'sop', binding: { enabled: true }, frontend: { id: 'test.sop', slot: 'sop', contract: 'sop.lifecycle/v2', lifecycle: { init, dispose } } }],
    });
    const stop = activateAssembly(active);
    await Promise.resolve();
    expect(getActiveAssembly()).toBe(active);
    expect(getPermissionPanel('operator_approval')).toBe(Panel);
    expect(init).toHaveBeenCalledOnce();
    stop();
    expect(getPermissionPanel('operator_approval')).toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('keeps runtime-required workflow controls out of chat while the runtime is unavailable', () => {
    const Panel = () => <div />;
    const active = assembly({
      chatExtensions: [{ id: 'sop-wait', label: 'Workflow wait', requiresRuntime: true, component: Panel }],
      permissionPanels: [{ id: 'sop-approval', label: 'Workflow approval', requiresRuntime: true, toolNames: ['operator_approval'], component: Panel }],
    });
    const stop = activateAssembly(active, { modules: {}, gatewayCapabilities: [], gatewayState: 'unavailable', unavailableSlots: [] });
    expect(getActiveAssembly()?.chatExtensions).toEqual([]);
    expect(getPermissionPanel('operator_approval')).toBeNull();
    stop();
    expect(getActiveAssembly()).toBeNull();
  });

  it('keeps the newer active assembly and permission panel when an older assembly disposes', () => {
    const FirstPanel = () => <div />;
    const SecondPanel = () => <div />;
    const first = activateAssembly(assembly({
      permissionPanels: [{ id: 'first', label: 'First', toolNames: ['operator_approval'], component: FirstPanel }],
    }));
    const second = activateAssembly(assembly({
      permissionPanels: [{ id: 'second', label: 'Second', toolNames: ['operator_approval'], component: SecondPanel }],
    }));
    expect(getPermissionPanel('operator_approval')).toBe(SecondPanel);
    first();
    expect(getActiveAssembly()).not.toBeNull();
    expect(getPermissionPanel('operator_approval')).toBe(SecondPanel);
    second();
    expect(getActiveAssembly()).toBeNull();
    expect(getPermissionPanel('operator_approval')).toBeNull();
  });

  it('preserves unedited StaffDeck SOP content and node fields when saving a name-only change', () => {
    const definition: SopDefinition = {
      id: 'complex', name: 'Before', version: '3', metadata: { owner: 'ops' },
      content: {
        start_node_id: 'review', terminal_node_ids: ['finish'],
        edges: [{ source_node_id: 'review', next_node_id: 'finish', conditions: [{ field: 'approved', equals: true }] }],
        nodes: [{ node_id: 'review', type: 'handoff', instruction: 'Review request', retry: { max_attempts: 2 }, input_schema: { fields: ['ticket'] } }, { node_id: 'finish', type: 'terminal', result: { status: 'complete' } }],
      },
    };
    const content = definition.content as Record<string, unknown>;
    const nodes = (content.nodes as Record<string, unknown>[]).map((node, index) => ({
      ...node, _draftKey: nodeDraftKey(node, index), node_id: String(node.node_id), type: String(node.type || 'step'), instruction: typeof node.instruction === 'string' ? node.instruction : '',
    }));
    const saved = buildSopDefinition(definition, { name: 'After', version: '3', startNodeId: 'review', nodes });
    expect(saved).toEqual({ ...definition, name: 'After' });
    expect(JSON.stringify(saved)).not.toContain('_draftKey');
  });

  it('keeps a normalized persisted module message readable without importing its renderer', () => {
    setActiveAssembly(assembly());
    const history: NormalizedMessage[] = [{
      id: 'old', sessionId: 'history-session', provider: 'pilotdeck', kind: 'text', role: 'assistant',
      moduleId: 'removed.module', content: 'old payload', timestamp: '2026-01-01T00:00:00Z',
    }];
    const message = normalizedToChatMessages(history)[0];
    expect(message.moduleId).toBe('removed.module');
    render(<MessageRowV2 message={message} prevMessage={null} provider="pilotdeck" selectedProject={null} createDiff={() => []} />);
    expect(screen.getByTestId('removed-module-history-fallback').textContent).toContain('old payload');
  });

  it('submits SOP approval decisions through the permission callback', async () => {
    const onDecision = vi.fn();
    const view = render(<SopPermissionPanel request={{ requestId: 'approval-1', toolName: 'operator_approval' }} onDecision={onDecision} />);
    screen.getByRole('button', { name: 'sop.approve' }).click();
    expect(onDecision).toHaveBeenCalledWith('approval-1', { allow: true, message: 'sop.approved' });
    screen.getByRole('button', { name: 'sop.reject' }).click();
    expect(onDecision).toHaveBeenCalledWith('approval-1', { allow: false, message: 'sop.rejected' });
    view.unmount();
  });

  it('loads formal Knowledge operations through the public module client', async () => {
    const call = vi.fn(async <T,>(operation: string): Promise<T> => {
      if (operation === 'list_versions') return [{ id: 'v1', version: '1.0.0' }] as T;
      if (operation === 'list_jobs') return [] as T;
      if (operation === 'list_document_buckets') return [] as T;
      if (operation === 'list_okf_concepts') return [] as T;
      if (operation === 'list_discoveries') return [] as T;
      return {} as T;
    });
    const client: KnowledgeModuleClient = { call: call as KnowledgeModuleClient['call'] };
    render(<FormalKnowledgeOperations client={client} knowledgeBaseId="kb-1" documentId="doc-1" />);
    for (const refresh of screen.getAllByRole('button', { name: 'knowledge.refresh' })) refresh.click();
    await waitFor(() => {
      expect(call).toHaveBeenCalledWith('list_versions', { knowledgeBaseId: 'kb-1' });
      expect(call).toHaveBeenCalledWith('list_jobs', { knowledgeBaseId: 'kb-1', limit: 20 });
      expect(call).toHaveBeenCalledWith('list_document_buckets', { documentId: 'doc-1', knowledgeBaseId: 'kb-1' });
      expect(call).toHaveBeenCalledWith('list_okf_concepts', { knowledgeBaseId: 'kb-1' });
      expect(call).toHaveBeenCalledWith('list_discoveries', { knowledgeBaseId: 'kb-1' });
    });
  });

  it('loads and reads formal SOP drafts through the public management client', async () => {
    const call = vi.fn(async <T,>(operation: string): Promise<T> => {
      if (operation === 'list') return { data: [{ skill_id: 'review', name: 'Review', status: 'published' }], drafts: [{ id: 'draft-1', sop_id: 'review', name: 'Review draft', content: { skill_id: 'review', nodes: [] }, etag: 'etag-1' }] } as T;
      if (operation === 'get_draft') return { id: 'draft-1', sop_id: 'review', name: 'Review draft', content: { skill_id: 'review', nodes: [] }, etag: 'etag-1' } as T;
      return {} as T;
    });
    const client: SopManagementClient = { call: call as SopManagementClient['call'] };
    render(<FormalSopManagement client={client} agentId="agent-1" />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('list'));
    screen.getByText('Review draft').click();
    await waitFor(() => expect(call).toHaveBeenCalledWith('get_draft', { sopId: 'review', draftId: 'draft-1' }));
    expect(screen.getByRole('textbox', { name: 'sop.management.definitionJson' })).toBeTruthy();
  });

  it('copies a flat public SOP card into a new draft without dropping its graph', async () => {
    const call = vi.fn(async <T,>(operation: string): Promise<T> => {
      if (operation === 'list') return { data: [{ skill_id: 'review', name: 'Review', status: 'published', nodes: [{ node_id: 'start' }], edges: [], start_node_id: 'start', terminal_node_ids: [] }], drafts: [] } as T;
      if (operation === 'create') return { id: 'draft-copy', sop_id: 'review-copy', content: { skill_id: 'review-copy', nodes: [{ node_id: 'start' }], edges: [] }, etag: 'etag-copy' } as T;
      return {} as T;
    });
    const client: SopManagementClient = { call: call as SopManagementClient['call'] };
    render(<FormalSopManagement client={client} agentId="agent-1" />);
    await waitFor(() => expect(call).toHaveBeenCalledWith('list'));
    screen.getByRole('button', { name: 'sop.management.copy' }).click();
    fireEvent.change(screen.getByRole('textbox', { name: 'sop.management.sopId' }), { target: { value: 'review-copy' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'sop.name' }), { target: { value: 'Review copy' } });
    screen.getByRole('button', { name: 'sop.management.createDraft' }).click();
    await waitFor(() => expect(call).toHaveBeenCalledWith('create', expect.objectContaining({ content: expect.objectContaining({ skill_id: 'review-copy', name: 'Review copy', nodes: [{ node_id: 'start' }] }) })));
  });

  it('renders the mechanically migrated StaffDeck Knowledge graph with public concept data', () => {
    render(<KnowledgeGraphCanvas concepts={[
      { id: 'source', concept_id: 'source', concept_type: 'Source Document', title: 'Handbook', links: [], citations: [] },
      { id: 'topic', concept_id: 'topic', concept_type: 'Topic', title: 'Leave policy', links: [{ target: 'source' }], citations: [] },
    ]} onSelectConcept={vi.fn()} />);
    expect(screen.getByRole('img', { name: '知识图谱画布' })).toBeTruthy();
    expect(screen.getByText('Handbook')).toBeTruthy();
    expect(screen.getByText('Leave policy')).toBeTruthy();
  });

  it('uses host-provided localized labels for the StaffDeck Knowledge graph', () => {
    render(<KnowledgeGraphCanvas concepts={[]} onSelectConcept={vi.fn()} labels={{
      empty: 'No knowledge graph data yet.',
      canvas: 'Knowledge graph canvas',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      reset: 'Reset view',
      fallbackType: 'Concept',
      typeLabels: {},
      sortLocale: 'en',
    }} />);
    expect(screen.getByText('No knowledge graph data yet.')).toBeTruthy();
  });

  it('loads a full OKF concept before editing a projected graph record', async () => {
    const call = vi.fn(async <T,>(operation: string): Promise<T> => {
      if (operation === 'list_okf_concepts') return [{ id: 'concept-row', concept_id: 'policy', title: 'Leave policy', concept_type: 'Topic', links: [], citations: [] }] as T;
      if (operation === 'get_okf_concept') return { id: 'concept-row', concept_id: 'policy', title: 'Leave policy', content_md: '# Full policy\nPreserve this body.', links: [], citations: [] } as T;
      return [] as T;
    });
    const client: KnowledgeModuleClient = { call: call as KnowledgeModuleClient['call'] };
    render(<FormalKnowledgeOperations client={client} knowledgeBaseId="kb-1" />);
    screen.getAllByRole('button', { name: 'knowledge.refresh' })[3].click();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Leave policy' })).toBeTruthy());
    screen.getByRole('button', { name: 'Leave policy' }).click();
    await waitFor(() => expect(call).toHaveBeenCalledWith('get_okf_concept', { knowledgeBaseId: 'kb-1', conceptId: 'policy' }));
    expect((screen.getByRole('textbox', { name: 'knowledge.operations.conceptContent' }) as HTMLTextAreaElement).value).toContain('Preserve this body.');
  });
});
