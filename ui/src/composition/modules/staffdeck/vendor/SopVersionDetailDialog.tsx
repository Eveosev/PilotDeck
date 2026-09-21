import { useEffect } from 'react';
import { History, Workflow } from 'lucide-react';

export type StaffDeckSopVersion = {
  id: string;
  skill_id?: string;
  name: string;
  version: string;
  business_domain?: string;
  status?: string;
  call_count?: number;
  positive_rate?: number;
  negative_rate?: number;
  updated_at: string;
  content?: unknown;
};

export type SopVersionDetailLabels = {
  title: string;
  emptyTitle: string;
  version: string;
  domain: string;
  status: string;
  calls: string;
  positive: string;
  negative: string;
  updated: string;
  draft: string;
  published: string;
  archived: string;
  unknown: string;
};

const DEFAULT_LABELS: SopVersionDetailLabels = {
  title: '版本详情', emptyTitle: '版本详情', version: '版本', domain: '业务域', status: '状态',
  calls: '调用次数', positive: '好评率', negative: '差评率', updated: '更新时间',
  draft: '草稿', published: '已启用', archived: '已停用', unknown: '-',
};

/**
 * Source: StaffDeck frontend-enterprise/src/pages/SkillsPage.tsx VersionDetailDialog.
 * Host adapters provide the selected version and localized labels; the view
 * keeps the source page's detail fields and serialized SOP content visible.
 */
export function SopVersionDetailDialog({ detail, onClose, labels = DEFAULT_LABELS }: {
  detail: StaffDeckSopVersion | null;
  onClose: () => void;
  labels?: SopVersionDetailLabels;
}) {
  useEffect(() => {
    if (!detail) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detail, onClose]);
  if (!detail) return null;
  const value = (item: unknown) => typeof item === 'number' ? String(item) : String(item || labels.unknown);
  const rate = (item: unknown) => typeof item === 'number' ? `${Math.round(item * 100)}%` : labels.unknown;
  const status = detail.status === 'published' ? labels.published : detail.status === 'draft' ? labels.draft : detail.status === 'archived' ? labels.archived : value(detail.status);
  const source = skillSourceText(detail);
  return <div role="dialog" aria-modal="true" aria-label={`${labels.title}: ${detail.name} / ${detail.version}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="flex max-h-[calc(100dvh-4rem)] w-[min(900px,calc(100vw-2rem))] flex-col gap-4 overflow-hidden rounded-[14px] bg-white px-5 py-4 text-neutral-900 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      <header className="flex items-center gap-2 text-sm text-neutral-500"><Workflow className="size-4 shrink-0" /><h2 className="min-w-0 truncate font-normal">{labels.title}: {detail.name} / {detail.version}</h2><button type="button" aria-label="Close" className="ml-auto rounded px-2 py-1 text-lg hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={onClose}>×</button></header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
        <div className="grid grid-cols-2 gap-2.5 max-[520px]:grid-cols-1">{[
          [labels.version, detail.version], [labels.domain, detail.business_domain], [labels.status, status], [labels.calls, `${value(detail.call_count)} 次`], [labels.positive, rate(detail.positive_rate)], [labels.negative, rate(detail.negative_rate)], [labels.updated, detail.updated_at.slice(0, 10)],
        ].map(([label, item]) => <div key={label} className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-3 text-sm dark:border-neutral-800 dark:bg-neutral-950"><span className="text-xs font-semibold text-neutral-500">{label}</span><strong className="break-words">{item || labels.unknown}</strong></div>)}</div>
        <pre className="overflow-x-auto rounded-xl bg-neutral-100 p-3.5 text-xs leading-7 text-neutral-700 whitespace-pre-wrap break-words dark:bg-neutral-950 dark:text-neutral-300"><History className="mb-2 size-4" />{source}</pre>
      </div>
    </section>
  </div>;
}

function skillSourceText(detail: StaffDeckSopVersion): string {
  if (typeof detail.content === 'string') return detail.content;
  const skill = isRecord(detail.content) ? detail.content : {};
  const nodes = Array.isArray(skill.nodes) ? skill.nodes.filter(isRecord) : [];
  return [
    `# ${text(skill.name) || detail.name}`,
    `- skill_id: ${text(skill.skill_id) || detail.skill_id || '-'}`,
    `- version: ${text(skill.version) || detail.version}`,
    `- business_domain: ${text(skill.business_domain) || detail.business_domain || '-'}`,
    `- description: ${text(skill.description) || '-'}`,
    `- trigger_intents: ${formatList(skill.trigger_intents)}`,
    `- user_utterance_examples: ${formatList(skill.user_utterance_examples)}`,
    `- goal: ${formatList(skill.goal)}`,
    `- required_info: ${formatList(skill.required_info)}`,
    `- response_rules: ${formatList(skill.response_rules)}`,
    '',
    '## 详细节点',
    ...nodes.flatMap((node, index) => [
      '',
      `### 节点 ${index + 1}: ${text(node.name) || text(node.node_id) || `节点 ${index + 1}`}`,
      `- node_id: ${text(node.node_id) || '-'}`,
      `- node_type: ${text(node.type) || 'collect_info'}`,
      `- condition: ${text(node.condition) || '-'}`,
      `- instruction: ${text(node.instruction) || '-'}`,
      `- expected_user_info: ${formatList(node.expected_user_info)}`,
      `- allowed_actions: ${formatList(node.allowed_actions)}`,
    ]),
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function formatList(value: unknown): string {
  return Array.isArray(value) && value.length > 0 ? value.map(String).join(', ') : '-';
}

export default SopVersionDetailDialog;
