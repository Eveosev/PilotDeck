import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import type { PublicApprovalBinding, PublicApprovalSessionResolver } from './publicApprovalBridge.js';
import type { AgentTranscriptEntry, SessionMetadataValue } from '../session/transcript/TranscriptEntry.js';

export function readNativeSessionAdmission(entries: readonly AgentTranscriptEntry[], sessionKey: string) {
  let admission: SessionMetadataValue['staffDeckAdmission'];
  for (const entry of entries) {
    if (entry.type !== 'session_metadata' || !entry.metadata.staffDeckAdmission) continue;
    if (entry.sessionId !== sessionKey || (entry.turnId !== 'host-admission' && !entry.metadata.isSnapshot)) return undefined;
    const next = entry.metadata.staffDeckAdmission;
    if (typeof next !== 'object' || !next || ![next.tenantId, next.agentId, next.pilotDeckUserId, next.projectKey]
      .every(value => typeof value === 'string' && value.trim().length > 0)) return undefined;
    if (admission && (admission.tenantId !== next.tenantId || admission.agentId !== next.agentId
      || admission.pilotDeckUserId !== next.pilotDeckUserId || admission.projectKey !== next.projectKey)) return undefined;
    admission = next;
  }
  return admission;
}

/** Read the original single-user installation authority without creating another ACL. */
export function readNativeInstallationOwner(databasePath: string): string | undefined {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    const rows = db.prepare('SELECT id FROM users WHERE is_active = 1').all();
    // Multiple active owners are outside the supported single-user authority.
    return rows.length === 1 ? String(rows[0]!.id) : undefined;
  } catch {
    return undefined;
  } finally { db?.close(); }
}

/** Join original owner, registered project/session catalog and that project's formal binding.
 * No external session ID, pending-wait scan, inferred approver or shadow mapping is used.
 */
export function createNativeApprovalSessionResolver(options: {
  readOwner(): string | undefined;
  listProjects(): Promise<string[]>;
  listSessions(projectKey: string): Promise<readonly { sessionId: string }[]>;
  sessionAdmission(projectKey: string, sessionKey: string): Promise<(PublicApprovalBinding & { projectKey: string }) | undefined>;
}): PublicApprovalSessionResolver {
  return async ({ sessionKey, projectKey, binding, signal }) => {
    signal?.throwIfAborted();
    if (options.readOwner() !== binding.pilotDeckUserId) return undefined;
    const projects = await options.listProjects();
    const selected = projectKey === undefined ? projects : projects.filter(key => resolve(key) === resolve(projectKey));
    const matches: string[] = [];
    for (const key of selected) {
      signal?.throwIfAborted();
      if (!(await options.listSessions(key)).some(session => session.sessionId === sessionKey)) continue;
      const actual = await options.sessionAdmission(key, sessionKey);
      if (!actual || actual.tenantId !== binding.tenantId || actual.agentId !== binding.agentId
        || actual.pilotDeckUserId !== binding.pilotDeckUserId || actual.projectKey !== key) continue;
      matches.push(key);
    }
    if (matches.length !== 1) return undefined;
    signal?.throwIfAborted();
    return { ...binding, sessionKey, projectKey: matches[0] };
  };
}
