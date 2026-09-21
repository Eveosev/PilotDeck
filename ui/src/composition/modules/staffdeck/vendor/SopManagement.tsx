import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Copy, FilePlus2, History, RefreshCw, RotateCcw, Save, Send, Trash2 } from 'lucide-react';
import { useBusinessUiI18n } from './i18n';

export type SopManagementClient = {
  call<T>(operation: string, input?: Record<string, unknown>): Promise<T>;
};

type SopRecord = Record<string, unknown> & { skill_id?: string; id?: string; name?: string; version?: string; status?: string; content?: Record<string, unknown> };
type SopDraft = SopRecord & { id: string; sop_id: string; etag?: string; content: Record<string, unknown>; status?: string; draft_version?: string };
type SopList = { data?: SopRecord[]; drafts?: SopDraft[] };

/**
 * Business state extracted from StaffDeck's SkillsPage. The component owns
 * draft/ETag/version interactions while its caller supplies the public API
 * adapter, so it has no dependency on enterprise router or auth stores.
 */
export function FormalSopManagement({ client, agentId }: { client: SopManagementClient; agentId: string }) {
  const { t } = useBusinessUiI18n();
  const [rows, setRows] = useState<SopRecord[]>([]);
  const [drafts, setDrafts] = useState<SopDraft[]>([]);
  const [selected, setSelected] = useState<SopDraft | null>(null);
  const [versions, setVersions] = useState<SopRecord[]>([]);
  const [newSopId, setNewSopId] = useState('');
  const [newSopName, setNewSopName] = useState('');
  const [copySource, setCopySource] = useState<SopRecord | null>(null);
  const [contentText, setContentText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedSopId = selected?.sop_id || selected?.skill_id || '';
  const load = async () => {
    setBusy(true); setMessage(null);
    try {
      const result = await client.call<SopList>('list');
      setRows(Array.isArray(result.data) ? result.data : []);
      setDrafts(Array.isArray(result.drafts) ? result.drafts : []);
      setSelected((current) => current ? (result.drafts ?? []).find((draft) => draft.id === current.id) ?? null : null);
    } catch (cause) { setMessage(messageOf(cause)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);

  const selectDraft = async (draft: SopDraft) => {
    setBusy(true); setMessage(null);
    try {
      const detail = await client.call<SopDraft>('get_draft', { sopId: draft.sop_id, draftId: draft.id });
      setSelected(detail); setContentText(JSON.stringify(detail.content, null, 2)); setVersions([]);
    } catch (cause) { setMessage(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const content = () => {
    try {
      const parsed = JSON.parse(contentText);
      if (!isRecord(parsed)) throw new Error(t('sop.management.contentObject'));
      return parsed;
    } catch (cause) { throw new Error(cause instanceof Error ? cause.message : t('sop.management.invalidJson')); }
  };
  const create = async (source?: SopRecord) => {
    const id = newSopId.trim();
    const name = newSopName.trim();
    if (!id || !name) { setMessage(t('sop.management.idAndName')); return; }
    setBusy(true); setMessage(null);
    try {
      const draft = await client.call<SopDraft>('create', { content: { ...createSopSkeleton(id, name), ...copyContent(source), skill_id: id, name } });
      setSelected(draft); setContentText(JSON.stringify(draft.content, null, 2)); setNewSopId(''); setNewSopName(''); setCopySource(null); await load();
    } catch (cause) { setMessage(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!selected) return;
    setBusy(true); setMessage(null);
    try {
      const detail = await client.call<SopDraft>('replace_draft', { sopId: selected.sop_id, draftId: selected.id, etag: selected.etag, content: content() });
      setSelected(detail); setContentText(JSON.stringify(detail.content, null, 2)); setMessage(t('sop.management.saved'));
    } catch (cause) { setMessage(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const validate = async () => {
    if (!selected) return;
    setBusy(true); setMessage(null);
    try {
      const result = await client.call<{ valid?: boolean; errors?: unknown[] }>('validate', { sopId: selected.sop_id, draftId: selected.id });
      setMessage(result.valid ? t('sop.management.valid') : t('sop.management.invalid', { count: result.errors?.length ?? 0 }));
    } catch (cause) { setMessage(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    if (!selected) return;
    setBusy(true); setMessage(null);
    try { await client.call('publish', { sopId: selected.sop_id, draftId: selected.id }); setMessage(t('sop.management.published')); await load(); }
    catch (cause) { setMessage(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const archive = async (sopId: string) => {
    setBusy(true); setMessage(null);
    try { await client.call('archive', { sopId }); setMessage(t('sop.management.archived')); await load(); }
    catch (cause) { setMessage(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const loadVersions = async (sopId = selectedSopId) => {
    if (!sopId) return;
    setBusy(true); setMessage(null);
    try {
      const result = await client.call<{ data?: SopRecord[] }>('list_versions', { sopId });
      setVersions(Array.isArray(result.data) ? result.data : []);
    } catch (cause) { setMessage(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const rollback = async (version: string) => {
    if (!selectedSopId) return;
    setBusy(true); setMessage(null);
    try {
      const draft = await client.call<SopDraft>('rollback', { sopId: selectedSopId, version });
      setSelected(draft); setContentText(JSON.stringify(draft.content, null, 2)); setMessage(t('sop.management.rollbackCreated', { version })); await loadVersions(selectedSopId);
    } catch (cause) { setMessage(messageOf(cause)); }
    finally { setBusy(false); }
  };
  const published = useMemo(() => rows.filter((row) => row.status === 'published'), [rows]);

  return <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900" data-testid="staffdeck-formal-sop-management">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">{t('sop.management.title')}</h2><p className="mt-1 text-xs text-neutral-500">{t('sop.management.description', { agentId })}</p></div><button type="button" aria-label={t('sop.refreshDefinitions')} onClick={() => void load()} disabled={busy} className="rounded p-1.5 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"><RefreshCw className="h-4 w-4" /></button></header>
    {message ? <p role="status" className="mt-3 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800">{message}</p> : null}
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"><div className="space-y-4"><section><h3 className="text-xs font-semibold uppercase text-neutral-500">{t('sop.management.drafts')}</h3><List items={drafts} empty={t('sop.management.noDrafts')} selectedId={selected?.id} onSelect={(draft) => void selectDraft(draft as SopDraft)} /></section><section><h3 className="text-xs font-semibold uppercase text-neutral-500">{t('sop.management.publishedList')}</h3><List items={published} empty={t('sop.management.noPublished')} onSelect={(row) => void loadVersions(idOf(row))} action={(row) => <span className="flex gap-1"><button type="button" aria-label={t('sop.management.copy')} onClick={() => { setCopySource(row); setNewSopName(String(row.name || '')); }} className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"><Copy className="h-3.5 w-3.5" /></button><button type="button" aria-label={t('sop.management.archive')} onClick={() => void archive(idOf(row))} className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"><Trash2 className="h-3.5 w-3.5" /></button></span>} /></section><section className="border-t pt-4 dark:border-neutral-700"><h3 className="text-xs font-semibold uppercase text-neutral-500">{t('sop.management.create')}</h3><div className="mt-2 grid gap-2 sm:grid-cols-2"><input value={newSopId} onChange={(event) => setNewSopId(event.target.value)} placeholder={t('sop.management.sopId')} aria-label={t('sop.management.sopId')} className="rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950" /><input value={newSopName} onChange={(event) => setNewSopName(event.target.value)} placeholder={t('sop.name')} aria-label={t('sop.name')} className="rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950" /></div><button type="button" onClick={() => void create(copySource ?? undefined)} disabled={busy || !newSopId.trim() || !newSopName.trim()} className="mt-2 inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"><FilePlus2 className="h-3.5 w-3.5" />{t('sop.management.createDraft')}</button></section></div><div className="space-y-3">{selected ? <><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">{selected.sop_id}</h3><p className="text-xs text-neutral-500">{t('sop.management.draftVersion', { version: selected.draft_version || selected.version || '-' })}</p></div><div className="flex gap-2"><button type="button" onClick={() => void validate()} disabled={busy} className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"><Check className="h-3.5 w-3.5" />{t('sop.management.validate')}</button><button type="button" onClick={() => void save()} disabled={busy} className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"><Save className="h-3.5 w-3.5" />{t('sop.management.saveDraft')}</button><button type="button" onClick={() => void publish()} disabled={busy} className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-xs text-white disabled:opacity-50"><Send className="h-3.5 w-3.5" />{t('sop.management.publish')}</button></div></div><textarea value={contentText} onChange={(event) => setContentText(event.target.value)} aria-label={t('sop.management.definitionJson')} className="min-h-72 w-full resize-y rounded border border-neutral-300 bg-white p-3 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950" /><section className="border-t pt-3 dark:border-neutral-700"><div className="flex items-center justify-between"><h3 className="text-xs font-semibold uppercase text-neutral-500">{t('sop.management.versions')}</h3><button type="button" onClick={() => void loadVersions()} disabled={busy} className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"><History className="h-3.5 w-3.5" />{t('sop.management.loadVersions')}</button></div><div className="mt-2 space-y-1">{versions.length ? versions.map((version) => <div key={`${idOf(version)}-${version.version}`} className="flex items-center justify-between rounded border border-neutral-100 px-2 py-1.5 text-xs dark:border-neutral-800"><span>{String(version.version || idOf(version))}</span><button type="button" onClick={() => void rollback(String(version.version || ''))} disabled={busy || !version.version} className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700"><RotateCcw className="h-3.5 w-3.5" />{t('sop.management.rollback')}</button></div>) : <p className="text-xs text-neutral-500">{t('sop.management.noVersions')}</p>}</div></section></> : <p className="rounded border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-neutral-700">{t('sop.management.selectDraft')}</p>}</div></div>
  </section>;
}

function List({ items, empty, selectedId, onSelect, action }: { items: SopRecord[]; empty: string; selectedId?: string; onSelect: (item: SopRecord) => void; action?: (item: SopRecord) => ReactNode }) {
  return <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">{items.length ? items.map((item) => <div key={String(item.id || idOf(item))} className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-sm ${item.id === selectedId ? 'border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30' : 'border-neutral-100 dark:border-neutral-800'}`}><button type="button" onClick={() => onSelect(item)} className="min-w-0 flex-1 text-left"><span className="block truncate">{String(item.name || item.sop_id || item.skill_id || item.id)}</span><span className="block text-xs text-neutral-500">{String(item.draft_version || item.version || item.status || '')}</span></button>{action?.(item)}</div>) : <p className="text-xs text-neutral-500">{empty}</p>}</div>;
}

function createSopSkeleton(skillId: string, name: string): Record<string, unknown> {
  return { skill_id: skillId, name, version: '1.0.0', description: '', capability_scope: 'sop_specific', step_timeout_seconds: null, trigger_intents: [], user_utterance_examples: [], goal: [], required_info: [], nodes: [], edges: [], start_node_id: '', terminal_node_ids: [], interruption_policy: {}, response_rules: [] };
}
function copyContent(source?: SopRecord): Record<string, unknown> {
  if (!source) return {};
  if (isRecord(source.content)) return source.content;
  const fields = [
    'skill_id', 'name', 'version', 'business_domain', 'description', 'capability_scope', 'step_timeout_seconds',
    'trigger_intents', 'user_utterance_examples', 'goal', 'required_info', 'nodes', 'edges', 'start_node_id',
    'terminal_node_ids', 'interruption_policy', 'response_rules',
  ];
  return Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));
}
function idOf(row: SopRecord): string { return String(row.sop_id || row.skill_id || row.id || ''); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function messageOf(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
