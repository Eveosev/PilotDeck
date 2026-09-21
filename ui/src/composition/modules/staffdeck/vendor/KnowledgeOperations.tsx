import { useEffect, useState, type ReactNode } from 'react';
import { Check, Download, RefreshCw, RotateCcw, Save, X } from 'lucide-react';
import KnowledgeGraphCanvas, { type KnowledgeGraphLabels } from './KnowledgeGraphCanvas';
import type { KnowledgeConceptRead } from './types';
import { useBusinessUiI18n } from './i18n';

export type KnowledgeModuleClient = {
  call<T>(operation: string, input?: Record<string, unknown>): Promise<T>;
};

type Item = Record<string, unknown> & { id?: string; version?: string; title?: string; status?: string };

/**
 * Extracted from StaffDeck KnowledgePage.tsx. It deliberately receives only a
 * module client and resource identifiers, keeping enterprise auth/router state
 * and PilotDeck shell state outside the reusable business surface.
 */
export function FormalKnowledgeOperations({
  client,
  knowledgeBaseId,
  documentId,
  onChanged,
}: {
  client: KnowledgeModuleClient;
  knowledgeBaseId: string;
  documentId?: string;
  onChanged?: () => void | Promise<void>;
}) {
  const { t, locale } = useBusinessUiI18n();
  const graphLabels: KnowledgeGraphLabels = {
    empty: t('knowledge.graph.empty'),
    canvas: t('knowledge.graph.canvas'),
    zoomIn: t('knowledge.graph.zoomIn'),
    zoomOut: t('knowledge.graph.zoomOut'),
    reset: t('knowledge.graph.reset'),
    fallbackType: t('knowledge.graph.types.fallback'),
    typeLabels: {
      'Source Document': t('knowledge.graph.types.sourceDocument'),
      'Source Section': t('knowledge.graph.types.sourceSection'),
      Topic: t('knowledge.graph.types.topic'),
      Playbook: t('knowledge.graph.types.playbook'),
      'Business Rule': t('knowledge.graph.types.businessRule'),
      'Query Analysis': t('knowledge.graph.types.queryAnalysis'),
    },
    sortLocale: locale,
  };
  const [agentId, setAgentId] = useState('');
  const [versions, setVersions] = useState<Item[]>([]);
  const [jobs, setJobs] = useState<Item[]>([]);
  const [buckets, setBuckets] = useState<Item[]>([]);
  const [chunks, setChunks] = useState<Item[]>([]);
  const [concepts, setConcepts] = useState<Item[]>([]);
  const [discoveries, setDiscoveries] = useState<Item[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<Item | null>(null);
  const [chunkDrafts, setChunkDrafts] = useState<Record<string, { content: string; summary: string }>>({});
  const [selectedConcept, setSelectedConcept] = useState<Item | null>(null);
  const [bucketTitle, setBucketTitle] = useState('');
  const [bucketSummary, setBucketSummary] = useState('');
  const [conceptContent, setConceptContent] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const baseInput = { knowledgeBaseId, ...(agentId.trim() ? { agentId: agentId.trim() } : {}) };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage(null);
    try { await action(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const changed = async () => { await onChanged?.(); };

  const loadVersions = () => run(async () => setVersions(await client.call<Item[]>('list_versions', baseInput)));
  const loadJobs = () => run(async () => setJobs(await client.call<Item[]>('list_jobs', { ...baseInput, limit: 20 })));
  const loadStructure = () => run(async () => {
    if (!documentId) return;
    setBuckets(await client.call<Item[]>('list_document_buckets', { documentId, ...baseInput }));
  });
  const loadConcepts = () => run(async () => setConcepts(await client.call<Item[]>('list_okf_concepts', baseInput)));
  const loadDiscoveries = () => run(async () => setDiscoveries(await client.call<Item[]>('list_discoveries', baseInput)));

  useEffect(() => {
    setVersions([]); setJobs([]); setBuckets([]); setChunks([]); setConcepts([]); setDiscoveries([]);
    setSelectedBucket(null); setSelectedConcept(null); setChunkDrafts({});
  }, [knowledgeBaseId]);

  const selectBucket = (bucket: Item) => run(async () => {
    const bucketId = text(bucket.id);
    if (!bucketId) return;
    setSelectedBucket(bucket); setBucketTitle(text(bucket.title)); setBucketSummary(text(bucket.summary));
    const nextChunks = await client.call<Item[]>('list_bucket_chunks', { bucketId, ...baseInput });
    setChunks(nextChunks);
    setChunkDrafts(Object.fromEntries(nextChunks.map((chunk) => [text(chunk.id), { content: text(chunk.content), summary: text(chunk.summary) }])));
  });
  const selectConcept = async (concept: Item) => {
    const conceptId = text(concept.concept_id) || text(concept.id);
    const cached = concepts.find((item) => text(item.concept_id) === conceptId || text(item.id) === conceptId);
    if (cached && Object.prototype.hasOwnProperty.call(cached, 'content_md')) {
      setSelectedConcept(cached);
      setConceptContent(text(cached.content_md));
      return;
    }
    await run(async () => {
      const detail = await client.call<Item>('get_okf_concept', { ...baseInput, conceptId });
      setSelectedConcept(detail);
      setConceptContent(text(detail.content_md));
    });
  };

  return <section className="space-y-5" data-testid="staffdeck-formal-knowledge-operations">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">{t('knowledge.operations.title')}</h2><p className="mt-1 text-xs text-neutral-500">{t('knowledge.operations.description')}</p></div><label className="text-xs text-neutral-500">{t('knowledge.operations.agentId')}<input value={agentId} onChange={(event) => setAgentId(event.target.value)} className="ml-2 w-40 rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950" /></label></header>
    {message ? <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{message}</p> : null}

    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title={t('knowledge.operations.lifecycle')} action={loadVersions} busy={busy}>
        <div className="flex flex-wrap gap-2"><Action onClick={() => run(async () => { await client.call('sync_base', baseInput); await loadVersions(); await changed(); })} disabled={busy || !agentId.trim()}>{t('knowledge.operations.sync')}</Action><Action onClick={() => run(async () => { await client.call('publish_version', baseInput); await loadVersions(); await changed(); })} disabled={busy || !agentId.trim()}>{t('knowledge.operations.promote')}</Action></div>
        <List items={versions} empty={t('knowledge.operations.noVersions')} render={(item) => <div className="flex items-center justify-between gap-2"><span>{text(item.version) || text(item.id)}</span><Action onClick={() => run(async () => { await client.call('rollback_version', { ...baseInput, version: text(item.version) }); await loadVersions(); await changed(); })} disabled={busy || !agentId.trim()}><RotateCcw className="h-3.5 w-3.5" />{t('knowledge.operations.rollback')}</Action></div>} />
      </Panel>
      <Panel title={t('knowledge.operations.jobs')} action={loadJobs} busy={busy}>
        <List items={jobs} empty={t('knowledge.operations.noJobs')} render={(item) => <div className="flex items-center justify-between gap-2"><span className="truncate">{text(item.filename) || text(item.id)} · {text(item.status)}</span><Action onClick={() => run(async () => { await client.call('cancel_job', { jobId: text(item.id), ...baseInput }); await loadJobs(); })} disabled={busy || ['succeeded', 'failed', 'cancelled'].includes(text(item.status))}><X className="h-3.5 w-3.5" />{t('knowledge.operations.cancel')}</Action></div>} />
      </Panel>
      <Panel title={t('knowledge.operations.structure')} action={loadStructure} busy={busy}>
        {!documentId ? <p className="text-xs text-neutral-500">{t('knowledge.operations.selectDocument')}</p> : <><List items={buckets} empty={t('knowledge.operations.noBuckets')} render={(item) => <button type="button" onClick={() => void selectBucket(item)} className="w-full rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800">{text(item.title) || text(item.id)}</button>} />{selectedBucket ? <div className="space-y-2 border-t pt-3 dark:border-neutral-700"><input value={bucketTitle} onChange={(event) => setBucketTitle(event.target.value)} aria-label={t('knowledge.operations.bucketTitle')} className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950" /><textarea value={bucketSummary} onChange={(event) => setBucketSummary(event.target.value)} aria-label={t('knowledge.operations.bucketSummary')} className="min-h-16 w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950" /><Action onClick={() => run(async () => { await client.call('update_bucket', { bucketId: text(selectedBucket.id), ...baseInput, title: bucketTitle, summary: bucketSummary }); await loadStructure(); await changed(); })} disabled={busy}><Save className="h-3.5 w-3.5" />{t('knowledge.operations.saveBucket')}</Action><List items={chunks} empty={t('knowledge.operations.noChunks')} render={(item) => { const chunkId = text(item.id); const draft = chunkDrafts[chunkId] ?? { content: text(item.content), summary: text(item.summary) }; return <div className="space-y-2 rounded bg-neutral-50 p-2 dark:bg-neutral-800/60"><textarea value={draft.summary} onChange={(event) => setChunkDrafts((current) => ({ ...current, [chunkId]: { ...draft, summary: event.target.value } }))} aria-label={t('knowledge.operations.chunkSummary')} className="min-h-12 w-full rounded border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950" /><textarea value={draft.content} onChange={(event) => setChunkDrafts((current) => ({ ...current, [chunkId]: { ...draft, content: event.target.value } }))} aria-label={t('knowledge.operations.chunkContent')} className="min-h-20 w-full rounded border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950" /><Action onClick={() => run(async () => { await client.call('update_chunk', { chunkId, ...baseInput, content: draft.content, summary: draft.summary }); await selectBucket(selectedBucket); await changed(); })} disabled={busy || !chunkId}><Save className="h-3.5 w-3.5" />{t('knowledge.operations.saveChunk')}</Action></div>; }} /></div> : null}</>}
      </Panel>
      <Panel title={t('knowledge.operations.okf')} action={loadConcepts} busy={busy}>
        <div className="flex flex-wrap gap-2"><Action onClick={() => run(async () => { const report = await client.call<Item>('lint_okf', baseInput); setMessage(JSON.stringify(report)); })} disabled={busy}>{t('knowledge.operations.lint')}</Action><Action onClick={() => run(async () => { const result = await client.call<Item>('export_okf', baseInput); downloadBase64(text(result.content_base64), text(result.filename) || 'knowledge.okf'); })} disabled={busy}><Download className="h-3.5 w-3.5" />{t('knowledge.operations.export')}</Action></div><List items={concepts} empty={t('knowledge.operations.noConcepts')} render={(item) => <button type="button" onClick={() => void selectConcept(item)} className="w-full rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800">{text(item.title) || text(item.concept_id)}</button>} />{selectedConcept ? <div className="space-y-2 border-t pt-3 dark:border-neutral-700"><textarea value={conceptContent} onChange={(event) => setConceptContent(event.target.value)} aria-label={t('knowledge.operations.conceptContent')} className="min-h-20 w-full rounded border border-neutral-300 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950" /><Action onClick={() => run(async () => { await client.call('upsert_okf_concept', { ...baseInput, conceptId: text(selectedConcept.concept_id), contentMd: conceptContent, documentId }); await loadConcepts(); await changed(); })} disabled={busy}><Save className="h-3.5 w-3.5" />{t('knowledge.operations.saveConcept')}</Action></div> : null}</Panel>
      <Panel title={t('knowledge.operations.discoveries')} action={loadDiscoveries} busy={busy}>
        <List items={discoveries} empty={t('knowledge.operations.noDiscoveries')} render={(item) => <div className="flex items-center justify-between gap-2"><span className="truncate">{text(item.title) || text(item.id)}</span><span className="flex gap-1"><Action onClick={() => run(async () => { await client.call('confirm_discovery', { suggestionId: text(item.id), ...baseInput }); await loadDiscoveries(); })} disabled={busy}><Check className="h-3.5 w-3.5" />{t('knowledge.operations.confirm')}</Action><Action onClick={() => run(async () => { await client.call('reject_discovery', { suggestionId: text(item.id), ...baseInput }); await loadDiscoveries(); })} disabled={busy}><X className="h-3.5 w-3.5" />{t('knowledge.operations.reject')}</Action></span></div>} />
        <KnowledgeGraphCanvas concepts={toGraphConcepts(concepts)} labels={graphLabels} onSelectConcept={(concept) => void selectConcept(concept as Item)} />
      </Panel>
    </div>
  </section>;
}

function Panel({ title, action, busy, children }: { title: string; action: () => void; busy: boolean; children: ReactNode }) {
  const { t } = useBusinessUiI18n();
  return <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{title}</h3><button type="button" onClick={action} disabled={busy} aria-label={t('knowledge.refresh')} className="rounded p-1.5 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800"><RefreshCw className="h-4 w-4" /></button></div><div className="mt-3 space-y-2">{children}</div></section>;
}

function Action({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800">{children}</button>;
}

function List({ items, empty, render }: { items: Item[]; empty: string; render: (item: Item) => ReactNode }) {
  return <div className="max-h-44 space-y-1 overflow-y-auto">{items.length ? items.map((item, index) => <div key={text(item.id) || index} className="rounded border border-neutral-100 p-1 dark:border-neutral-800">{render(item)}</div>) : <p className="text-xs text-neutral-500">{empty}</p>}</div>;
}

function text(value: unknown): string { return typeof value === 'string' ? value : ''; }

function toGraphConcepts(concepts: Item[]): KnowledgeConceptRead[] {
  return concepts.map((concept, index) => ({
    id: text(concept.id) || `concept-${index}`,
    concept_id: text(concept.concept_id) || text(concept.id) || `concept-${index}`,
    concept_type: text(concept.concept_type) || 'Topic',
    title: text(concept.title) || text(concept.concept_id) || `Concept ${index + 1}`,
    document_id: text(concept.document_id) || undefined,
    links: Array.isArray(concept.links) ? concept.links.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : [],
    citations: Array.isArray(concept.citations) ? concept.citations.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : [],
    status: text(concept.status) || undefined,
  }));
}

function downloadBase64(value: string, filename: string) {
  if (!value) return;
  const bytes = Uint8Array.from(atob(value), (item) => item.charCodeAt(0));
  const href = URL.createObjectURL(new Blob([bytes]));
  const link = document.createElement('a');
  link.href = href; link.download = filename; link.click();
  URL.revokeObjectURL(href);
}
