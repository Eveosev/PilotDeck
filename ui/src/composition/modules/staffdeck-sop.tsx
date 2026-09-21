import SopWaitBanner from '../../components/chat-v2/SopWaitBanner';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDot, FileCode2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import type { FrontendModule, SurfaceProps } from '../contracts';
import { ProfileTextSetting } from './shared';
import { staffDeckSopClient, type SopDefinition } from './staffdeck/clients';
import SopVersionDetailDialog, { type StaffDeckSopVersion } from './staffdeck/vendor/SopVersionDetailDialog';

const BUILD_MARKER = 'staffdeck.sop.ui/v1';
export type SopNode = Record<string, unknown> & { _draftKey: string; node_id: string; type?: string; instruction?: string };

export function nodeDraftKey(node: Record<string, unknown>, index: number): string {
  return `node-${index}-${textOf(node.node_id) || 'unnamed'}`;
}

type SopDefinitionDraft = {
  name: string;
  version: string;
  startNodeId: string;
  nodes: SopNode[];
};

/**
 * The concise form intentionally edits only the fields it renders. Keep all
 * other StaffDeck node and content fields intact when serializing the YAML.
 */
export function buildSopDefinition(selected: SopDefinition, draft: SopDefinitionDraft): SopDefinition {
  const priorContent = isRecord(selected.content) ? selected.content : {};
  const originalNodes = Array.isArray(priorContent.nodes) ? priorContent.nodes.filter(isRecord) : [];
  const originalByDraftKey = new Map(originalNodes.map((node, index) => [nodeDraftKey(node, index), node]));
  const nodes = draft.nodes.map((node) => {
    const original = originalByDraftKey.get(node._draftKey);
    const nodeId = node.node_id.trim();
    if (original && textOf(original.node_id) !== nodeId) {
      throw new Error('sop.nodeIdRenameForbidden');
    }
    const { _draftKey: _ignored, ...definitionNode } = node;
    if (original && !Object.prototype.hasOwnProperty.call(original, 'instruction') && node.instruction === '') {
      delete definitionNode.instruction;
    }
    if (original && !Object.prototype.hasOwnProperty.call(original, 'type') && node.type === 'step') {
      delete definitionNode.type;
    }
    return { ...definitionNode, node_id: nodeId };
  });
  return {
    ...selected,
    name: draft.name.trim(),
    version: draft.version.trim() || '1',
    content: {
      ...priorContent,
      start_node_id: draft.startNodeId.trim() || nodes[0]?.node_id || '',
      nodes,
    },
  };
}

