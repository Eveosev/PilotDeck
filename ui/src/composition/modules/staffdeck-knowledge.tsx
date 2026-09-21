import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Database, FilePlus2, History, RefreshCw, Save, Search } from 'lucide-react';
import type { FrontendModule, SurfaceProps } from '../contracts';
import { ProfileTextSetting } from './shared';
import { staffDeckKnowledgeClient } from './staffdeck/clients';
import { FormalKnowledgeOperations } from './staffdeck/vendor/KnowledgeOperations';
import { BusinessUiProvider } from './staffdeck/vendor/i18n';

const BUILD_MARKER = 'staffdeck.knowledge.ui/v1';

type KnowledgeBase = { id: string; name?: string; description?: string; document_count?: number; version?: string; status?: string };
type KnowledgeVersion = { id: string; version?: string; name?: string; status?: string; updated_at?: string };
type KnowledgeDocument = { id: string; title?: string; filename?: string; content_md?: string; knowledge_base_id?: string; status?: string };
type KnowledgeChunk = { id?: string; chunk_id?: string; content?: string; summary?: string; source_ref?: string; title?: string };

function KnowledgePage() {
  const { t, i18n } = useTranslation('staffdeck');
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState('');
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [citation, setCitation] = useState<Record<string, unknown> | null>(null);
  const [newBaseName, setNewBaseName] = useState('');
  const [baseName, setBaseName] = useState('');
  const [baseDescription, setBaseDescription] = useState('');
  const [baseStatus, setBaseStatus] = useState('active');
  const [versions, setVersions] = useState<KnowledgeVersion[]>([]);
  const [documentTitle, setDocumentTitle] = useState('');
  const [documentContent, setDocumentContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBase = bases.find((base) => base.id === selectedBaseId) ?? null;
  const chunks = useMemo(() => extractChunks(result), [result]);

  const loadBases = async (preferredId?: string) => {
    setLoading(true); setError(null);
    try {
      const next = await staffDeckKnowledgeClient.call<KnowledgeBase[]>('list_bases');
      setBases(next);
      setSelectedBaseId((current) => preferredId || current || next[0]?.id || '');
    } catch (cause) { setError(messageOf(cause)); }
    finally { setLoading(false); }
  };

  const loadDocuments = async (baseId: string) => {
    if (!baseId) { setDocuments([]); return; }
    setLoading(true); setError(null);
    try {
      const next = await staffDeckKnowledgeClient.call<KnowledgeDocument[]>('list_documents', { knowledgeBaseId: baseId });
      setDocuments(next);
      setSelectedDocument((current) => current && next.some((document) => document.id === current.id) ? current : next[0] ?? null);
    } catch (cause) { setError(messageOf(cause)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadBases(); }, []);
  useEffect(() => { void loadDocuments(selectedBaseId); }, [selectedBaseId]);
  useEffect(() => {
    setBaseName(selectedBase?.name || '');
    setBaseDescription(selectedBase?.description || '');
    setBaseStatus(selectedBase?.status || 'active');
    setVersions([]);
  }, [selectedBase?.id]);

  const createBase = async () => {
    const name = newBaseName.trim();
    if (!name || saving) return;
    setSaving(true); setError(null);
    try {
      const created = await staffDeckKnowledgeClient.call<KnowledgeBase>('create_base', { name, description: '' });
      setNewBaseName('');
      await loadBases(created.id);
    } catch (cause) { setError(messageOf(cause)); }
    finally { setSaving(false); }
  };

  const saveBase = async () => {
    if (!selectedBase || saving || !baseName.trim()) return;
    setSaving(true); setError(null);
    try {
      await staffDeckKnowledgeClient.call('update_base', {
        knowledgeBaseId: selectedBase.id,
        name: baseName.trim(),
        description: baseDescription.trim(),
        status: baseStatus,
      });
      await loadBases(selectedBase.id);
    } catch (cause) { setError(messageOf(cause)); }
    finally { setSaving(false); }
  };

  const loadVersions = async () => {
    if (!selectedBase || loading) return;
    setLoading(true); setError(null);
    try { setVersions(await staffDeckKnowledgeClient.call<KnowledgeVersion[]>('list_versions', { knowledgeBaseId: selectedBase.id })); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setLoading(false); }
  };

  const saveDocument = async () => {
    if (!selectedBaseId || saving || !documentTitle.trim()) return;
    setSaving(true); setError(null);
    try {
      if (selectedDocument) {
        await staffDeckKnowledgeClient.call('update_document', { documentId: selectedDocument.id, title: documentTitle.trim(), contentMd: documentContent });
      } else {
        await staffDeckKnowledgeClient.call('import_document', {
          knowledgeBaseId: selectedBaseId,
          title: documentTitle.trim(),
          filename: `${documentTitle.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'document'}.md`,
          contentBase64: encodeText(documentContent),
        });
      }
      setDocumentTitle(''); setDocumentContent(''); setSelectedDocument(null);
      await loadDocuments(selectedBaseId);
    } catch (cause) { setError(messageOf(cause)); }
    finally { setSaving(false); }
  };

  const selectDocument = async (document: KnowledgeDocument) => {
    setError(null);
    try {
      const detail = await staffDeckKnowledgeClient.call<KnowledgeDocument>('get_document', { documentId: document.id });
      setSelectedDocument(detail);
      setDocumentTitle(detail.title || detail.filename || t('knowledge.newDocument'));
      setDocumentContent(detail.content_md || '');
    } catch (cause) { setError(messageOf(cause)); }
  };

  const search = async () => {
    if (!query.trim() || loading) return;
    setLoading(true); setError(null); setCitation(null);
    try {
      setResult(await staffDeckKnowledgeClient.call<Record<string, unknown>>('query', {
        query: query.trim(), mode: 'debug', needEvidencePack: true,
        ...(selectedBaseId ? { knowledgeBaseIds: [selectedBaseId] } : {}),
      }));
    } catch (cause) {
      setError(messageOf(cause));
    } finally { setLoading(false); }
  };

  const resolveCitation = async (chunk: KnowledgeChunk) => {
    const chunkId = chunk.chunk_id || chunk.id;
    if (!chunkId) return;
    setError(null);
    try { setCitation(await staffDeckKnowledgeClient.call<Record<string, unknown>>('resolve_citation', { chunkId })); }
    catch (cause) { setError(messageOf(cause)); }
  };

  return <main className="h-full overflow-y-auto bg-neutral-50 p-6 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="staffdeck-knowledge-workspace">
    <span className="sr-only" data-module-build-marker={BUILD_MARKER} />
    <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"><div className="flex items-center gap-2"><Database className="h-4 w-4 text-blue-600" /><h2 className="text-sm font-semibold">{t('knowledge.bases')}</h2></div><div className="mt-4 flex gap-2"><input aria-label={t('knowledge.newBase')} value={newBaseName} onChange={(event) => setNewBaseName(event.target.value)} placeholder={t('knowledge.newBase')} className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950" /><button type="button" aria-label={t('knowledge.createBase')} onClick={() => void createBase()} disabled={!newBaseName.trim() || saving} className="rounded bg-blue-600 px-2 text-white disabled:opacity-50"><FilePlus2 className="h-4 w-4" /></button></div><div className="mt-4 space-y-1">{bases.map((base) => <button key={base.id} type="button" onClick={() => setSelectedBaseId(base.id)} className={`w-full rounded px-2 py-2 text-left text-sm ${base.id === selectedBaseId ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}><span className="block truncate font-medium">{base.name || base.id}</span><span className="block text-xs text-neutral-500">{t('knowledge.documents', { count: base.document_count ?? 0 })} · {base.version || base.status || t('knowledge.active')}</span></button>)}</div></aside>
      <section className="min-w-0 space-y-5"><header className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-blue-600" /><h1 className="text-xl font-semibold">{selectedBase?.name || t('knowledge.workspace')}</h1></div><p className="mt-1 text-sm text-neutral-500">{t('knowledge.description')}</p></div><button type="button" onClick={() => void loadBases(selectedBaseId)} className="inline-flex items-center gap-2 rounded border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{t('knowledge.refresh')}</button></header>
        {error ? <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p> : null}
        <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">{t('knowledge.details')}</h2><div className="flex gap-2"><button type="button" onClick={() => void loadVersions()} disabled={!selectedBase || loading} className="inline-flex items-center gap-1.5 rounded border border-neutral-300 px-2.5 py-1.5 text-sm dark:border-neutral-700"><History className="h-4 w-4" />{t('knowledge.versions')}</button><button type="button" onClick={() => void saveBase()} disabled={!selectedBase || !baseName.trim() || saving} className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-2.5 py-1.5 text-sm font-medium text-white disabled:opacity-50"><Save className="h-4 w-4" />{t('knowledge.saveDetails')}</button></div></div><div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]"><div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300" htmlFor="knowledge-base-name">{t('knowledge.name')}</label><input id="knowledge-base-name" value={baseName} onChange={(event) => setBaseName(event.target.value)} disabled={!selectedBase} className="mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950" /></div><div><label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300" htmlFor="knowledge-base-status">{t('knowledge.status')}</label><select id="knowledge-base-status" value={baseStatus} onChange={(event) => setBaseStatus(event.target.value)} disabled={!selectedBase} className="mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"><option value="active">{t('knowledge.activeStatus')}</option><option value="archived">{t('knowledge.archived')}</option></select></div></div><label className="mt-3 block text-xs font-medium text-neutral-600 dark:text-neutral-300" htmlFor="knowledge-base-description">{t('knowledge.descriptionLabel')}</label><textarea id="knowledge-base-description" value={baseDescription} onChange={(event) => setBaseDescription(event.target.value)} disabled={!selectedBase} className="mt-1 min-h-20 w-full resize-y rounded border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950" />{versions.length > 0 ? <div className="mt-3 border-t border-neutral-100 pt-3 dark:border-neutral-800"><h3 className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t('knowledge.versionHistory')}</h3><ul className="mt-2 space-y-1 text-sm">{versions.map((version) => <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-neutral-50 px-2.5 py-2 dark:bg-neutral-800/60"><span>{version.version || version.id}</span><span className="text-xs text-neutral-500">{version.status || ''} {version.updated_at || ''}</span></li>)}</ul></div> : null}</section>
        <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{t('knowledge.documentsTitle')}</h2><button type="button" onClick={() => { setSelectedDocument(null); setDocumentTitle(''); setDocumentContent(''); }} disabled={!selectedBaseId} className="rounded border border-neutral-300 px-2.5 py-1.5 text-sm dark:border-neutral-700">{t('knowledge.newDocument')}</button></div><div className="mt-3 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]"><div className="space-y-1">{documents.map((document) => <button key={document.id} type="button" onClick={() => void selectDocument(document)} className={`w-full rounded px-2 py-2 text-left text-sm ${document.id === selectedDocument?.id ? 'bg-neutral-100 dark:bg-neutral-800' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/60'}`}><span className="block truncate font-medium">{document.title || document.filename || document.id}</span><span className="block text-xs text-neutral-500">{document.status === 'ready' ? t('knowledge.ready') : document.status || t('knowledge.ready')}</span></button>)}{selectedBaseId && documents.length === 0 ? <p className="px-2 py-3 text-xs text-neutral-500">{t('knowledge.noDocuments')}</p> : null}</div><div className="space-y-3"><input aria-label={t('knowledge.documentTitle')} value={documentTitle} onChange={(event) => setDocumentTitle(event.target.value)} placeholder={t('knowledge.documentTitle')} disabled={!selectedBaseId} className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950" /><textarea aria-label={t('knowledge.documentContent')} value={documentContent} onChange={(event) => setDocumentContent(event.target.value)} placeholder={t('knowledge.writeMarkdown')} disabled={!selectedBaseId} className="min-h-40 w-full resize-y rounded border border-neutral-300 bg-white px-3 py-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950" /><button type="button" onClick={() => void saveDocument()} disabled={!selectedBaseId || !documentTitle.trim() || saving} className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Save className="h-4 w-4" />{selectedDocument ? t('knowledge.saveDocument') : t('knowledge.createDocument')}</button></div></div></section>
        <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"><div className="flex items-center gap-2"><Search className="h-4 w-4 text-blue-600" /><h2 className="text-sm font-semibold">{t('knowledge.searchAndCitations')}</h2></div><div className="mt-3 flex gap-2"><input aria-label={t('knowledge.askBase')} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} placeholder={t('knowledge.askBase')} className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950" /><button type="button" onClick={() => void search()} disabled={!query.trim() || loading} className="rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">{t('knowledge.search')}</button></div>{result ? <div className="mt-4 space-y-3">{summaryOf(result) ? <p className="rounded bg-neutral-50 p-3 text-sm leading-6 dark:bg-neutral-800/60">{summaryOf(result)}</p> : null}{chunks.map((chunk, index) => <article key={chunk.chunk_id || chunk.id || index} className="rounded border border-neutral-200 p-3 dark:border-neutral-700"><p className="text-sm leading-6">{chunk.content || chunk.summary || t('knowledge.result')}</p><div className="mt-2 flex items-center justify-between gap-3"><span className="truncate text-xs text-neutral-500">{chunk.source_ref || chunk.title || chunk.chunk_id || chunk.id}</span><button type="button" onClick={() => void resolveCitation(chunk)} disabled={!chunk.chunk_id && !chunk.id} className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700">{t('knowledge.openCitation')}</button></div></article>)}{citation ? <details open className="rounded border border-blue-200 bg-blue-50 p-3 text-xs dark:border-blue-900 dark:bg-blue-950/30"><summary className="cursor-pointer font-medium">{t('knowledge.citationSource')}</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify(citation, null, 2)}</pre></details> : null}</div> : null}</section>
        {selectedBase ? <BusinessUiProvider value={{ t, locale: i18n.resolvedLanguage }}><FormalKnowledgeOperations client={staffDeckKnowledgeClient} knowledgeBaseId={selectedBase.id} documentId={selectedDocument?.id} onChanged={async () => { await loadBases(selectedBase.id); await loadDocuments(selectedBase.id); }} /></BusinessUiProvider> : null}
      </section>
    </div>
  </main>;
}

function extractChunks(result: Record<string, unknown> | null): KnowledgeChunk[] {
  if (!result) return [];
  for (const value of [result.chunks, result.evidence, result.results]) if (Array.isArray(value)) return value.filter((item): item is KnowledgeChunk => typeof item === 'object' && item !== null);
  return [];
}

function summaryOf(result: Record<string, unknown>): string | null {
  for (const value of [result.answer, result.summary, result.content]) if (typeof value === 'string' && value.trim()) return value;
  return null;
}

function encodeText(value: string): string { return btoa(unescape(encodeURIComponent(value))); }
function messageOf(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }

function KnowledgeArtifactRenderer(props: SurfaceProps) {
  const { t } = useTranslation('staffdeck');
  const artifact = props.artifact as { name?: string; path?: string } | undefined;
  return <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">{t('knowledge.knowledgeArtifact', { name: artifact?.name ?? artifact?.path ?? t('knowledge.defaultCitation') })}</div>;
}

const module: FrontendModule = {
  id: 'staffdeck.knowledge', slot: 'knowledge', contract: 'staffdeck.knowledge/v1', source: 'staffdeck', frontendApiVersion: 'frontend-module/v1',
  buildMarker: BUILD_MARKER,
  requiresCapabilities: ['query'],
  pages: [{ id: 'knowledge', path: '/knowledge', label: 'Knowledge', labelKey: 'staffdeck:nav.knowledge', component: KnowledgePage }],
  settings: [{ id: 'knowledge-default-base', settingsSection: 'knowledge', label: 'Knowledge', labelKey: 'staffdeck:nav.knowledge', component: () => <KnowledgeProfileSetting /> }],
  artifactRenderers: [{ id: 'staffdeck.knowledge-citation-artifact', label: 'Knowledge citation artifact', artifactMimeTypes: ['application/x-staffdeck-citation'], component: KnowledgeArtifactRenderer }],
};
export default module;

function KnowledgeProfileSetting() {
  const { t } = useTranslation('staffdeck');
  return <ProfileTextSetting slot="knowledge" field="defaultBaseId" label={t('settings.defaultKnowledgeBase')} description={t('settings.defaultKnowledgeBaseDescription')} />;
}
