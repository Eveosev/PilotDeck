import { beforeEach, expect, it, vi } from 'vitest';
import { authenticatedFetch } from '../../../utils/api';
import { createPublicApprovalClient, approvalInboxItem } from './public-approval-client';
vi.mock('../../../utils/api', () => ({ authenticatedFetch: vi.fn() }));
const request = vi.mocked(authenticatedFetch);
beforeEach(() => vi.clearAllMocks());
it('reads only the original pinned wait with independent approver login and request abort', async () => {
  const signal = new AbortController().signal;
  const status = { sessionId: 'session', revision: 4, state: {}, approval: { waitId: 'wait', revision: 4, skillId: 'sop', version: '1.2.3', nodeId: 'handoff', assigneeUserId: 'actual-user' } };
  request.mockResolvedValueOnce(new Response(JSON.stringify({ status })));
  const client = createPublicApprovalClient(() => 'approver-login');
  expect(approvalInboxItem(await client.status({ sessionKey: 'session', projectKey: 'project' }, { signal }))).toMatchObject(status.approval);
  expect(request).toHaveBeenCalledWith('/api/sop/status?sessionKey=session&projectKey=project', { headers: { 'X-StaffDeck-Approver-Authorization': 'Bearer approver-login' }, signal });
  expect(approvalInboxItem(null)).toBeNull();
});
it('posts original request/wait/revision once and accepts only matching receipt', async () => {
  const receipt = { accepted: true, duplicate: true, sessionId: 'session', requestId: 'request', revision: 5, message: 'approved' };
  request.mockResolvedValueOnce(new Response(JSON.stringify(receipt)));
  const client = createPublicApprovalClient(() => 'normal-login');
  const reply = { sessionKey: 'session', requestId: 'request', waitId: 'wait', expectedRevision: 4, message: 'approved' };
  expect(await client.resume(reply)).toEqual(receipt);
  expect(JSON.parse(String((request.mock.calls[0][1] as RequestInit)?.body))).toEqual({ ...reply, source: 'human' });
  expect((request.mock.calls[0][1] as RequestInit)?.headers).toEqual({ 'X-StaffDeck-Approver-Authorization': 'Bearer normal-login' });
  expect(request).toHaveBeenCalledTimes(1);
});
it('retains real HTTP error and never sends authority, management key or a missing approver login', async () => {
  const raw = '{"error":{"code":"SOP_APPROVAL_SESSION_MAPPING_UNAVAILABLE","message":"Unmapped"}}';
  request.mockResolvedValueOnce(new Response(raw, { status: 503 }));
  const client = createPublicApprovalClient(() => 'normal-login');
  await expect(client.status({ sessionKey: 'session' })).rejects.toMatchObject({ status: 503, code: 'SOP_APPROVAL_SESSION_MAPPING_UNAVAILABLE', body: raw });
  const missing = createPublicApprovalClient(() => '');
  await expect(missing.resume({ sessionKey: 'session', requestId: 'request', waitId: 'wait', expectedRevision: 2, message: 'yes' })).rejects.toThrow('normal StaffDeck approver');
  expect(request).toHaveBeenCalledTimes(1);
});
