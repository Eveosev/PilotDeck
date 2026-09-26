import { staffDeckCopyClient } from '../clients';

export type CopyAgent = { id: string; name: string; is_overall: boolean; active: boolean; copy_target: boolean; can_manage: boolean };

const AGENT_SCOPE_KEY = 'ultrarag_enterprise_agent_scope';
let targetAgentId = '';

export function readCopyAgentScope(): string {
  try { return window.localStorage.getItem(AGENT_SCOPE_KEY) || targetAgentId; } catch { return targetAgentId; }
}

export async function loadCopyDirectory(): Promise<CopyAgent[]> {
  const agents = await staffDeckCopyClient.call<CopyAgent[]>('list_agents');
  const target = agents.find((agent) => agent.copy_target && !agent.is_overall);
  if (!target) throw new Error('The StaffDeck copy target is not in the visible employee directory.');
  targetAgentId = target.id;
  const current = readCopyAgentScope();
  if (!agents.some((agent) => agent.id === current && !agent.is_overall)) {
    try { window.localStorage.setItem(AGENT_SCOPE_KEY, target.id); } catch {}
  }
  return agents;
}

export function isCopyTarget(agent: { id: string }): boolean {
  return Boolean(targetAgentId && agent.id === targetAgentId);
}
