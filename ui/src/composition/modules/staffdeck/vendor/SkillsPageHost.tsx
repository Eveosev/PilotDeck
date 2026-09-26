import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { ChevronDown, Clipboard, Edit3, Eye, FilePlus2, FileText, History, MoreHorizontal, RefreshCw, Search, Trash2 } from 'lucide-react';
import SopVersionDetailDialog from './SopVersionDetailDialog';

export type EnterpriseAuthUser = { id?: string; username?: string; tenant_id?: string; is_admin?: boolean };
export type AgentProfileRead = Record<string, any> & { id: string; name?: string; is_overall?: boolean; active?: boolean };
export type SkillRead = Record<string, any> & { id: string; skill_id: string; name: string; version: string; status: 'draft' | 'published' | 'archived'; updated_at: string };
export type SkillVersionRead = Record<string, any> & { id: string; skill_id?: string; name: string; version: string; updated_at: string; content?: any };
export type BadgeTone = 'blue' | 'green' | 'gray' | 'orange' | 'red' | string;

type Api = {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
  blob?(path: string): Promise<Blob>;
};

type DataColumn = { key: string; title: string; render?: (row: any) => ReactNode; [key: string]: any };
type HostComponent = ComponentType<any>;

export type SkillsPageHost = {
  api: Api;
  navigate(path: string): void;
  tenantId: string;
  notify: { success(message: string): void; warning(message: string): void; error(message: string): void };
  components?: Partial<Record<string, HostComponent>>;
  icons?: Partial<Record<string, HostComponent>>;
  isEnterpriseAdmin(user?: EnterpriseAuthUser): boolean;
  canManageEmployeeAgent(agent: AgentProfileRead, user?: EnterpriseAuthUser): boolean;
  openGalleryAgentId(agents: AgentProfileRead[]): string;
  openGalleryImportSourceOptions(agents: AgentProfileRead[], label: string): Array<{ value: string; label: string }>;
  resourceCreatorName(row: Record<string, any>): string;
  visibleEmployeeAgents(agents: AgentProfileRead[], user?: EnterpriseAuthUser, options?: Record<string, any>): AgentProfileRead[];
  readEmployeeScope(): string;
  isTeamScope(value: string): boolean;
  useClientPagination<T>(items: T[], pageSize: number, resetKey: unknown): { pagedItems: T[]; page: number; pageCount: number; setPage(page: number): void };
};

const defaultNotify = {
  success: (_message: string) => {},
  warning: (_message: string) => {},
  error: (_message: string) => {},
};

function joinClasses(...values: Array<string | false | null | undefined>): string { return values.filter(Boolean).join(' '); }

function DefaultAppHeader({ title, userName }: any) {
  return <header className="mx-auto flex max-w-6xl items-center justify-between px-6 pt-6 text-sm"><strong>{title}</strong>{userName ? <span className="text-neutral-500">{userName}</span> : null}</header>;
}

