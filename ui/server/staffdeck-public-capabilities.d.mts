/** Server-side public StaffDeck protocol types; credentials remain in the host transport. */
export type PublicOperationInput = {
  list_tools: {};
  list_general_skills: {};
  create_tool: { body: Record<string, unknown> };
  update_tool: { toolId: string; body: Record<string, unknown> };
  test_tool: { toolId: string; body: Record<string, unknown> };
  import_general_skill: { body: Record<string, unknown> };
  publish_general_skill: { slug: string };
  archive_general_skill: { slug: string };
  test_general_skill: { slug: string; body: Record<string, unknown> };
  generate_sop: { body: { title: string; raw_content: string; business_domain?: string | null; model_config_id?: string | null } };
  rewrite_saved_sop: { sopId: string; body: { instruction: string; target_paths?: string[]; model_config_id?: string | null; draft_id?: string | null }; dirty?: false };
  get_job: { jobId: string };
  get_job_result: { jobId: string };
  job_events: { jobId: string; lastEventId?: string | number };
  cancel_job: { jobId: string };
  preview_generate_sop: { body: {
    title: string; raw_content: string; business_domain?: string | null; model_config_id?: string | null;
    available_tools?: Record<string, unknown>[]; available_general_skills?: Record<string, unknown>[];
    available_knowledge_bases?: Record<string, unknown>[];
  } };
  preview_rewrite_sop: { sopId: string; body: {
    current_skill: Record<string, unknown> & { skill_id: string }; instruction: string;
    model_config_id?: string | null; target_path?: string; target_paths?: string[];
    target_label?: string | null; conversation?: Array<Record<string, string>>;
    available_tools?: Record<string, unknown>[]; available_sops?: Record<string, unknown>[];
  } };
  get_preview_job: { jobId: string };
  preview_job_events: { jobId: string; afterSeq?: number };
  cancel_preview_job: { jobId: string };
  move_to_draft_sop: { sopId: string };
  remove_sop: { sopId: string };
  sync_sop_from_overall: { sopId: string };
  promote_sop_to_overall: { sopId: string };
  delete_sop_version: { sopId: string; version: string };
  probe_unsaved_tool: { body: Record<string, unknown> };
  remove_tool: { toolId: string };
  extract_sop_text: { body: { filename: string; content_base64: string } };
  list_model_catalog: {};
  list_handoff_users: {};
};
export type PublicOperation = keyof PublicOperationInput;
export type PublicResponse<T = unknown> = { status: number; body: T; headers?: Headers | Record<string, string> };
export type PublicTransportPlan = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string;
  headers: Record<string, string>; body?: Record<string, unknown>;
  shape?: string; responseType?: 'event-stream'; signal?: AbortSignal;
};
export class PublicCapabilityError extends Error { code: string; status: number; }
export const PUBLIC_OPERATION_CONTRACTS: Readonly<Record<PublicOperation, readonly [string, string, string, string]>>;
export const PUBLIC_APPROVED_OPERATIONS: readonly PublicOperation[];
export const PUBLIC_PROTOCOL_BLOCKERS: Readonly<Record<string, string>>;
export function planPublicOperation<O extends PublicOperation>(agentId: string, operation: O, input: PublicOperationInput[O]): PublicTransportPlan;
export function createPublicCapabilityClient(options: {
  agentId: string;
  transport: (plan: PublicTransportPlan) => Promise<PublicResponse>;
  authorizedOperations?: readonly PublicOperation[];
}): {
  call<O extends PublicOperation>(operation: O, input: PublicOperationInput[O], options?: { signal?: AbortSignal }): Promise<PublicResponse>;
};
export type PublicSseEvent = { id?: string; event: string; data: string };
export type PreviewSseEvent = PublicSseEvent & { sequence?: number };
export function decodePublicJobEvents(chunks: AsyncIterable<Uint8Array | string>, options?: { signal?: AbortSignal }): AsyncIterable<PublicSseEvent>;
export function decodePreviewJobEvents(chunks: AsyncIterable<Uint8Array | string>, options?: { signal?: AbortSignal }): AsyncIterable<PreviewSseEvent>;
