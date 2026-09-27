import { staffDeckCopyClient } from '../clients';

export type CopyAgent = { id: string; tenant_id: string; name: string; is_overall: boolean; active: boolean; copy_target: boolean; can_manage: boolean };

const AGENT_SCOPE_KEY = 'ultrarag_enterprise_agent_scope';
let targetAgentId = '';
let targetTenantId = '';

export function readCopyTenant(): string {
  if (!targetTenantId) throw new Error('The StaffDeck target tenant has not been authenticated.');
  return targetTenantId;
}

export function readCopyAgentScope(): string {
  try { return window.localStorage.getItem(AGENT_SCOPE_KEY) || targetAgentId; } catch { return targetAgentId; }
}

export async function loadCopyDirectory(): Promise<CopyAgent[]> {
  const agents = await staffDeckCopyClient.call<CopyAgent[]>('list_agents');
  const target = agents.find((agent) => agent.copy_target && !agent.is_overall);
  if (!target) throw new Error('The StaffDeck copy target is not in the visible employee directory.');
  if (!target.tenant_id) throw new Error('The StaffDeck target directory omitted its tenant.');
  targetAgentId = target.id;
  targetTenantId = target.tenant_id;
  const current = readCopyAgentScope();
  if (!agents.some((agent) => agent.id === current && !agent.is_overall)) {
    try { window.localStorage.setItem(AGENT_SCOPE_KEY, target.id); } catch {}
  }
  return agents;
}

export function isCopyTarget(agent: { id: string }): boolean {
  return Boolean(targetAgentId && agent.id === targetAgentId);
}