function DefaultButton({ children, variant: _variant, ...props }: any) { return <button type="button" {...props}>{children}</button>; }
function DefaultStatusBadge({ children, tone }: any) { return <span data-tone={tone} className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">{children}</span>; }
function DefaultDetailField({ label, children }: any) { return <div className="flex flex-col gap-1"><span className="text-xs text-neutral-500">{label}</span><strong className="text-sm">{children}</strong></div>; }

function DefaultDataTable({ columns = [], data = [], rowKey, emptyText = '', loading, onRowClick, ...props }: { columns?: DataColumn[]; data?: any[]; rowKey?: (row: any) => string; emptyText?: string; loading?: boolean; onRowClick?: (row: any, index: number) => void; [key: string]: any }) {
  return <div className="overflow-x-auto">
    <table {...props} className={joinClasses('w-full text-left text-sm', props.className)}>
      <thead><tr>{columns.map((column) => <th key={column.key} className="whitespace-nowrap px-3 py-2 text-xs font-medium text-neutral-500">{column.title}</th>)}</tr></thead>
      <tbody>{loading ? <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-neutral-500">加载中...</td></tr>
        : data.length === 0 ? <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-neutral-500">{emptyText}</td></tr>
        : data.map((row, index) => <tr
          key={rowKey?.(row) || row.id || index}
          onClick={onRowClick ? () => onRowClick(row, index) : undefined}
          className={joinClasses('border-t border-neutral-100 dark:border-neutral-800', onRowClick && 'cursor-pointer')}
        >{columns.map((column) => <td key={column.key} className="px-3 py-2">{column.render ? column.render(row) : row[column.key]}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

function DefaultPaginator({ page, pageCount, onChange, ...props }: any) {
  if (!pageCount || pageCount < 2) return null;
  return <nav {...props} className={joinClasses('flex items-center gap-2 text-xs', props.className)}><button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</button><span>{page} / {pageCount}</span><button type="button" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>下一页</button></nav>;
}

function DefaultConfirmDialog({ open, title, description, confirmText = '确认', onOpenChange, onConfirm, loading }: any) {
  if (!open) return null;
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"><section className="w-[min(460px,100%)] rounded-lg bg-white p-5 shadow-xl dark:bg-neutral-900"><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm text-neutral-600">{description}</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => onOpenChange?.(false)}>取消</button><button type="button" disabled={loading} onClick={onConfirm}>{confirmText}</button></div></section></div>;
}

function DefaultDialog({ open, onOpenChange, children }: any) { return open ? <div role="dialog" aria-modal="true" className="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" onMouseDown={(event) => event.target === event.currentTarget && onOpenChange?.(false)}>{children}</div> : null; }
function DefaultDialogContent({ children, className }: any) { return <section className={joinClasses('max-h-[calc(100dvh-2rem)] w-[min(960px,100%)] overflow-auto rounded-lg bg-white p-5 shadow-xl dark:bg-neutral-900', className)}>{children}</section>; }
function DefaultDialogTitle({ children, className }: any) { return <h2 className={joinClasses('text-base font-semibold', className)}>{children}</h2>; }

type DropdownContextValue = { open: boolean; setOpen(open: boolean): void };
const DropdownContext = createContext<DropdownContextValue | null>(null);
function DefaultDropdownMenu({ children }: any) { const [open, setOpen] = useState(false); return <DropdownContext.Provider value={{ open, setOpen }}><div className="relative inline-flex">{children}</div></DropdownContext.Provider>; }
function DefaultDropdownTrigger({ children, asChild: _asChild, onClick, ...props }: any) { const state = useContext(DropdownContext); return <button type="button" {...props} onClick={(event) => { onClick?.(event); state?.setOpen(!state.open); }}>{children}</button>; }
function DefaultDropdownContent({ children, className }: any) { const state = useContext(DropdownContext); if (!state?.open) return null; return <div className={joinClasses('absolute right-0 top-full z-50 mt-1 min-w-44 rounded-md border bg-white p-1 shadow-lg dark:bg-neutral-900', className)}>{children}</div>; }
function DefaultDropdownItem({ children, onSelect, disabled, className, variant: _variant }: any) { const state = useContext(DropdownContext); return <button type="button" disabled={disabled} className={joinClasses('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800', className)} onClick={() => { onSelect?.(); state?.setOpen(false); }}>{children}</button>; }
function DefaultDropdownSeparator({ className }: any) { return <div className={joinClasses('my-1 h-px bg-neutral-200', className)} />; }

type SelectContextValue = { value: string; onValueChange?(value: string): void; open: boolean; setOpen(open: boolean): void };
const SelectContext = createContext<SelectContextValue | null>(null);
function DefaultSelect({ value, onValueChange, children }: any) { const [open, setOpen] = useState(false); return <SelectContext.Provider value={{ value, onValueChange, open, setOpen }}><div className="relative inline-flex">{children}</div></SelectContext.Provider>; }
function DefaultSelectTrigger({ children, className, ...props }: any) { const state = useContext(SelectContext); return <button type="button" {...props} className={joinClasses('inline-flex h-9 items-center justify-between gap-2 rounded border px-3 text-sm', className)} onClick={() => state?.setOpen(!state.open)}>{children}<ChevronDown className="size-3.5" /></button>; }
function DefaultSelectValue({ placeholder }: any) { const state = useContext(SelectContext); return <span>{state?.value || placeholder}</span>; }
function DefaultSelectContent({ children, className }: any) { const state = useContext(SelectContext); return state?.open ? <div className={joinClasses('absolute left-0 top-full z-50 mt-1 min-w-full rounded border bg-white p-1 shadow-lg dark:bg-neutral-900', className)}>{children}</div> : null; }
function DefaultSelectItem({ value, children, className }: any) { const state = useContext(SelectContext); return <button type="button" className={joinClasses('block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800', className)} onClick={() => { state?.onValueChange?.(value); state?.setOpen(false); }}>{children}</button>; }

function DefaultResourceImportDialog({ open, onClose, onSubmit, sources = [], items = [], sourceId, onSourceChange, selectedIds = [], onSelectedChange, title, loading }: any) {
  if (!open) return null;
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"><section className="w-[min(620px,100%)] rounded-lg bg-white p-5 shadow-xl dark:bg-neutral-900"><h2 className="font-semibold">{title}</h2><select className="mt-4 w-full rounded border p-2" value={sourceId} onChange={(event) => onSourceChange?.(event.target.value)}><option value="">选择来源</option>{sources.map((source: any) => <option key={source.value} value={source.value}>{source.label}</option>)}</select><div className="mt-3 max-h-56 space-y-1 overflow-auto">{items.map((item: any) => <label key={item.id} className="flex gap-2 text-sm"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => onSelectedChange?.(event.target.checked ? [...selectedIds, item.id] : selectedIds.filter((id: string) => id !== item.id))} />{item.label}</label>)}</div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose}>取消</button><button type="button" disabled={loading} onClick={onSubmit}>确认</button></div></section></div>;
}

function DefaultHostIcon({ name, ...props }: { name: string; [key: string]: any }) { const icons: Record<string, any> = { IconAdd: FilePlus2, IconChevronDown: ChevronDown, IconClear: Search, IconClipboard: Clipboard, IconEdit: Edit3, IconHistory: History, IconMore: MoreHorizontal, IconRefresh: RefreshCw, IconSearch: Search, IconSkill: FileText, IconTrash: Trash2 }; const Icon = icons[name] || FileText; return <Icon {...props} />; }

const defaultHost: SkillsPageHost = {
  api: { get: async () => { throw new Error('StaffDeck Skills API is not configured'); }, post: async () => { throw new Error('StaffDeck Skills API is not configured'); }, put: async () => { throw new Error('StaffDeck Skills API is not configured'); }, delete: async () => { throw new Error('StaffDeck Skills API is not configured'); } },
  navigate: (path) => { window.location.assign(path); },
  tenantId: 'tenant_demo', notify: defaultNotify,
  isEnterpriseAdmin: (user) => Boolean(user?.is_admin), canManageEmployeeAgent: () => true,
  openGalleryAgentId: (agents) => agents.find((agent) => agent.is_overall)?.id || '', openGalleryImportSourceOptions: (agents) => agents.filter((agent) => agent.is_overall).map((agent) => ({ value: agent.id, label: agent.name || agent.id })),
  resourceCreatorName: (row) => String(row.created_by_name || row.creator_name || ''), visibleEmployeeAgents: (agents, _user, options = {}) => agents.filter((agent) => !agent.is_overall && (!options.activeOnly || agent.active !== false) && agent.id !== options.excludeAgentId), readEmployeeScope: () => '', isTeamScope: (value) => value.startsWith('team:'),
  useClientPagination: <T,>(items: T[], pageSize: number, _resetKey: unknown) => { const [page, setPage] = useState(1); const pageCount = Math.max(1, Math.ceil(items.length / pageSize)); return { page: Math.min(page, pageCount), setPage, pageCount, pagedItems: items.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize) }; },
};

const HostContext = createContext<SkillsPageHost>(defaultHost);
let activeHost: SkillsPageHost = defaultHost;

export function SkillsPageHostProvider({ value, children }: { value: SkillsPageHost; children: ReactNode }) { activeHost = value; return <HostContext.Provider value={value}>{children}</HostContext.Provider>; }
export function useSkillsPageHost(): SkillsPageHost { return useContext(HostContext); }
export const TENANT_ID = defaultHost.tenantId;
export const api: Api = { get: (path) => activeHost.api.get(path), post: (path, body) => activeHost.api.post(path, body), put: (path, body) => activeHost.api.put(path, body), delete: (path) => activeHost.api.delete(path), blob: (path) => activeHost.api.blob?.(path) || Promise.reject(new Error('Blob API is not configured')) };
export const navigate = (path: string) => activeHost.navigate(path);
export const notify = { success: (message: string) => activeHost.notify.success(message), warning: (message: string) => activeHost.notify.warning(message), error: (message: string) => activeHost.notify.error(message) };
export const isEnterpriseAdmin = (user?: EnterpriseAuthUser) => activeHost.isEnterpriseAdmin(user);
export const canManageEmployeeAgent = (agent: AgentProfileRead, user?: EnterpriseAuthUser) => activeHost.canManageEmployeeAgent(agent, user);
export const openGalleryAgentId = (agents: AgentProfileRead[]) => activeHost.openGalleryAgentId(agents);
export const openGalleryImportSourceOptions = (...args: Parameters<SkillsPageHost['openGalleryImportSourceOptions']>) => activeHost.openGalleryImportSourceOptions(...args);
export const resourceCreatorName = (row: Record<string, any>) => activeHost.resourceCreatorName(row);
export const visibleEmployeeAgents = (...args: Parameters<SkillsPageHost['visibleEmployeeAgents']>) => activeHost.visibleEmployeeAgents(...args);
export const readEmployeeScope = () => activeHost.readEmployeeScope();
export const isTeamScope = (value: string) => activeHost.isTeamScope(value);
export const useClientPagination = <T,>(items: T[], pageSize: number, resetKey: unknown) => activeHost.useClientPagination(items, pageSize, resetKey);
export const cn = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');
export const MENU_CONTENT_CLASS = '';
export const MENU_ITEM_CLASS = '';
export const MENU_ITEM_DANGER_CLASS = 'text-red-600';
export const MOBILE_CARD_CLASS = 'rounded-lg border border-neutral-200 bg-white p-4';
export const SELECT_TRIGGER_CLASS = '';

const componentDefaults: Record<string, HostComponent> = {
  AppHeader: DefaultAppHeader, ConfirmDialog: DefaultConfirmDialog, DataTable: DefaultDataTable, DetailField: DefaultDetailField, Dialog: DefaultDialog, DialogContent: DefaultDialogContent, DialogTitle: DefaultDialogTitle,
  DropdownMenu: DefaultDropdownMenu, DropdownMenuContent: DefaultDropdownContent, DropdownMenuItem: DefaultDropdownItem, DropdownMenuSeparator: DefaultDropdownSeparator, DropdownMenuTrigger: DefaultDropdownTrigger,
  Paginator: DefaultPaginator, ResourceImportDialog: DefaultResourceImportDialog, Select: DefaultSelect, SelectContent: DefaultSelectContent, SelectItem: DefaultSelectItem, SelectTrigger: DefaultSelectTrigger, SelectValue: DefaultSelectValue,
  StatusBadge: DefaultStatusBadge, UIButton: DefaultButton,
  Accordion: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  AccordionItem: ({ children, ...props }: any) => <details {...props}>{children}</details>,
  AccordionTrigger: ({ children, ...props }: any) => <summary {...props}>{children}</summary>,
  AccordionContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
};

function component(name: string): HostComponent {
  return (props: any) => { const host = useSkillsPageHost(); return createElement(host.components?.[name] || componentDefaults[name], props); };
}

export const AppHeader = component('AppHeader');
export const ConfirmDialog = component('ConfirmDialog');
export const DataTable = component('DataTable');
export const DetailField = component('DetailField');
export const Dialog = component('Dialog');
export const DialogContent = component('DialogContent');
export const DialogTitle = component('DialogTitle');
export const DropdownMenu = component('DropdownMenu');
export const DropdownMenuContent = component('DropdownMenuContent');
export const DropdownMenuItem = component('DropdownMenuItem');
export const DropdownMenuSeparator = component('DropdownMenuSeparator');
export const DropdownMenuTrigger = component('DropdownMenuTrigger');
export const Paginator = component('Paginator');
export const ResourceImportDialog = component('ResourceImportDialog');
export const Select = component('Select');
export const SelectContent = component('SelectContent');
export const SelectItem = component('SelectItem');
export const SelectTrigger = component('SelectTrigger');
export const SelectValue = component('SelectValue');
export const StatusBadge = component('StatusBadge');
export const UIButton = component('UIButton');
export const Accordion = component('Accordion');
export const AccordionItem = component('AccordionItem');
export const AccordionTrigger = component('AccordionTrigger');
export const AccordionContent = component('AccordionContent');

function icon(name: string): HostComponent { return (props: any) => { const host = useSkillsPageHost(); return createElement(host.icons?.[name] || DefaultHostIcon, { name, ...props }); }; }
export const IconAdd = icon('IconAdd');
export const IconChevronDown = icon('IconChevronDown');
export const IconClear = icon('IconClear');
export const IconClipboard = icon('IconClipboard');
export const IconEdit = icon('IconEdit');
export const IconHistory = icon('IconHistory');
export const IconMore = icon('IconMore');
export const IconRefresh = icon('IconRefresh');
export const IconSearch = icon('IconSearch');
export const IconSkill = icon('IconSkill');
export const IconTrash = icon('IconTrash');
export { SopVersionDetailDialog };
