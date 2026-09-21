import { describe, expect, it } from 'vitest';
import { pilotDeckKnowledgePageHost } from './knowledge-host-adapter';

describe('PilotDeck Knowledge host authorization boundary', () => {
  it('does not grant overall administration to an authenticated non-admin user', () => {
    expect(pilotDeckKnowledgePageHost.isEnterpriseAdmin({ id: 'user-1', is_admin: false })).toBe(false);
    expect(pilotDeckKnowledgePageHost.canManageEmployeeAgent({ id: 'agent-1' }, { id: 'user-1', is_admin: false })).toBe(false);
  });

  it('uses the explicit single-user/admin identity supplied by the host', () => {
    expect(pilotDeckKnowledgePageHost.isEnterpriseAdmin({ id: 'user-1', is_admin: true })).toBe(true);
    expect(pilotDeckKnowledgePageHost.canManageEmployeeAgent({ id: 'agent-1' }, { id: 'user-1', is_admin: true })).toBe(true);
  });

  it('does not invent an employee directory when the module has no directory capability', async () => {
    await expect(pilotDeckKnowledgePageHost.loadEmployeeDirectory()).resolves.toEqual([]);
  });
});