function SopPage({ sessionId, projectKey }: SurfaceProps) {
  const { t } = useTranslation('staffdeck');
  const [definitions, setDefinitions] = useState<SopDefinition[]>([]);
  const [defaultSopId, setDefaultSopId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1');
  const [startNodeId, setStartNodeId] = useState('');
  const [nodes, setNodes] = useState<SopNode[]>([]);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [versionDetailOpen, setVersionDetailOpen] = useState(false);
  const selected = useMemo(() => definitions.find((definition) => definition.id === selectedId) ?? null, [definitions, selectedId]);

  const loadDefinitions = async () => {
    setLoading(true); setMessage(null);
    try {
      const next = await staffDeckSopClient.listDefinitions();
      setDefinitions(next.definitions); setDefaultSopId(next.defaultSopId);
      setSelectedId((current) => current || next.defaultSopId || next.definitions[0]?.id || '');
    } catch (cause) { setMessage(messageOf(cause)); }
    finally { setLoading(false); }
  };

  const loadStatus = async () => {
    if (!sessionId) { setStatus(null); return; }
    try { setStatus(await staffDeckSopClient.status(sessionId, projectKey)); }
    catch (cause) { setMessage(messageOf(cause)); }
  };

  useEffect(() => { void loadDefinitions(); }, []);
  useEffect(() => {
    const content = isRecord(selected?.content) ? selected.content : {};
    setName(textOf(selected?.name) || '');
    setVersion(textOf(selected?.version) || '1');
    setStartNodeId(textOf(content.start_node_id) || '');
    setNodes(Array.isArray(content.nodes) ? content.nodes.filter(isRecord).map((node, index) => ({
      ...node, _draftKey: nodeDraftKey(node, index), node_id: textOf(node.node_id) || '', type: textOf(node.type) || 'step', instruction: textOf(node.instruction) || '',
    })) : []);
  }, [selected]);
  useEffect(() => { void loadStatus(); }, [sessionId, projectKey]);

  const save = async () => {
    if (!selected || saving) return;
    if (!name.trim() || nodes.some((node) => !node.node_id.trim())) {
      setMessage(t('sop.missingFields'));
      return;
    }
    let definition: SopDefinition;
    try { definition = buildSopDefinition(selected, { name, version, startNodeId, nodes }); }
    catch (cause) {
      setMessage(messageOf(cause) === 'sop.nodeIdRenameForbidden' ? t('sop.nodeIdRenameForbidden') : messageOf(cause));
      return;
    }
    setSaving(true); setMessage(null);
    let saved = false;
    try {
      await staffDeckSopClient.saveDefinition(selected.id, definition);
      saved = true;
      setMessage(t('sop.restarting'));
      await staffDeckSopClient.restartRuntime();
    } catch (cause) { setMessage(saved ? t('sop.restartFailed', { message: messageOf(cause) }) : messageOf(cause)); }
    finally { setSaving(false); }
  };

  const runtimeState = isRecord(status?.state) ? status.state : null;
  const selectedVersion: StaffDeckSopVersion | null = selected ? {
    id: selected.id,
    name: textOf(selected.name) || selected.id,
    version: textOf(selected.version) || '1',
    business_domain: textOf(selected.business_domain),
    status: textOf(selected.status),
    updated_at: textOf(selected.updated_at) || new Date().toISOString(),
    content: selected.content,
  } : null;
  return <main className="h-full overflow-y-auto bg-neutral-50 p-6 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="staffdeck-sop-workspace">
    <div className="mx-auto flex max-w-6xl justify-end px-6 pt-4"><button type="button" onClick={() => setVersionDetailOpen(true)} disabled={!selected} className="rounded border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700">{t('sop.versionDetails')}</button></div>
    <SopVersionDetailDialog detail={versionDetailOpen ? selectedVersion : null} onClose={() => setVersionDetailOpen(false)} />
    <span className="sr-only" data-module-build-marker={BUILD_MARKER} />
    <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><FileCode2 className="h-4 w-4 text-violet-600" /><h2 className="text-sm font-semibold">{t('sop.definitions')}</h2></div><button type="button" aria-label={t('sop.refreshDefinitions')} onClick={() => void loadDefinitions()} className="rounded p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div><div className="mt-4 space-y-1">{definitions.map((definition) => <button key={definition.id} type="button" onClick={() => setSelectedId(definition.id)} className={`w-full rounded px-2 py-2 text-left text-sm ${definition.id === selectedId ? 'bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-200' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}><span className="block truncate font-medium">{textOf(definition.name) || definition.id}</span><span className="block text-xs text-neutral-500">{definition.id === defaultSopId ? t('sop.defaultWorkflow') : t('sop.version', { version: textOf(definition.version) || '1' })}</span></button>)}</div></aside>
      <section className="min-w-0 space-y-5"><header><div className="flex items-center gap-2"><CircleDot className="h-5 w-5 text-violet-600" /><h1 className="text-xl font-semibold">{textOf(selected?.name) || t('sop.workflow')}</h1></div><p className="mt-1 text-sm text-neutral-500">{t('sop.description')}</p></header>
        {message ? <p role={message === t('sop.restarting') ? 'status' : 'alert'} className={`rounded border px-3 py-2 text-sm ${message === t('sop.restarting') ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'}`}>{message}</p> : null}
        <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{t('sop.details')}</h2><button type="button" onClick={() => void save()} disabled={!selected || saving} className="inline-flex items-center gap-2 rounded bg-violet-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Save className="h-4 w-4" />{t('sop.saveAndRestart')}</button></div><div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]"><label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('sop.name')}<input aria-label={t('sop.name')} value={name} onChange={(event) => setName(event.target.value)} disabled={!selected} className="mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm font-normal dark:border-neutral-700 dark:bg-neutral-950" /></label><label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('sop.version', { version: '' }).trim()}<input aria-label={t('sop.version', { version: '' }).trim()} value={version} onChange={(event) => setVersion(event.target.value)} disabled={!selected} className="mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm font-normal dark:border-neutral-700 dark:bg-neutral-950" /></label></div><label className="mt-3 block text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('sop.startNode')}<input aria-label={t('sop.startNode')} value={startNodeId} onChange={(event) => setStartNodeId(event.target.value)} disabled={!selected} className="mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm font-normal dark:border-neutral-700 dark:bg-neutral-950" /></label><div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{t('sop.nodes')}</h3><button type="button" onClick={() => setNodes((current) => [...current, { _draftKey: `new-node-${Date.now()}-${current.length}`, node_id: '', type: 'step', instruction: '' }])} disabled={!selected} className="inline-flex items-center gap-1.5 rounded border border-neutral-300 px-2.5 py-1.5 text-sm dark:border-neutral-700"><Plus className="h-4 w-4" />{t('sop.addNode')}</button></div><div className="mt-3 space-y-3">{nodes.map((node, index) => <article key={node._draftKey} className="rounded border border-neutral-200 p-3 dark:border-neutral-700"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_auto]"><label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('sop.nodeId')}<input aria-label={t('sop.nodeIdLabel', { index: index + 1 })} value={node.node_id} onChange={(event) => setNodes((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, node_id: event.target.value } : item))} className="mt-1 w-full rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-sm font-normal dark:border-neutral-700 dark:bg-neutral-950" /></label><label className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('sop.type')}<select aria-label={t('sop.nodeTypeLabel', { index: index + 1 })} value={node.type || 'step'} onChange={(event) => setNodes((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item))} className="mt-1 w-full rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-sm font-normal dark:border-neutral-700 dark:bg-neutral-950"><option value="step">{t('sop.step')}</option><option value="handoff">{t('sop.handoff')}</option></select></label><button type="button" aria-label={t('sop.removeNode', { index: index + 1 })} onClick={() => setNodes((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="self-end rounded p-2 text-neutral-500 hover:bg-neutral-100 hover:text-red-600 dark:hover:bg-neutral-800"><Trash2 className="h-4 w-4" /></button></div><label className="mt-3 block text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('sop.instruction')}<textarea aria-label={t('sop.nodeInstructionLabel', { index: index + 1 })} value={node.instruction || ''} onChange={(event) => setNodes((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, instruction: event.target.value } : item))} className="mt-1 min-h-20 w-full resize-y rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-sm font-normal dark:border-neutral-700 dark:bg-neutral-950" /></label></article>)}</div></div><p className="mt-3 text-xs text-neutral-500">{t('sop.restartNotice')}</p></section>
        <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"><h2 className="text-sm font-semibold">{t('sop.graph')}</h2><div className="mt-3 grid gap-2 md:grid-cols-2">{nodes.map((node, index) => <article key={node._draftKey} className="rounded border border-neutral-200 p-3 text-sm dark:border-neutral-700"><p className="font-medium">{textOf(isRecord(node) ? node.node_id : undefined) || `${t('sop.step')} ${index + 1}`}</p><p className="mt-1 text-xs text-violet-700 dark:text-violet-300">{node.type === 'handoff' ? t('sop.handoff') : node.type === 'step' || !node.type ? t('sop.step') : node.type}</p><p className="mt-2 text-xs leading-5 text-neutral-600 dark:text-neutral-300">{textOf(isRecord(node) ? node.instruction : undefined) || t('sop.noInstruction')}</p></article>)}{selected && nodes.length === 0 ? <p className="text-sm text-neutral-500">{t('sop.noNodes')}</p> : null}</div></section>
        <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{t('sop.currentSession')}</h2><button type="button" onClick={() => void loadStatus()} disabled={!sessionId} className="rounded border border-neutral-300 px-2.5 py-1.5 text-sm dark:border-neutral-700">{t('sop.refreshState')}</button></div>{sessionId ? <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-xs text-neutral-500">{t('sop.session')}</dt><dd className="mt-1 break-all font-medium">{sessionId}</dd></div><div><dt className="text-xs text-neutral-500">{t('sop.workflow')}</dt><dd className="mt-1 font-medium">{textOf(runtimeState?.selected_skill_id) || textOf(runtimeState?.active_skill_id) || t('sop.notStarted')}</dd></div><div><dt className="text-xs text-neutral-500">{t('sop.status')}</dt><dd className="mt-1 font-medium">{textOf(runtimeState?.status) || t('sop.noActiveState')}</dd></div></dl> : <p className="mt-3 text-sm text-neutral-500">{t('sop.selectConversation')}</p>}</section>
      </section>
    </div>
  </main>;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function textOf(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined; }
function messageOf(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }

function SopExtension({ sessionId, projectKey = 'general', refreshKey, disabled, onPrepared, onError }: SurfaceProps) {
  return <SopWaitBanner
    sessionKey={sessionId ?? ''}
    projectKey={projectKey}
    refreshKey={refreshKey ?? sessionId ?? ''}
    disabled={disabled}
    onPrepared={onPrepared ?? (() => {})}
    onError={onError ?? (() => {})}
  />;
}

export function SopPermissionPanel(props: SurfaceProps) {
  const { t } = useTranslation('staffdeck');
  const request = props.request ?? props.permissionRequest as { requestId?: string; toolName?: string } | undefined;
  const decide = (allow: boolean) => {
    if (!request?.requestId || !props.onDecision) return;
    props.onDecision(request.requestId, { allow, message: allow ? t('sop.approved') : t('sop.rejected') });
  };
  return <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
    <p>{t('sop.approvalRequested', { toolName: request?.toolName ?? t('sop.defaultApproval') })}</p>
    <div className="mt-2 flex gap-2">
      <button type="button" className="rounded bg-amber-700 px-2 py-1 text-white disabled:opacity-50" disabled={!request?.requestId || !props.onDecision} onClick={() => decide(true)}>{t('sop.approve')}</button>
      <button type="button" className="rounded border border-amber-700 px-2 py-1 disabled:opacity-50" disabled={!request?.requestId || !props.onDecision} onClick={() => decide(false)}>{t('sop.reject')}</button>
    </div>
  </div>;
}

const module: FrontendModule = {
  id: 'staffdeck.sop', slot: 'sop', contract: 'sop.lifecycle/v2', source: 'staffdeck', frontendApiVersion: 'frontend-module/v1',
  buildMarker: BUILD_MARKER,
  requires: ['agentLoop'],
  pages: [{ id: 'sop', path: '/sop', label: 'Workflow', labelKey: 'staffdeck:nav.workflow', component: SopPage }],
  settings: [{ id: 'sop-default-workflow', settingsSection: 'sop', label: 'Workflow', labelKey: 'staffdeck:nav.workflow', component: () => <SopProfileSetting /> }],
  chatExtensions: [{ id: 'sop-wait', label: 'SOP wait state', component: SopExtension, requiresRuntime: true }],
  permissionPanels: [{ id: 'sop-approval', label: 'SOP approval', toolNames: ['operator_approval'], component: SopPermissionPanel, requiresRuntime: true }],
};
export default module;

function SopProfileSetting() {
  const { t } = useTranslation('staffdeck');
  return <ProfileTextSetting slot="sop" field="defaultSopId" label={t('settings.defaultWorkflow')} description={t('settings.defaultWorkflowDescription')} />;
}
