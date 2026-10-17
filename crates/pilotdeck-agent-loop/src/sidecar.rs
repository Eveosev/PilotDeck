//! In-process sidecar state machine. Transport (stdio / TCP) is layered on top.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::protocol::{parse_json_line, validate_module_message, Validation};
use crate::time::{now_iso, now_unix_ms, parse_iso_ms};
use crate::{CAPABILITIES_VERSION, MODULE_ID, PROTOCOL_VERSION};

const STUB_POLL_MS: u64 = 10;
const MAX_STUB_DELAY_MS: u64 = 60_000;
const DEFAULT_STUB_TEXT: &str = "What is the status?";
const DEFAULT_MODULE_CALL_TIMEOUT_MS: u64 = 2_000;
const STABLE_IDS_ENV: &str = "PILOTDECK_AGENT_LOOP_STABLE_IDS";
const STUB_PROVIDER: &str = "pilotdeck-stub";
const STUB_MODEL: &str = "pilotdeck-stub";

#[derive(Clone)]
struct OperationSnapshot {
    run_id: String,
    operation_id: String,
    state: String,
    outcome: Option<String>,
    request_ids: Vec<String>,
    cancel_requested: bool,
    updated_at: String,
}

impl OperationSnapshot {
    fn to_value(&self) -> Value {
        let mut payload = json!({
            "runId": self.run_id,
            "operationId": self.operation_id,
            "state": self.state,
            "requestIds": self.request_ids,
            "cancelRequested": self.cancel_requested,
            "updatedAt": self.updated_at,
        });
        if let Some(outcome) = &self.outcome {
            payload["outcome"] = json!(outcome);
        }
        payload
    }
}

struct ActiveExecution {
    run_id: String,
    request_id: String,
    cancel: Arc<AtomicBool>,
    deadline_exceeded: Arc<AtomicBool>,
}

struct Operations {
    by_id: HashMap<String, OperationSnapshot>,
    request_to_operation: HashMap<String, String>,
    active: HashMap<String, ActiveExecution>,
}

struct Inner {
    emit: Arc<dyn Fn(Value) + Send + Sync>,
    module_id: String,
    module_instance_id: String,
    connection_generation: String,
    capabilities_version: String,
    transport: String,
    /// Production TCP shared secret. `None` keeps loopback tests unauthenticated.
    tcp_auth_token: Option<String>,
    authenticated: AtomicBool,
    token: AtomicU64,
    operations: Mutex<Operations>,
    pending_calls: Mutex<HashMap<String, mpsc::Sender<Value>>>,
    joins: Mutex<Vec<JoinHandle<()>>>,
}

/// Module Protocol sidecar that speaks hello/capabilities/execute/cancel/status.
pub struct Sidecar {
    inner: Arc<Inner>,
}

impl Clone for Sidecar {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl Sidecar {
    pub fn new(emit: Arc<dyn Fn(Value) + Send + Sync>) -> Self {
        Self::with_transport(emit, "stdio")
    }

    pub fn with_transport(emit: Arc<dyn Fn(Value) + Send + Sync>, transport: &str) -> Self {
        Self::with_transport_and_auth(emit, transport, None)
    }

    /// `tcp_auth_token` is the production TCP hello secret. Empty means off.
    pub fn with_transport_and_auth(
        emit: Arc<dyn Fn(Value) + Send + Sync>,
        transport: &str,
        tcp_auth_token: Option<String>,
    ) -> Self {
        let token = AtomicU64::new(0);
        let module_instance_id = format!("{MODULE_ID}-instance-{}", next_token_from(&token));
        let connection_generation = format!("{}-{}", module_instance_id, next_token_from(&token));
        let tcp_auth_token = tcp_auth_token.filter(|value| !value.is_empty());
        let authenticated = AtomicBool::new(tcp_auth_token.is_none());
        Self {
            inner: Arc::new(Inner {
                emit,
                module_id: MODULE_ID.to_string(),
                module_instance_id,
                connection_generation,
                capabilities_version: CAPABILITIES_VERSION.to_string(),
                transport: transport.to_string(),
                tcp_auth_token,
                authenticated,
                token,
                operations: Mutex::new(Operations {
                    by_id: HashMap::new(),
                    request_to_operation: HashMap::new(),
                    active: HashMap::new(),
                }),
                pending_calls: Mutex::new(HashMap::new()),
                joins: Mutex::new(Vec::new()),
            }),
        }
    }

    pub fn module_id(&self) -> &str {
        &self.inner.module_id
    }

    pub fn module_instance_id(&self) -> &str {
        &self.inner.module_instance_id
    }

    pub fn connection_generation(&self) -> &str {
        &self.inner.connection_generation
    }

    pub fn handle_line(&self, line: &str) {
        if line.trim().is_empty() {
            return;
        }
        match parse_json_line(line) {
            Ok(value) => self.handle_value(value),
            Err(_) => self.emit_error("parse", "INVALID_JSON", "Module message is not valid JSON."),
        }
    }

    pub fn handle_value(&self, value: Value) {
        match validate_module_message(&value) {
            Validation::Ok => self.dispatch(value),
            Validation::Invalid { code, message } => self.emit_error("validation", code, &message),
        }
    }

    pub fn join(&self) {
        loop {
            let handles: Vec<JoinHandle<()>> = {
                let mut joins = self.inner.joins.lock().expect("joins lock");
                std::mem::take(&mut *joins)
            };
            if handles.is_empty() {
                break;
            }
            for handle in handles {
                let _ = handle.join();
            }
        }
    }

    fn dispatch(&self, value: Value) {
        let kind = value.get("kind").and_then(Value::as_str).unwrap_or("");
        if kind == "response" {
            if !self.inner.authenticated.load(Ordering::SeqCst) {
                return;
            }
            self.handle_host_response(value);
            return;
        }
        if kind != "request" {
            return;
        }
        let message_id = value.get("messageId").and_then(Value::as_str).unwrap_or("");
        let method = value.get("method").and_then(Value::as_str).unwrap_or("");
        if !self.allow_request(&value, method) {
            return;
        }
        match method {
            "hello" => self.emit(self.handshake(message_id, "hello", None)),
            "capabilities" => {
                self.emit(self.handshake(
                    message_id,
                    "capabilities",
                    Some(self.capabilities_payload()),
                ));
            }
            "execute" => self.handle_execute(value),
            "cancel" => self.handle_cancel(value),
            "status" => self.handle_status(value),
            "resume" => self.emit(control_failure(
                &self.next_id("resume"),
                message_id,
                "RESUME_UNSUPPORTED",
            )),
            "ack" => self.emit(control_failure(
                &self.next_id("ack"),
                message_id,
                "ACK_UNSUPPORTED",
            )),
            "module_call" => {
                let request_id = value.get("requestId").and_then(Value::as_str);
                self.emit(json!({
                    "kind": "response",
                    "messageId": self.next_id("module-call"),
                    "inReplyTo": message_id,
                    "requestId": request_id,
                    "ok": false,
                    "final": true,
                    "outcome": "failed",
                    "code": "UNEXPECTED_MODULE_CALL",
                }));
            }
            _ => self.emit_error(
                "validation",
                "INVALID_METHOD",
                "Module request method is invalid.",
            ),
        }
    }

    fn handle_host_response(&self, value: Value) {
        let in_reply_to = string_field(&value, "inReplyTo");
        if in_reply_to.is_empty() {
            return;
        }
        let sender = {
            let mut pending = self.inner.pending_calls.lock().expect("pending_calls lock");
            pending.remove(&in_reply_to)
        };
        if let Some(sender) = sender {
            let _ = sender.send(value);
        }
    }

    fn handle_execute(&self, request: Value) {
        let message_id = string_field(&request, "messageId");
        let run_id = string_field(&request, "runId");
        let operation_id = string_field(&request, "operationId");
        let request_id = string_field(&request, "requestId");

        {
            let ops = self.inner.operations.lock().expect("operations lock");
            if let Some(active) = ops.active.get(&operation_id) {
                let code = if active.run_id == run_id {
                    "OPERATION_ALREADY_ACTIVE"
                } else {
                    "OPERATION_IDENTITY_MISMATCH"
                };
                self.emit(json!({
                    "kind": "response",
                    "messageId": self.next_id("execute-rejected"),
                    "inReplyTo": message_id,
                    "requestId": request_id,
                    "ok": false,
                    "code": code,
                }));
                return;
            }
            if let Some(existing) = ops.by_id.get(&operation_id) {
                if existing.run_id != run_id {
                    self.emit(json!({
                        "kind": "response",
                        "messageId": self.next_id("execute-rejected"),
                        "inReplyTo": message_id,
                        "requestId": request_id,
                        "ok": false,
                        "code": "OPERATION_RUN_MISMATCH",
                    }));
                    return;
                }
            }
        }

        let deadline_at_ms = earliest_deadline_ms(&request);
        if deadline_at_ms.is_some_and(|deadline| deadline <= now_unix_ms()) {
            self.accept_operation(&run_id, &operation_id, &request_id);
            self.record_final(&operation_id, &request_id, "failed");
            self.emit(json!({
                "kind": "response",
                "messageId": self.next_id("deadline"),
                "inReplyTo": message_id,
                "requestId": request_id,
                "ok": false,
                "final": true,
                "outcome": "failed",
                "code": "DEADLINE_EXCEEDED",
            }));
            return;
        }

        self.accept_operation(&run_id, &operation_id, &request_id);
        let cancel = Arc::new(AtomicBool::new(false));
        let deadline_exceeded = Arc::new(AtomicBool::new(false));
        {
            let mut ops = self.inner.operations.lock().expect("operations lock");
            ops.active.insert(
                operation_id.clone(),
                ActiveExecution {
                    run_id: run_id.clone(),
                    request_id: request_id.clone(),
                    cancel: Arc::clone(&cancel),
                    deadline_exceeded: Arc::clone(&deadline_exceeded),
                },
            );
        }

        let stream_id = self.next_id("stream");
        self.emit(json!({
            "kind": "response",
            "messageId": self.next_id("accepted"),
            "inReplyTo": message_id,
            "requestId": request_id,
            "ok": true,
            "streamId": stream_id,
            "cursor": 0,
        }));

        let inner = Arc::clone(&self.inner);
        let payload = request.get("payload").cloned().unwrap_or_else(|| json!({}));
        let session_id = stub_session_id(&request, &payload, &run_id);
        let turn_id = stub_turn_id(&request, &payload, &operation_id);
        let started_at = now_iso();
        let handle = thread::spawn(move || {
            run_stub_execute(StubJob {
                inner,
                run_id,
                operation_id,
                request_id,
                session_id,
                turn_id,
                started_at,
                stream_id,
                payload,
                cancel,
                deadline_exceeded,
                deadline_at_ms,
            });
        });
        self.inner.joins.lock().expect("joins lock").push(handle);
    }

    fn handle_cancel(&self, request: Value) {
        let message_id = string_field(&request, "messageId");
        let run_id = string_field(&request, "runId");
        let operation_id = string_field(&request, "operationId");
        let request_id = request
            .get("requestId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let reason = string_field(&request, "reason");

        let mut ops = self.inner.operations.lock().expect("operations lock");
        let identity_matches = ops.active.get(&operation_id).is_some_and(|active| {
            active.run_id == run_id
                && request_id
                    .as_deref()
                    .is_none_or(|id| active.request_id == id)
        });
        if identity_matches {
            if let Some(active) = ops.active.get(&operation_id) {
                if reason == format!("timeout:{run_id}") {
                    active.deadline_exceeded.store(true, Ordering::SeqCst);
                }
                active.cancel.store(true, Ordering::SeqCst);
            }
            if let Some(snapshot) = ops.by_id.get_mut(&operation_id) {
                if snapshot.outcome.is_none() {
                    snapshot.cancel_requested = true;
                    snapshot.state = "cancel_requested".to_string();
                    snapshot.updated_at = now_iso();
                }
            }
            self.emit(cancel_response(
                self.next_id("cancel"),
                &message_id,
                request_id.as_deref(),
                true,
                json!({ "payload": { "operationId": operation_id, "cancelled": true } }),
            ));
        } else {
            let code = if ops.active.contains_key(&operation_id) {
                "OPERATION_IDENTITY_MISMATCH"
            } else {
                "UNKNOWN_OPERATION"
            };
            self.emit(cancel_response(
                self.next_id("cancel"),
                &message_id,
                request_id.as_deref(),
                false,
                json!({ "code": code }),
            ));
        }
    }

    fn handle_status(&self, request: Value) {
        let message_id = string_field(&request, "messageId");
        let request_id = string_field(&request, "requestId");
        let ops = self.inner.operations.lock().expect("operations lock");
        let snapshot = ops
            .request_to_operation
            .get(&request_id)
            .and_then(|operation_id| ops.by_id.get(operation_id))
            .cloned();
        match snapshot {
            Some(snapshot) => self.emit(json!({
                "kind": "response",
                "messageId": self.next_id("status"),
                "inReplyTo": message_id,
                "requestId": request_id,
                "ok": true,
                "payload": snapshot.to_value(),
            })),
            None => self.emit(json!({
                "kind": "response",
                "messageId": self.next_id("status"),
                "inReplyTo": message_id,
                "requestId": request_id,
                "ok": false,
                "code": "UNKNOWN_REQUEST",
            })),
        }
    }

    fn accept_operation(&self, run_id: &str, operation_id: &str, request_id: &str) {
        let mut ops = self.inner.operations.lock().expect("operations lock");
        ops.request_to_operation
            .insert(request_id.to_string(), operation_id.to_string());
        if let Some(existing) = ops.by_id.get_mut(operation_id) {
            if !existing.request_ids.iter().any(|id| id == request_id) {
                existing.request_ids.push(request_id.to_string());
            }
            if existing.state == "pending" {
                existing.state = "running".to_string();
            }
            existing.updated_at = now_iso();
            return;
        }
        ops.by_id.insert(
            operation_id.to_string(),
            OperationSnapshot {
                run_id: run_id.to_string(),
                operation_id: operation_id.to_string(),
                state: "running".to_string(),
                outcome: None,
                request_ids: vec![request_id.to_string()],
                cancel_requested: false,
                updated_at: now_iso(),
            },
        );
    }

    fn record_final(&self, operation_id: &str, request_id: &str, outcome: &str) {
        record_final_locked(
            &mut self.inner.operations.lock().expect("operations lock"),
            operation_id,
            request_id,
            outcome,
        );
    }

    /// Production TCP auth uses the existing hello payload, same comparison as
    /// Gateway `hello.token`. Unset token keeps the current open loopback path.
    fn allow_request(&self, value: &Value, method: &str) -> bool {
        let Some(expected) = &self.inner.tcp_auth_token else {
            return true;
        };
        if self.inner.authenticated.load(Ordering::SeqCst) {
            return true;
        }
        if method != "hello" {
            self.emit_error(
                "auth",
                "UNAUTHENTICATED",
                "TCP sidecar requires an authenticated hello.",
            );
            return false;
        }
        let provided = value
            .pointer("/payload/token")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !constant_time_eq(expected, provided) {
            let message_id = value.get("messageId").and_then(Value::as_str).unwrap_or("");
            self.emit(json!({
                "kind": "response",
                "messageId": self.next_id("hello"),
                "inReplyTo": message_id,
                "ok": false,
                "code": "UNAUTHENTICATED",
            }));
            return false;
        }
        self.inner.authenticated.store(true, Ordering::SeqCst);
        true
    }

    fn handshake(&self, in_reply_to: &str, method: &str, payload: Option<Value>) -> Value {
        json!({
            "kind": "response",
            "messageId": self.next_id(method),
            "inReplyTo": in_reply_to,
            "ok": true,
            "protocolVersion": PROTOCOL_VERSION,
            "moduleId": self.inner.module_id,
            "moduleInstanceId": self.inner.module_instance_id,
            "connectionGeneration": self.inner.connection_generation,
            "capabilitiesVersion": self.inner.capabilities_version,
            "payload": payload.unwrap_or_else(|| json!({})),
        })
    }

    fn capabilities_payload(&self) -> Value {
        json!({
            "capabilitiesVersion": self.inner.capabilities_version,
            "transport": self.inner.transport,
            "methods": [
                {
                    "name": "execute",
                    "enabled": true,
                    "profiles": ["streaming"],
                    "cancel": true,
                    "resumeSupport": "none",
                    "retry": "retry_after_status"
                },
                { "name": "cancel", "enabled": true },
                { "name": "status", "enabled": true },
                { "name": "resume", "enabled": false },
                { "name": "ack", "enabled": false }
            ],
        })
    }

    fn emit(&self, message: Value) {
        (self.inner.emit)(message);
    }

    fn emit_error(&self, prefix: &str, code: &str, message: &str) {
        self.emit(json!({
            "kind": "error",
            "messageId": self.next_id(prefix),
            "code": code,
            "message": message,
            "retryability": "unsafe",
        }));
    }

    fn next_id(&self, prefix: &str) -> String {
        format!("{prefix}-{}", next_token_from(&self.inner.token))
    }
}

struct StubJob {
    inner: Arc<Inner>,
    run_id: String,
    operation_id: String,
    request_id: String,
    session_id: String,
    turn_id: String,
    started_at: String,
    stream_id: String,
    payload: Value,
    cancel: Arc<AtomicBool>,
    deadline_exceeded: Arc<AtomicBool>,
    deadline_at_ms: Option<i64>,
}

enum HostCall {
    Ok(Value),
    Failed(Value),
    Timeout,
    Interrupted,
}

fn run_stub_execute(job: StubJob) {
    let delay = stub_delay_ms(&job.payload);
    let mut sequence: u64 = 0;
    let cancelled_during_delay = sleep_cancellable(
        delay,
        &job.cancel,
        &job.deadline_exceeded,
        job.deadline_at_ms,
    );
    if cancelled_during_delay {
        emit_cancelled_terminal(&job, sequence);
        return;
    }

    let mut conversation = conversation_from_payload(&job.payload);
    let mut timeline = TurnTimeline::new(&job.turn_id);
    let first_request = match build_model_request(&job, &conversation) {
        Ok(request) => request,
        Err(other) => {
            finish_host_call(&job, sequence, other);
            return;
        }
    };
    if !emit_context_budget_if_advertised(&job, &first_request, &mut sequence) {
        return;
    }
    let first = match call_host_model(&job, &first_request, &mut sequence) {
        Ok(assembled) => assembled,
        Err(other) => {
            finish_host_call(&job, sequence, other);
            return;
        }
    };
    if first.tool_calls.is_empty() {
        let content = assembled_message_content(&first);
        if !emit_text_only_turn(&job, &content, &mut sequence) {
            return;
        }
        emit_completed(
            &job,
            sequence,
            1,
            json!([{ "role": "assistant", "content": content }]),
        );
        return;
    }

    let mut transcript = Vec::new();
    if !run_tool_calls(
        &job,
        &mut conversation,
        &first,
        &mut sequence,
        &mut transcript,
        &mut timeline,
    ) {
        return;
    }
    if !emit_turn_continued(&job, &mut sequence) {
        return;
    }
    let second_request = match build_model_request(&job, &conversation) {
        Ok(request) => request,
        Err(other) => {
            finish_host_call(&job, sequence, other);
            return;
        }
    };
    if !emit_context_budget_if_advertised(&job, &second_request, &mut sequence) {
        return;
    }
    let second = match call_host_model(&job, &second_request, &mut sequence) {
        Ok(assembled) => assembled,
        Err(other) => {
            finish_host_call(&job, sequence, other);
            return;
        }
    };
    if !second.tool_calls.is_empty() {
        emit_failed_terminal(
            &job,
            sequence,
            "UNEXPECTED_SECOND_TURN_TOOL_CALLS",
            "Second-round model response included tool calls.",
        );
        return;
    }
    let content = assembled_message_content(&second);
    if stub_interrupted(&job) {
        emit_cancelled_terminal(&job, sequence);
        return;
    }
    emit_stub_event(
        &job,
        "event",
        "agent.assistant_message",
        sequence,
        json!({
            "type": "assistant_message",
            "sessionId": job.session_id,
            "turnId": job.turn_id,
            "message": {
                "role": "assistant",
                "content": content.clone(),
            },
        }),
    );
    sequence += 1;
    if stub_interrupted(&job) {
        emit_cancelled_terminal(&job, sequence);
        return;
    }
    transcript.push(json!({
        "role": "assistant",
        "content": content,
    }));
    emit_completed(&job, sequence, 2, Value::Array(transcript));
}

fn finish_host_call(job: &StubJob, sequence: u64, result: HostCall) {
    match result {
        HostCall::Interrupted => emit_cancelled_terminal(job, sequence),
        HostCall::Timeout => emit_failed_terminal(
            job,
            sequence,
            "MODULE_CALL_TIMEOUT",
            "Host module_call timed out.",
        ),
        HostCall::Failed(response) => {
            let code = response
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("MODULE_CALL_FAILED");
            let message = host_failed_message(&response);
            emit_failed_terminal(job, sequence, code, message);
        }
        HostCall::Ok(_) => {}
    }
}

fn host_failed_message(response: &Value) -> &str {
    response
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("Host module_call failed.")
}

fn host_call_error_message(result: &HostCall) -> String {
    match result {
        HostCall::Timeout => "Host module_call timed out.".to_string(),
        HostCall::Failed(response) => host_failed_message(response).to_string(),
        _ => "Tool execution did not produce a result.".to_string(),
    }
}

/// TS `createMissingToolResult` (`src/agent/loop/ensureToolResultPairing.ts`)
/// used by `src/agent/loop/AgentLoop.ts:1962-1971`. Projected `isError` is
/// `result.type === "error"` (`src/tool/protocol/result.ts:66`).
///
/// Content / `metadata.recovery` / timestamps follow `buildToolErrorRecovery`
/// (`src/tool/execution/errorRecovery.ts`). `error.message` stays the raw
/// host/timeout text (same as TS `error.message`).
fn missing_tool_result(job: &StubJob, tool_call_id: &str, tool_name: &str, message: &str) -> Value {
    let timestamp = now_iso();
    let recovery = crate::error_recovery::build_tool_error_recovery(
        "tool_execution_failed",
        tool_name,
        message,
        &recovery_cwd(&job.payload),
        &permission_mode(&job.payload),
    );
    json!({
        "type": "error",
        "toolCallId": tool_call_id,
        "toolName": tool_name,
        "error": {
            "code": "tool_execution_failed",
            "message": message,
        },
        "content": [{ "type": "text", "text": recovery.message }],
        "metadata": {
            "recovery": recovery.advice.to_json(),
        },
        "startedAt": timestamp,
        "completedAt": timestamp,
    })
}

fn emit_tool_result_event(job: &StubJob, sequence: &mut u64, result: &Value) {
    emit_stub_event(
        job,
        "event",
        "agent.tool_result",
        *sequence,
        json!({
            "type": "tool_result",
            "sessionId": job.session_id,
            "turnId": job.turn_id,
            "result": result,
        }),
    );
    *sequence += 1;
}

fn text_content_blocks(text: &str) -> Value {
    json!([text_content_block(text, None)])
}

fn thinking_content_block(
    text: &str,
    block_id: Option<&str>,
    signature: Option<&str>,
    reasoning_content: &str,
) -> Value {
    let mut block = json!({ "type": "thinking", "text": text });
    if let Some(block_id) = block_id.filter(|id| !id.is_empty()) {
        block["blockId"] = json!(block_id);
    }
    // Last non-empty signature only. Do not persist or invent an empty one.
    if let Some(signature) = signature.filter(|value| !value.is_empty()) {
        block["signature"] = json!(signature);
    }
    if !reasoning_content.is_empty() {
        block["reasoningContent"] = json!(reasoning_content);
    }
    block
}

fn durable_thinking_present(model: &AssembledModel) -> bool {
    !model.thinking.is_empty()
        || !model.thinking_reasoning_content.is_empty()
        || model.thinking_signature.is_some()
}

fn durable_thinking_block(model: &AssembledModel) -> Value {
    thinking_content_block(
        &model.thinking,
        model.thinking_block_id.as_deref(),
        model.thinking_signature.as_deref(),
        &model.thinking_reasoning_content,
    )
}

/// Durable assistant content. A pull-stream thinking block reuses the id from
/// the `thinking_delta` events so the host can project `assistant_block`
/// (`streamState: closed`) instead of leaving the thinking stream open.
fn assembled_message_content(model: &AssembledModel) -> Vec<Value> {
    let mut blocks = Vec::new();
    if durable_thinking_present(model) {
        blocks.push(durable_thinking_block(model));
    }
    if !model.text.is_empty() || blocks.is_empty() {
        blocks.push(text_content_block(
            &model.text,
            model.text_block_id.as_deref(),
        ));
    }
    blocks
}

/// Durable text block. `block_id` is set only after incremental `text_delta`
/// events were already emitted, so the host timeline can project
/// `assistant_block` instead of a second `assistant_text_delta`.
fn text_content_block(text: &str, block_id: Option<&str>) -> Value {
    let mut block = json!({ "type": "text", "text": text });
    if let Some(block_id) = block_id.filter(|id| !id.is_empty()) {
        block["blockId"] = json!(block_id);
    }
    block
}

fn emit_text_only_turn(job: &StubJob, content: &[Value], sequence: &mut u64) -> bool {
    emit_stub_event(
        job,
        "event",
        "agent.assistant_message",
        *sequence,
        json!({
            "type": "assistant_message",
            "sessionId": job.session_id,
            "turnId": job.turn_id,
            "message": {
                "role": "assistant",
                "content": content,
            },
        }),
    );
    *sequence += 1;
    if stub_interrupted(job) {
        emit_cancelled_terminal(job, *sequence);
        return false;
    }
    true
}

fn run_tool_calls(
    job: &StubJob,
    conversation: &mut Value,
    first: &AssembledModel,
    sequence: &mut u64,
    transcript: &mut Vec<Value>,
    timeline: &mut TurnTimeline,
) -> bool {
    let calls = &first.tool_calls;
    let mut assistant_blocks = Vec::new();
    if durable_thinking_present(first) {
        let mut block = durable_thinking_block(first);
        block["timeline"] = timeline.update("thinking:pre-tool");
        assistant_blocks.push(block);
    }
    if !first.text.is_empty() {
        let mut block = text_content_block(&first.text, first.text_block_id.as_deref());
        block["timeline"] = timeline.update("text:pre-tool");
        assistant_blocks.push(block);
    }
    for call in calls {
        let tool_call_id = call.get("id").and_then(Value::as_str).unwrap_or("");
        let tool_name = call.get("name").and_then(Value::as_str).unwrap_or("");
        let tool_input = call.get("input").cloned().unwrap_or(json!({}));
        assistant_blocks.push(tool_call_block(
            call,
            tool_call_id,
            tool_name,
            &tool_input,
            timeline,
        ));
    }
    let assistant_call = json!({
        "role": "assistant",
        "content": assistant_blocks,
        "metadata": { "model": model_from_payload(&job.payload) },
    });
    // TS AgentLoop.ts:1384-1386 — yield assistant_message, then onDurableMessage.
    emit_stub_event(
        job,
        "event",
        "agent.assistant_message",
        *sequence,
        json!({
            "type": "assistant_message",
            "sessionId": job.session_id,
            "turnId": job.turn_id,
            "message": assistant_call,
        }),
    );
    *sequence += 1;
    if stub_interrupted(job) {
        emit_cancelled_terminal(job, *sequence);
        return false;
    }

    let detected_calls: Vec<Value> = calls
        .iter()
        .map(|call| {
            let id = call.get("id").cloned().unwrap_or(Value::Null);
            let timeline_id = format!("tool:{}", id.as_str().unwrap_or(""));
            json!({
                "id": id,
                "name": call.get("name").cloned().unwrap_or(Value::Null),
                "input": call.get("input").cloned().unwrap_or(json!({})),
                "timeline": timeline.position(&timeline_id),
            })
        })
        .collect();
    emit_stub_event(
        job,
        "event",
        "agent.tool_calls_detected",
        *sequence,
        json!({
            "type": "tool_calls_detected",
            "sessionId": job.session_id,
            "turnId": job.turn_id,
            "calls": detected_calls,
        }),
    );
    *sequence += 1;
    if stub_interrupted(job) {
        emit_cancelled_terminal(job, *sequence);
        return false;
    }

    let mut result_blocks = Vec::new();
    let mut call_iter = calls.iter();
    while let Some(call) = call_iter.next() {
        let tool_call_id = call.get("id").and_then(Value::as_str).unwrap_or("");
        let tool_name = call.get("name").and_then(Value::as_str).unwrap_or("");
        let tool_input = call.get("input").cloned().unwrap_or(json!({}));
        let capability = match call_host_module(
            job,
            "capability",
            json!({
                "operation": "execute",
                "toolCallId": tool_call_id,
                "name": tool_name,
                "arguments": tool_input,
            }),
        ) {
            HostCall::Ok(response) => response,
            HostCall::Interrupted => {
                emit_cancelled_terminal(job, *sequence);
                return false;
            }
            other => {
                // TS src/agent/loop/AgentLoop.ts fail fill:
                //   :1962-1971 catch → createMissingToolResult
                //   :1989-1995 ensureToolResultPairing
                // Emit tool_result first (:2029), then projectToolResults (:2032)
                // and tool_results_projected (:2070-2071). :1961-1995 does not
                // include projected (QA G5: isError tool_result before projected).
                //
                // Known-diff (T-P1-03-FU-B A1 / #28 R1 m-1):
                // TS `executeAll` is whole-batch. A thrown error in the catch
                // maps *every* toolCall to `createMissingToolResult`, so a
                // mixed batch becomes `[error, error]` even if an earlier
                // tool already succeeded inside the batch.
                // Rust walks `capability.execute` sequentially. An ok-then-fail
                // batch keeps the earlier success and only synthesizes the
                // failing / remaining calls: `[success, error]`.
                // fail-then-unstarted still fills every outstanding call
                // (same shape as TS). Lock the Rust semantics with the
                // ok-then-fail unit test; do not silently match TS here.
                if stub_interrupted(job) {
                    emit_cancelled_terminal(job, *sequence);
                    return false;
                }
                let message = host_call_error_message(&other);
                for outstanding in std::iter::once(call).chain(call_iter) {
                    let outstanding_id =
                        outstanding.get("id").and_then(Value::as_str).unwrap_or("");
                    let outstanding_name = outstanding
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let result =
                        missing_tool_result(job, outstanding_id, outstanding_name, &message);
                    emit_tool_result_event(job, sequence, &result);
                    if stub_interrupted(job) {
                        emit_cancelled_terminal(job, *sequence);
                        return false;
                    }
                    result_blocks.push(tool_result_block(&result, outstanding_id, timeline));
                }
                break;
            }
        };
        if stub_interrupted(job) {
            emit_cancelled_terminal(job, *sequence);
            return false;
        }
        let result = capability_result(&capability, tool_call_id, tool_name);
        emit_tool_result_event(job, sequence, &result);
        if stub_interrupted(job) {
            emit_cancelled_terminal(job, *sequence);
            return false;
        }
        result_blocks.push(tool_result_block(&result, tool_call_id, timeline));
    }
    let user_result = json!({
        "role": "user",
        "content": result_blocks,
    });
    // TS AgentLoop.ts:2032 projectToolResults; :2070-2071 yield tool_results_projected.
    emit_stub_event(
        job,
        "event",
        "agent.tool_results_projected",
        *sequence,
        json!({
            "type": "tool_results_projected",
            "sessionId": job.session_id,
            "turnId": job.turn_id,
            "message": user_result,
        }),
    );
    *sequence += 1;
    if stub_interrupted(job) {
        emit_cancelled_terminal(job, *sequence);
        return false;
    }
    append_conversation(conversation, assistant_call.clone());
    append_conversation(conversation, user_result.clone());
    transcript.push(assistant_call);
    transcript.push(user_result);
    true
}

struct TurnTimeline {
    turn_id: String,
    next_order: u64,
    revision: u64,
    previous_id: Option<String>,
    positions: HashMap<String, Value>,
}

impl TurnTimeline {
    fn new(turn_id: &str) -> Self {
        Self {
            turn_id: turn_id.to_string(),
            next_order: 0,
            revision: 0,
            previous_id: None,
            positions: HashMap::new(),
        }
    }

    /// TS `TurnTimeline.position`: reuse the slot for a stable id.
    fn position(&mut self, id: &str) -> Value {
        if let Some(existing) = self.positions.get(id) {
            return existing.clone();
        }
        self.revision += 1;
        let order = self.next_order;
        self.next_order += 1;
        let position = if let Some(previous) = &self.previous_id {
            json!({
                "version": 1,
                "turnId": self.turn_id,
                "id": id,
                "previousId": previous,
                "order": order,
                "revision": self.revision,
            })
        } else {
            json!({
                "version": 1,
                "turnId": self.turn_id,
                "id": id,
                "order": order,
                "revision": self.revision,
            })
        };
        self.previous_id = Some(id.to_string());
        self.positions.insert(id.to_string(), position.clone());
        position
    }

    /// TS `TurnTimeline.update`: same coordinates, bumped revision.
    fn update(&mut self, id: &str) -> Value {
        let mut next = self.position(id);
        self.revision += 1;
        next["revision"] = json!(self.revision);
        self.positions.insert(id.to_string(), next.clone());
        next
    }
}

fn emit_turn_continued(job: &StubJob, sequence: &mut u64) -> bool {
    emit_stub_event(
        job,
        "event",
        "agent.turn_continued",
        *sequence,
        json!({
            "type": "turn_continued",
            "sessionId": job.session_id,
            "turnId": job.turn_id,
            "reason": "next_turn",
        }),
    );
    *sequence += 1;
    if stub_interrupted(job) {
        emit_cancelled_terminal(job, *sequence);
        return false;
    }
    true
}

fn host_advertises_budget(payload: &Value) -> bool {
    match payload.pointer("/hostModules/budget") {
        Some(Value::Bool(true)) => true,
        Some(Value::Object(object)) => {
            object
                .get("methods")
                .and_then(Value::as_array)
                .is_some_and(|methods| {
                    methods
                        .iter()
                        .any(|method| method.as_str() == Some("evaluate_request_budget"))
                })
                || object.contains_key("evaluate_request_budget")
                || !object.is_empty()
        }
        Some(Value::Array(methods)) => methods
            .iter()
            .any(|method| method.as_str() == Some("evaluate_request_budget")),
        _ => false,
    }
}

fn host_advertises_context(payload: &Value) -> bool {
    match payload.pointer("/hostModules/context") {
        Some(Value::Bool(true)) => true,
        Some(Value::Object(object)) => {
            object
                .get("methods")
                .and_then(Value::as_array)
                .is_some_and(|methods| {
                    methods
                        .iter()
                        .any(|method| method.as_str() == Some("prepare_for_model"))
                })
                || object.contains_key("prepare_for_model")
                || !object.is_empty()
        }
        Some(Value::Array(methods)) => methods
            .iter()
            .any(|method| method.as_str() == Some("prepare_for_model")),
        _ => false,
    }
}

fn emit_context_budget_if_advertised(job: &StubJob, request: &Value, sequence: &mut u64) -> bool {
    if !host_advertises_budget(&job.payload) {
        return true;
    }
    let max_context_tokens = job
        .payload
        .pointer("/agent/maxContextTokens")
        .and_then(Value::as_u64)
        .unwrap_or(128_000);
    let reserved_output_tokens = job
        .payload
        .pointer("/agent/maxOutputTokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let budget = match call_host_module(
        job,
        "budget",
        json!({
            "operation": "evaluate_request_budget",
            "request": request,
            "options": {
                "maxContextTokens": max_context_tokens,
                "reservedOutputTokens": reserved_output_tokens,
            },
        }),
    ) {
        HostCall::Ok(response) => response,
        other => {
            finish_host_call(job, *sequence, other);
            return false;
        }
    };
    if stub_interrupted(job) {
        emit_cancelled_terminal(job, *sequence);
        return false;
    }
    let snapshot = budget
        .pointer("/payload/snapshot")
        .cloned()
        .or_else(|| budget.get("payload").cloned())
        .unwrap_or(json!({}));
    emit_stub_event(
        job,
        "event",
        "agent.context_budget",
        *sequence,
        json!({
            "type": "context_budget",
            "sessionId": job.session_id,
            "turnId": job.turn_id,
            "snapshot": snapshot,
        }),
    );
    *sequence += 1;
    true
}

fn model_from_payload(payload: &Value) -> String {
    first_nonempty_id(&[
        payload.get("modelOverride"),
        payload.pointer("/agent/model"),
        payload.pointer("/hostModules/model/model"),
    ])
    .unwrap_or_else(|| STUB_MODEL.to_string())
}

fn tool_call_block(
    call: &Value,
    tool_call_id: &str,
    tool_name: &str,
    tool_input: &Value,
    timeline: &mut TurnTimeline,
) -> Value {
    let mut block = json!({
        "type": "tool_call",
        "id": tool_call_id,
        "name": tool_name,
        "input": tool_input,
        "timeline": timeline.update(&format!("tool:{tool_call_id}")),
    });
    if let Some(raw) = call.get("raw") {
        block["raw"] = raw.clone();
    }
    block
}

fn tool_result_block(result: &Value, tool_call_id: &str, timeline: &mut TurnTimeline) -> Value {
    // TS src/tool/protocol/result.ts:66 — isError only when result.type === "error".
    // An `error` field without `type` must not set isError (FU-B A3 / #28 m-3).
    let is_error = result.get("type").and_then(Value::as_str) == Some("error");
    let mut block = json!({
        "type": "tool_result",
        "toolCallId": tool_call_id,
        "content": result.get("content").cloned().unwrap_or_else(|| json!([])),
        "timeline": timeline.update(&format!("result:{tool_call_id}")),
        "raw": sanitize_tool_result_raw(result),
    });
    if is_error {
        block["isError"] = json!(true);
    }
    block
}

fn emit_completed(job: &StubJob, sequence: u64, turns: u64, messages: Value) {
    record_final_locked(
        &mut job.inner.operations.lock().expect("operations lock"),
        &job.operation_id,
        &job.request_id,
        "completed",
    );
    (job.inner.emit)(json!({
        "kind": "event",
        "messageId": next_id(&job.inner, "final"),
        "eventType": "agent.execute.completed",
        "streamId": job.stream_id,
        "sequence": sequence,
        "runId": job.run_id,
        "operationId": job.operation_id,
        "requestId": job.request_id,
        "final": true,
        "outcome": "completed",
        "payload": {
            "result": stub_turn_result(
                "success",
                &job.session_id,
                &job.turn_id,
                "completed",
                turns,
                &job.started_at,
            ),
            "messages": messages,
            "stub": { "model": STUB_MODEL }
        },
    }));
    clear_active(job);
}

fn call_host_module(job: &StubJob, module: &str, payload: Value) -> HostCall {
    let message_id = next_id(&job.inner, "module-call");
    let (sender, receiver) = mpsc::channel();
    {
        let mut pending = job.inner.pending_calls.lock().expect("pending_calls lock");
        pending.insert(message_id.clone(), sender);
    }
    (job.inner.emit)(json!({
        "kind": "request",
        "messageId": message_id,
        "method": "module_call",
        "runId": job.run_id,
        "operationId": job.operation_id,
        "requestId": job.request_id,
        "module": module,
        "payload": payload,
    }));
    let timeout = Duration::from_millis(module_call_timeout_ms(&job.payload));
    let started = Instant::now();
    loop {
        if stub_interrupted(job) {
            job.inner
                .pending_calls
                .lock()
                .expect("pending_calls lock")
                .remove(&message_id);
            return HostCall::Interrupted;
        }
        let remaining = timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            job.inner
                .pending_calls
                .lock()
                .expect("pending_calls lock")
                .remove(&message_id);
            return HostCall::Timeout;
        }
        match receiver.recv_timeout(remaining.min(Duration::from_millis(STUB_POLL_MS))) {
            Ok(response) => {
                if response.get("ok").and_then(Value::as_bool) == Some(true) {
                    return HostCall::Ok(response);
                }
                return HostCall::Failed(response);
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return HostCall::Timeout,
        }
    }
}

fn emit_stub_event(job: &StubJob, prefix: &str, event_type: &str, sequence: u64, payload: Value) {
    (job.inner.emit)(json!({
        "kind": "event",
        "messageId": next_id(&job.inner, prefix),
        "eventType": event_type,
        "streamId": job.stream_id,
        "sequence": sequence,
        "runId": job.run_id,
        "operationId": job.operation_id,
        "requestId": job.request_id,
        "final": false,
        "payload": payload,
    }));
}

fn stub_interrupted(job: &StubJob) -> bool {
    job.cancel.load(Ordering::SeqCst)
        || runtime_deadline_exceeded(job.deadline_at_ms, &job.deadline_exceeded)
}

fn emit_cancelled_terminal(job: &StubJob, sequence: u64) {
    let (outcome, event_type, code, error) = if job.deadline_exceeded.load(Ordering::SeqCst) {
        (
            "result_unknown",
            "agent.execute.result_unknown",
            Some("DEADLINE_EXCEEDED"),
            Some(json!({
                "code": "DEADLINE_EXCEEDED",
                "message": "Module execution deadline exceeded.",
            })),
        )
    } else {
        ("cancelled", "agent.execute.cancelled", None, None)
    };
    record_final_locked(
        &mut job.inner.operations.lock().expect("operations lock"),
        &job.operation_id,
        &job.request_id,
        outcome,
    );
    let mut event = json!({
        "kind": "event",
        "messageId": next_id(&job.inner, if outcome == "cancelled" { "failed" } else { "result-unknown" }),
        "eventType": event_type,
        "streamId": job.stream_id,
        "sequence": sequence,
        "runId": job.run_id,
        "operationId": job.operation_id,
        "requestId": job.request_id,
        "final": true,
        "outcome": outcome,
        "payload": if outcome == "cancelled" {
            json!({
                "result": stub_turn_result(
                    "aborted",
                    &job.session_id,
                    &job.turn_id,
                    "aborted_streaming",
                    0,
                    &job.started_at,
                ),
                "messages": [],
            })
        } else {
            json!({})
        },
    });
    if let Some(code) = code {
        event["code"] = json!(code);
    }
    if let Some(error) = error {
        event["error"] = error;
    }
    (job.inner.emit)(event);
    clear_active(job);
}

fn emit_failed_terminal(job: &StubJob, sequence: u64, code: &str, message: &str) {
    record_final_locked(
        &mut job.inner.operations.lock().expect("operations lock"),
        &job.operation_id,
        &job.request_id,
        "failed",
    );
    (job.inner.emit)(json!({
        "kind": "event",
        "messageId": next_id(&job.inner, "failed"),
        "eventType": "agent.execute.failed",
        "streamId": job.stream_id,
        "sequence": sequence,
        "runId": job.run_id,
        "operationId": job.operation_id,
        "requestId": job.request_id,
        "final": true,
        "outcome": "failed",
        "code": code,
        "error": { "code": code, "message": message },
        "payload": {
            "result": stub_turn_result(
                "error",
                &job.session_id,
                &job.turn_id,
                "failed",
                0,
                &job.started_at,
            ),
            "messages": [],
        },
    }));
    clear_active(job);
}

fn clear_active(job: &StubJob) {
    let mut ops = job.inner.operations.lock().expect("operations lock");
    ops.active.remove(&job.operation_id);
}

fn record_final_locked(ops: &mut Operations, operation_id: &str, request_id: &str, outcome: &str) {
    if let Some(snapshot) = ops.by_id.get_mut(operation_id) {
        if snapshot.outcome.is_some() {
            return;
        }
        snapshot.outcome = Some(outcome.to_string());
        snapshot.state = match outcome {
            "completed" => "completed",
            "cancelled" => "cancelled",
            "result_unknown" => "resolving",
            _ => "failed",
        }
        .to_string();
        if !snapshot.request_ids.iter().any(|id| id == request_id) {
            snapshot.request_ids.push(request_id.to_string());
        }
        snapshot.updated_at = now_iso();
    }
}

fn sleep_cancellable(
    delay_ms: u64,
    cancel: &AtomicBool,
    deadline_exceeded: &AtomicBool,
    deadline_at_ms: Option<i64>,
) -> bool {
    let mut remaining = delay_ms;
    while remaining > 0 {
        if cancel.load(Ordering::SeqCst)
            || runtime_deadline_exceeded(deadline_at_ms, deadline_exceeded)
        {
            return true;
        }
        let slice = remaining.min(STUB_POLL_MS);
        thread::sleep(Duration::from_millis(slice));
        remaining = remaining.saturating_sub(slice);
    }
    cancel.load(Ordering::SeqCst) || runtime_deadline_exceeded(deadline_at_ms, deadline_exceeded)
}

fn runtime_deadline_exceeded(deadline_at_ms: Option<i64>, deadline_exceeded: &AtomicBool) -> bool {
    if let Some(deadline) = deadline_at_ms {
        if now_unix_ms() >= deadline {
            deadline_exceeded.store(true, Ordering::SeqCst);
            return true;
        }
    }
    false
}

fn stub_delay_ms(payload: &Value) -> u64 {
    payload
        .pointer("/stub/delayMs")
        .or_else(|| payload.get("delayMs"))
        .and_then(value_as_u64)
        .unwrap_or(0)
        .min(MAX_STUB_DELAY_MS)
}

fn value_as_u64(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| {
        value.as_f64().and_then(|float| {
            if float.is_finite() && float >= 0.0 && float.fract() == 0.0 {
                Some(float as u64)
            } else {
                None
            }
        })
    })
}

fn last_user_text_block(payload: &Value) -> String {
    last_user_text_from_messages(payload.get("messages"))
        .unwrap_or_else(|| DEFAULT_STUB_TEXT.to_string())
}

fn last_user_text_from_messages(messages: Option<&Value>) -> Option<String> {
    let messages = messages.and_then(Value::as_array)?;
    for message in messages.iter().rev() {
        if message.get("role").and_then(Value::as_str) != Some("user") {
            continue;
        }
        if let Some(text) = text_from_content_blocks(message.get("content")) {
            return Some(text);
        }
    }
    None
}

fn text_from_content_blocks(content: Option<&Value>) -> Option<String> {
    let blocks = content.and_then(Value::as_array)?;
    for block in blocks.iter().rev() {
        if block.get("type").and_then(Value::as_str) != Some("text") {
            continue;
        }
        if let Some(text) = block
            .get("text")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            return Some(text.to_string());
        }
    }
    None
}

fn conversation_from_payload(payload: &Value) -> Value {
    if let Some(messages) = payload.get("messages").and_then(Value::as_array) {
        if !messages.is_empty() {
            return json!(messages);
        }
    }
    json!([{
        "role": "user",
        "content": [{ "type": "text", "text": last_user_text_block(payload) }],
    }])
}

fn append_conversation(conversation: &mut Value, message: Value) {
    if let Some(messages) = conversation.as_array_mut() {
        messages.push(message);
    }
}

struct AssembledModel {
    text: String,
    thinking: String,
    tool_calls: Vec<Value>,
    /// Present when each `text_delta` was already emitted as `model_event`.
    /// The durable assistant text block reuses it so the host does not project
    /// a second `assistant_text_delta` for the concatenated message.
    text_block_id: Option<String>,
    /// Same role as `text_block_id` for `thinking_delta` events.
    thinking_block_id: Option<String>,
    /// Last non-empty `thinking_delta.signature` (TS `assembleModelMessage`).
    thinking_signature: Option<String>,
    /// Concatenated `thinking_delta.reasoningContent` when the buffer is non-empty.
    thinking_reasoning_content: String,
}

fn model_tool_definition(tool: &Value) -> Option<Value> {
    let name = tool
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())?;
    Some(json!({
        "name": name,
        "description": tool.get("description").and_then(Value::as_str).unwrap_or(""),
        "inputSchema": tool.get("inputSchema").cloned().unwrap_or(json!({ "type": "object" })),
    }))
}

fn payload_flag(payload: &Value, path: &str) -> bool {
    payload.pointer(path).and_then(Value::as_bool) == Some(true)
}

fn can_prompt(payload: &Value) -> bool {
    payload_flag(payload, "/canPrompt") || payload_flag(payload, "/permissionContext/canPrompt")
}

fn can_elicit(payload: &Value) -> bool {
    payload_flag(payload, "/canElicit")
}

fn allow_plan_mode_tools(payload: &Value) -> bool {
    payload_flag(payload, "/allowPlanModeTools")
}

fn permission_mode(payload: &Value) -> String {
    first_nonempty_id(&[
        payload.pointer("/permissionContext/mode"),
        payload.pointer("/agent/permissionMode"),
    ])
    .unwrap_or_else(|| "default".to_string())
}

/// Workspace cwd for synthesized recovery. Same source as
/// `context_prepare_input`: `/agent/cwd`. Empty/missing uses `"."` at the
/// TS `createMissingToolResult` boundary (`recoveryContext?.cwd ?? "."`),
/// not an invented workspace path.
fn recovery_cwd(payload: &Value) -> String {
    payload
        .pointer("/agent/cwd")
        .and_then(Value::as_str)
        .filter(|cwd| !cwd.is_empty())
        .unwrap_or(".")
        .to_string()
}

fn tool_requires_prompt(tool: &Value) -> bool {
    matches!(
        tool.get("name").and_then(Value::as_str),
        Some("enter_plan_mode") | Some("ask_user_question")
    ) || payload_flag(tool, "/requiresUserInteraction")
}

/// Native `AgentLoop.createContextPrepareInput` drops plan-mode tools unless
/// `allowPlanModeTools`, and drops prompt-gated tools (including
/// `ask_user_question`) when the host cannot prompt/elicit.
fn filter_model_tools(payload: &Value) -> Vec<Value> {
    let Some(tools) = payload.get("tools").and_then(Value::as_array) else {
        return Vec::new();
    };
    let allow_plan = allow_plan_mode_tools(payload);
    let prompt_ok = can_prompt(payload);
    let elicit_ok = can_elicit(payload);
    tools
        .iter()
        .filter_map(|tool| {
            let name = tool.get("name").and_then(Value::as_str)?;
            if !allow_plan && matches!(name, "enter_plan_mode" | "exit_plan_mode") {
                return None;
            }
            if !prompt_ok {
                let keep_ask = elicit_ok && name == "ask_user_question";
                if tool_requires_prompt(tool) && !keep_ask {
                    return None;
                }
            }
            model_tool_definition(tool)
        })
        .collect()
}

const PLAN_MODE_REMINDER: &str = concat!(
    "Plan mode is active.\n",
    "Read first using read-only tools, then write or refine plan markdown only under `.pilotdeck/plans/`.\n",
    "Do not make implementation changes while planning.\n",
    "When the plan is ready for user review, call `exit_plan_mode` with the plan file path.",
);

fn append_plan_mode_reminder(messages: &mut Value) {
    if let Some(array) = messages.as_array_mut() {
        array.push(json!({
            "role": "user",
            "content": [{ "type": "text", "text": PLAN_MODE_REMINDER }],
            "metadata": { "synthetic": true, "purpose": "plan_mode_reminder" },
        }));
    }
}

fn context_prepare_input(job: &StubJob, conversation: &Value, tools: &[Value]) -> Value {
    let payload = &job.payload;
    let mut input = json!({
        "sessionId": job.session_id,
        "turnId": job.turn_id,
        "cwd": payload.pointer("/agent/cwd").and_then(Value::as_str).unwrap_or(""),
        "provider": first_nonempty_id(&[
            payload.pointer("/agent/provider"),
            payload.pointer("/hostModules/model/provider"),
        ]).unwrap_or_else(|| STUB_PROVIDER.to_string()),
        "model": model_from_payload(payload),
        "permissionMode": permission_mode(payload),
        "runMode": payload
            .pointer("/agent/runMode")
            .and_then(Value::as_str)
            .unwrap_or("agent"),
        "additionalWorkingDirectories": payload
            .pointer("/permissionContext/additionalWorkingDirectories")
            .cloned()
            .unwrap_or(json!([])),
        "messages": conversation,
        "tools": tools,
    });
    if let Some(system_prompt) = payload.pointer("/agent/systemPrompt").cloned() {
        input["customSystemPrompt"] = system_prompt;
    }
    if let Some(append) = payload.pointer("/agent/appendSystemPrompt").cloned() {
        input["appendSystemPrompt"] = append;
    }
    if let Some(surface) = payload.pointer("/agent/runtimeContextSurface").cloned() {
        input["runtimeContextSurface"] = surface;
    }
    if let Some(max_messages) = payload.pointer("/agent/maxContextMessages").cloned() {
        input["maxMessages"] = max_messages;
    }
    input
}

fn assemble_model_request(
    payload: &Value,
    messages: &Value,
    system_prompt: Option<Value>,
    tools: Vec<Value>,
) -> Value {
    let mut request = json!({
        "provider": first_nonempty_id(&[
            payload.pointer("/agent/provider"),
            payload.pointer("/hostModules/model/provider"),
        ]).unwrap_or_else(|| STUB_PROVIDER.to_string()),
        "model": model_from_payload(payload),
        "messages": messages,
        "stream": true,
    });
    if let Some(max_output) = payload.pointer("/agent/maxOutputTokens").cloned() {
        request["maxOutputTokens"] = max_output;
    }
    if let Some(system_prompt) = system_prompt {
        request["systemPrompt"] = system_prompt;
    }
    if let Some(tool_choice) = payload.pointer("/agent/toolChoice").cloned() {
        request["toolChoice"] = tool_choice;
    }
    if let Some(thinking) = payload.pointer("/agent/thinking").cloned() {
        request["thinking"] = thinking;
    }
    if let Some(metadata) = payload.pointer("/agent/metadata").cloned() {
        request["metadata"] = metadata;
    }
    if payload.get("tools").is_some() {
        request["tools"] = json!(tools);
    }
    request
}

/// Native path: filter tools → host `context.prepare_for_model` (when
/// advertised) → finalize request. Unit hosts without context keep the
/// payload-only systemPrompt / filtered schemas.
fn build_model_request(job: &StubJob, conversation: &Value) -> Result<Value, HostCall> {
    let tools = filter_model_tools(&job.payload);
    let mut messages = conversation.clone();
    let mut system_prompt = job.payload.pointer("/agent/systemPrompt").cloned();
    let mut request_tools = tools.clone();
    if host_advertises_context(&job.payload) {
        let prepared = match call_host_module(
            job,
            "context",
            json!({
                "operation": "prepare_for_model",
                "input": context_prepare_input(job, conversation, &tools),
            }),
        ) {
            HostCall::Ok(response) => response,
            other => return Err(other),
        };
        if stub_interrupted(job) {
            return Err(HostCall::Interrupted);
        }
        let result = prepared
            .pointer("/payload/result")
            .cloned()
            .or_else(|| prepared.get("payload").cloned())
            .unwrap_or(json!({}));
        if let Some(prepared_messages) = result.get("messages").cloned() {
            if !prepared_messages.is_null() {
                messages = prepared_messages;
            }
        }
        if let Some(prepared_prompt) = result.get("systemPrompt").cloned() {
            if !prepared_prompt.is_null() {
                system_prompt = Some(prepared_prompt);
            }
        }
        if let Some(prepared_tools) = result.get("tools").and_then(Value::as_array) {
            request_tools = prepared_tools
                .iter()
                .filter_map(model_tool_definition)
                .collect();
        }
    }
    if permission_mode(&job.payload) == "plan" {
        append_plan_mode_reminder(&mut messages);
    }
    Ok(assemble_model_request(
        &job.payload,
        &messages,
        system_prompt,
        request_tools,
    ))
}

fn model_execution_context(job: &StubJob) -> Value {
    json!({
        "sessionId": job.session_id,
        "turnId": job.turn_id,
        "runId": job.run_id,
        "operationId": job.operation_id,
    })
}

/// Real host (`sidecarDefaultModuleDispatcher.ts:67-150`,
/// `hostModelInvokerPort.ts`) has no `complete`. Sidecar mints
/// `preparationId`, then `prepare` → pull or unary stream.
///
/// When `hostModules.model.methods` includes `stream_next`
/// (`supportsPullStream` in `hostModelInvokerPort.ts`), pull one frame at a
/// time and emit each `text_delta` before the next pull. Otherwise keep the
/// unary `stream` call and merge deltas in `assemble_canonical_events`.
fn call_host_model(
    job: &StubJob,
    request: &Value,
    sequence: &mut u64,
) -> Result<AssembledModel, HostCall> {
    let preparation_id = next_id(&job.inner, "prepared");
    let context = model_execution_context(job);
    let prepared_request = match call_host_module(
        job,
        "model",
        json!({
            "operation": "prepare",
            "preparationId": preparation_id,
            "request": request,
            "context": context,
        }),
    ) {
        HostCall::Ok(response) => prepared_model_request(&response, request),
        HostCall::Interrupted => {
            let _ = close_host_stream(job, &preparation_id);
            return Err(HostCall::Interrupted);
        }
        other => return Err(other),
    };
    if stub_interrupted(job) {
        let _ = close_host_stream(job, &preparation_id);
        return Err(HostCall::Interrupted);
    }
    if host_supports_pull_stream(&job.payload) {
        return pull_host_model_stream(job, &prepared_request, &preparation_id, &context, sequence);
    }
    let stream = call_host_module(
        job,
        "model",
        json!({
            "operation": "stream",
            "preparationId": preparation_id,
            "request": prepared_request,
            "context": context,
        }),
    );
    if stub_interrupted(job) {
        let _ = close_host_stream(job, &preparation_id);
        return Err(HostCall::Interrupted);
    }
    let assembled = match stream {
        HostCall::Ok(response) => {
            if let Some(event) = first_canonical_error(response.pointer("/payload/events")) {
                emit_model_event(job, sequence, &event, None);
                if let HostCall::Interrupted = close_host_stream(job, &preparation_id) {
                    return Err(HostCall::Interrupted);
                }
                return Err(canonical_stream_error(&event));
            }
            assemble_from_host_response(&response)
        }
        other => {
            let _ = close_host_stream(job, &preparation_id);
            return Err(other);
        }
    };
    if let HostCall::Interrupted = close_host_stream(job, &preparation_id) {
        return Err(HostCall::Interrupted);
    }
    Ok(assembled)
}

/// A host that returns `{ events: [], done: false }` forever must not spin the
/// execute thread. Non-empty frames are not capped.
const MAX_CONSECUTIVE_EMPTY_STREAM_FRAMES: usize = 8;

fn host_model_methods(payload: &Value) -> Vec<&str> {
    payload
        .pointer("/hostModules/model/methods")
        .and_then(Value::as_array)
        .map(|methods| methods.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

/// `createHostModelInvokerPort`: `methods.includes("stream_next")`.
/// Host `prepare` may rewrite the canonical request (routing, prompts, caps).
/// Later `stream` / `stream_next` calls must send that prepared request.
/// TS `hostModelInvokerPort` streams `prepared.request`, and the host
/// dispatcher replaces the stored request with the stream payload.
fn prepared_model_request(response: &Value, fallback: &Value) -> Value {
    response
        .pointer("/payload/prepared/request")
        .filter(|request| request.is_object())
        .cloned()
        .unwrap_or_else(|| fallback.clone())
}

fn host_supports_pull_stream(payload: &Value) -> bool {
    host_model_methods(payload)
        .iter()
        .any(|method| *method == "stream_next")
}

fn host_supports_close_stream(payload: &Value) -> bool {
    host_model_methods(payload)
        .iter()
        .any(|method| *method == "close_stream")
}

fn invalid_model_response(message: &str) -> HostCall {
    HostCall::Failed(json!({
        "ok": false,
        "code": "INVALID_MODEL_RESPONSE",
        "error": {
            "code": "INVALID_MODEL_RESPONSE",
            "message": message,
        },
    }))
}

fn read_stream_next_frame(response: &Value) -> Result<(Vec<Value>, bool), HostCall> {
    let payload = response.get("payload");
    let events = payload
        .and_then(|payload| payload.get("events"))
        .and_then(Value::as_array)
        .cloned();
    let done = payload
        .and_then(|payload| payload.get("done"))
        .and_then(Value::as_bool);
    match (events, done) {
        (Some(events), Some(done)) => Ok((events, done)),
        _ => Err(invalid_model_response(
            "Model stream_next response must contain events and done.",
        )),
    }
}

fn first_canonical_error(events: Option<&Value>) -> Option<Value> {
    events.and_then(Value::as_array).and_then(|events| {
        events
            .iter()
            .find(|event| event.get("type").and_then(Value::as_str) == Some("error"))
            .cloned()
    })
}

fn canonical_stream_error(event: &Value) -> HostCall {
    let code = event
        .pointer("/error/code")
        .and_then(Value::as_str)
        .filter(|code| !code.is_empty())
        .unwrap_or("MODEL_STREAM_ERROR");
    let message = event
        .pointer("/error/message")
        .and_then(Value::as_str)
        .filter(|message| !message.is_empty())
        .unwrap_or("Model stream returned an error frame.");
    HostCall::Failed(json!({
        "ok": false,
        "code": code,
        "error": { "code": code, "message": message },
    }))
}

fn stream_event_block_id<'a>(
    job: &StubJob,
    event: &Value,
    text_block_id: &'a mut Option<String>,
    thinking_block_id: &'a mut Option<String>,
) -> Option<&'a str> {
    match event.get("type").and_then(Value::as_str) {
        Some("text_delta") => {
            if text_block_id.is_none() {
                *text_block_id = Some(next_id(&job.inner, "text-block"));
            }
            text_block_id.as_deref()
        }
        Some("thinking_delta") => {
            if thinking_block_id.is_none() {
                *thinking_block_id = Some(next_id(&job.inner, "thinking-block"));
            }
            thinking_block_id.as_deref()
        }
        _ => None,
    }
}

/// Host projects `agent.model_event` + `text_delta` to `assistant_text_delta`
/// (`GatewayAgentEventProjector.mapModelEvent`). Emit before the next pull so
/// the prefix delta is visible before provider completion.
fn emit_model_event(job: &StubJob, sequence: &mut u64, event: &Value, block_id: Option<&str>) {
    let mut payload = json!({
        "type": "model_event",
        "sessionId": job.session_id,
        "turnId": job.turn_id,
        "event": event,
    });
    if let Some(block_id) = block_id {
        payload["blockId"] = json!(block_id);
    }
    emit_stub_event(job, "event", "agent.model_event", *sequence, payload);
    *sequence += 1;
}

fn pull_host_model_stream(
    job: &StubJob,
    request: &Value,
    preparation_id: &str,
    context: &Value,
    sequence: &mut u64,
) -> Result<AssembledModel, HostCall> {
    let mut events = Vec::new();
    let mut done = false;
    let mut text_block_id: Option<String> = None;
    let mut thinking_block_id: Option<String> = None;
    let mut failure: Option<HostCall> = None;
    let mut consecutive_empty = 0usize;

    loop {
        if stub_interrupted(job) {
            failure = Some(HostCall::Interrupted);
            break;
        }
        let response = match call_host_module(
            job,
            "model",
            json!({
                "operation": "stream_next",
                "preparationId": preparation_id,
                "request": request,
                "context": context,
            }),
        ) {
            HostCall::Ok(response) => response,
            other => {
                failure = Some(other);
                break;
            }
        };
        if stub_interrupted(job) {
            failure = Some(HostCall::Interrupted);
            break;
        }
        let (frame_events, frame_done) = match read_stream_next_frame(&response) {
            Ok(frame) => frame,
            Err(error) => {
                failure = Some(error);
                break;
            }
        };
        done = frame_done;
        if frame_events.is_empty() && !frame_done {
            consecutive_empty += 1;
            if consecutive_empty > MAX_CONSECUTIVE_EMPTY_STREAM_FRAMES {
                failure = Some(invalid_model_response(
                    "Model stream_next returned too many consecutive empty frames.",
                ));
                break;
            }
        } else {
            consecutive_empty = 0;
        }
        let mut stop_for_error = false;
        for event in frame_events {
            let block_id =
                stream_event_block_id(job, &event, &mut text_block_id, &mut thinking_block_id);
            emit_model_event(job, sequence, &event, block_id);
            let is_error = event.get("type").and_then(Value::as_str) == Some("error");
            if is_error {
                failure = Some(canonical_stream_error(&event));
                stop_for_error = true;
                break;
            }
            events.push(event);
        }
        if stop_for_error || done {
            break;
        }
    }

    if !done && host_supports_close_stream(&job.payload) {
        if let HostCall::Interrupted = close_host_stream(job, preparation_id) {
            return Err(HostCall::Interrupted);
        }
    }
    if let Some(failure) = failure {
        return Err(failure);
    }
    let mut assembled = assemble_canonical_events(&events);
    if !assembled.text.is_empty() {
        assembled.text_block_id = text_block_id;
    }
    if durable_thinking_present(&assembled) {
        assembled.thinking_block_id = thinking_block_id;
    }
    Ok(assembled)
}

fn close_host_stream(job: &StubJob, preparation_id: &str) -> HostCall {
    call_host_module(
        job,
        "model",
        json!({
            "operation": "close_stream",
            "preparationId": preparation_id,
        }),
    )
}

fn assemble_from_host_response(response: &Value) -> AssembledModel {
    let events = response
        .pointer("/payload/events")
        .and_then(Value::as_array)
        .map(|events| events.as_slice())
        .unwrap_or(&[]);
    assemble_canonical_events(events)
}

fn assemble_canonical_events(events: &[Value]) -> AssembledModel {
    let mut text = String::new();
    let mut thinking = String::new();
    let mut thinking_signature: Option<String> = None;
    let mut thinking_reasoning_content = String::new();
    let mut tool_calls = Vec::new();
    for event in events {
        match event.get("type").and_then(Value::as_str) {
            Some("text_delta") => {
                if let Some(delta) = event.get("text").and_then(Value::as_str) {
                    text.push_str(delta);
                }
            }
            Some("thinking_delta") => {
                // TS `applyModelEventToAssembler`: append text, append
                // reasoningContent when present, keep the last non-empty signature.
                if let Some(delta) = event.get("text").and_then(Value::as_str) {
                    thinking.push_str(delta);
                }
                if let Some(reasoning) = event.get("reasoningContent").and_then(Value::as_str) {
                    thinking_reasoning_content.push_str(reasoning);
                }
                if let Some(signature) = event
                    .get("signature")
                    .and_then(Value::as_str)
                    .filter(|signature| !signature.is_empty())
                {
                    thinking_signature = Some(signature.to_string());
                }
            }
            Some("tool_call_end") => {
                if let Some(call) = event.get("toolCall").and_then(normalize_tool_call) {
                    tool_calls.push(call);
                }
            }
            _ => {}
        }
    }
    AssembledModel {
        text,
        thinking,
        tool_calls,
        text_block_id: None,
        thinking_block_id: None,
        thinking_signature,
        thinking_reasoning_content,
    }
}

fn module_call_timeout_ms(payload: &Value) -> u64 {
    payload
        .get("moduleCallTimeoutMs")
        .or_else(|| payload.pointer("/stub/moduleCallTimeoutMs"))
        .and_then(value_as_u64)
        .unwrap_or(DEFAULT_MODULE_CALL_TIMEOUT_MS)
        .clamp(1, MAX_STUB_DELAY_MS)
}

fn normalize_tool_call(value: &Value) -> Option<Value> {
    let id = value
        .get("id")
        .or_else(|| value.get("toolCallId"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())?;
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/function/name").and_then(Value::as_str))
        .filter(|name| !name.is_empty())?;
    let input = value
        .get("input")
        .cloned()
        .or_else(|| value.get("arguments").cloned())
        .or_else(|| {
            value
                .pointer("/function/arguments")
                .map(|arguments| match arguments {
                    Value::String(raw) => {
                        serde_json::from_str(raw).unwrap_or(json!({ "raw": raw }))
                    }
                    other => other.clone(),
                })
        })
        .unwrap_or(json!({}));
    let mut call = json!({ "id": id, "name": name, "input": input });
    if let Some(raw) = value.get("raw") {
        call["raw"] = raw.clone();
    }
    Some(call)
}

fn is_plain_string_array(blocks: &[Value]) -> bool {
    !blocks.is_empty() && blocks.iter().all(Value::is_string)
}

fn file_block_text(block: &Value) -> String {
    let path = block.get("path").and_then(Value::as_str).unwrap_or("");
    let mime = block.get("mimeType").and_then(Value::as_str).unwrap_or("");
    let description = block
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("");
    let mut text = format!("[File: {path}");
    if !mime.is_empty() {
        text.push_str(", ");
        text.push_str(mime);
    }
    if !description.is_empty() {
        text.push_str(", ");
        text.push_str(description);
    }
    text.push(']');
    text
}

fn filter_result_content_blocks(blocks: &[Value], fallback: &str) -> Value {
    let mut out = Vec::new();
    for block in blocks {
        match block.get("type").and_then(Value::as_str) {
            Some("text") | Some("image") | Some("pdf") => out.push(block.clone()),
            Some("json") => {
                let text = block
                    .get("value")
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| block.to_string());
                out.push(json!({ "type": "text", "text": text }));
            }
            Some("file") => out.push(json!({ "type": "text", "text": file_block_text(block) })),
            _ => {}
        }
    }
    if out.is_empty() {
        text_content_blocks(fallback)
    } else {
        Value::Array(out)
    }
}

fn normalize_outbound_content(content: Option<&Value>, fallback: &str) -> Value {
    match content {
        Some(Value::Array(blocks)) if blocks.is_empty() => text_content_blocks(fallback),
        Some(Value::Array(blocks)) if is_plain_string_array(blocks) => {
            json!(blocks
                .iter()
                .filter_map(Value::as_str)
                .map(|text| json!({ "type": "text", "text": text }))
                .collect::<Vec<_>>())
        }
        Some(Value::Array(blocks)) => filter_result_content_blocks(blocks, fallback),
        Some(Value::String(text)) => text_content_blocks(text),
        Some(other) => text_content_blocks(&other.to_string()),
        None => text_content_blocks(fallback),
    }
}

fn sanitize_raw_content(content: &Value) -> Value {
    match content.get("type").and_then(Value::as_str) {
        Some("image") | Some("pdf") | Some("audio") => {
            let mut sanitized = content.clone();
            if let Some(object) = sanitized.as_object_mut() {
                object.remove("data");
            }
            sanitized
        }
        _ => content.clone(),
    }
}

fn sanitize_tool_result_raw(result: &Value) -> Value {
    let mut raw = result.clone();
    if let Some(content) = raw.get("content").cloned() {
        raw["content"] = match content {
            Value::Array(blocks) => {
                json!(blocks.iter().map(sanitize_raw_content).collect::<Vec<_>>())
            }
            other => other,
        };
    }
    if let Some(Value::Array(messages)) = raw.get("supplementalMessages").cloned() {
        raw["supplementalMessages"] = json!(messages
            .iter()
            .map(|message| {
                let mut next = message.clone();
                if let Some(content) = next.get("content").cloned() {
                    next["content"] = match content {
                        Value::Array(blocks) => {
                            json!(blocks.iter().map(sanitize_raw_content).collect::<Vec<_>>())
                        }
                        other => other,
                    };
                }
                next
            })
            .collect::<Vec<_>>());
    }
    raw
}

/// Keep host result fields (`data`, `metadata`, timestamps if present).
/// Do not invent `startedAt` / `completedAt` — native mock results omit them
/// and `sanitizeToolResultRaw` is a spread of the host object.
fn capability_result(response: &Value, tool_call_id: &str, tool_name: &str) -> Value {
    let payload = response.get("payload").cloned().unwrap_or(json!({}));
    let mut result = payload.get("result").cloned().unwrap_or(payload);
    let content =
        normalize_outbound_content(result.get("content"), "Tool completed with no output.");
    if let Some(object) = result.as_object_mut() {
        if !object.contains_key("type") {
            object.insert("type".into(), json!("success"));
        }
        if !object.contains_key("toolCallId") {
            object.insert("toolCallId".into(), json!(tool_call_id));
        }
        if !object.contains_key("toolName") {
            object.insert("toolName".into(), json!(tool_name));
        }
        object.insert("content".into(), content);
        return result;
    }
    json!({
        "type": "success",
        "toolCallId": tool_call_id,
        "toolName": tool_name,
        "content": content,
    })
}

fn stub_session_id(request: &Value, payload: &Value, run_id: &str) -> String {
    first_nonempty_id(&[request.get("sessionId"), payload.get("sessionId")])
        .unwrap_or_else(|| run_id.to_string())
}

fn stub_turn_id(request: &Value, payload: &Value, operation_id: &str) -> String {
    first_nonempty_id(&[request.get("turnId"), payload.get("turnId")])
        .unwrap_or_else(|| operation_id.to_string())
}

fn first_nonempty_id(candidates: &[Option<&Value>]) -> Option<String> {
    candidates.iter().find_map(|value| {
        value
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map(str::to_string)
    })
}

fn stub_turn_result(
    result_type: &str,
    session_id: &str,
    turn_id: &str,
    stop_reason: &str,
    turns: u64,
    started_at: &str,
) -> Value {
    json!({
        "type": result_type,
        "sessionId": session_id,
        "turnId": turn_id,
        "stopReason": stop_reason,
        "usage": {},
        "permissionDenials": [],
        "turns": turns,
        "startedAt": started_at,
        "completedAt": now_iso(),
    })
}

fn earliest_deadline_ms(request: &Value) -> Option<i64> {
    ["operationDeadline", "attemptDeadline"]
        .into_iter()
        .filter_map(|field| {
            request
                .get(field)
                .and_then(Value::as_str)
                .and_then(parse_iso_ms)
        })
        .min()
}

fn control_failure(message_id: &str, in_reply_to: &str, code: &str) -> Value {
    json!({
        "kind": "response",
        "messageId": message_id,
        "inReplyTo": in_reply_to,
        "ok": false,
        "code": code,
    })
}

fn cancel_response(
    message_id: String,
    in_reply_to: &str,
    request_id: Option<&str>,
    ok: bool,
    extra: Value,
) -> Value {
    let mut message = json!({
        "kind": "response",
        "messageId": message_id,
        "inReplyTo": in_reply_to,
        "ok": ok,
    });
    if let Some(request_id) = request_id {
        message["requestId"] = json!(request_id);
    }
    if let Value::Object(extra) = extra {
        for (key, value) in extra {
            message[key] = value;
        }
    }
    message
}

fn constant_time_eq(expected: &str, provided: &str) -> bool {
    let expected = expected.as_bytes();
    let provided = provided.as_bytes();
    let mut diff = expected.len() ^ provided.len();
    let len = expected.len().max(provided.len());
    for index in 0..len {
        let left = expected.get(index).copied().unwrap_or(0);
        let right = provided.get(index).copied().unwrap_or(0);
        diff |= usize::from(left ^ right);
    }
    diff == 0
}

fn string_field(value: &Value, field: &str) -> String {
    value
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn next_id(inner: &Inner, prefix: &str) -> String {
    format!("{prefix}-{}", next_token_from(&inner.token))
}

fn next_token_from(token: &AtomicU64) -> String {
    let n = token.fetch_add(1, Ordering::Relaxed);
    if stable_ids_enabled() {
        return format!("{n:x}");
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}-{n:x}-{:x}", std::process::id())
}

fn stable_ids_enabled() -> bool {
    std::env::var(STABLE_IDS_ENV)
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::format_unix_ms;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;
    use std::time::Instant;

    #[test]
    fn turn_timeline_reuses_id_and_update_bumps_revision() {
        let mut timeline = TurnTimeline::new("turn-tl");
        let first = timeline.position("tool:mock-call-0");
        assert_eq!(first["order"], 0);
        assert_eq!(first["revision"], 1);
        assert!(first.get("previousId").is_none());
        let reused = timeline.position("tool:mock-call-0");
        assert_eq!(reused["order"], 0);
        assert_eq!(reused["revision"], 1);
        let updated = timeline.update("tool:mock-call-0");
        assert_eq!(updated["order"], 0);
        assert_eq!(updated["revision"], 2);
        assert!(updated.get("previousId").is_none());
        let result = timeline.update("result:mock-call-0");
        assert_eq!(result["order"], 1);
        assert_eq!(result["revision"], 4);
        assert_eq!(result["previousId"], "tool:mock-call-0");
    }

    #[test]
    fn model_tool_schema_keeps_input_schema_key_order() {
        let schema: Value = serde_json::from_str(
            r#"{"type":"object","required":["q"],"additionalProperties":false,"properties":{"q":{"type":"string"}}}"#,
        )
        .expect("schema");
        let tool = model_tool_definition(&json!({
            "name": "lookup",
            "description": "Look up",
            "inputSchema": schema,
        }))
        .expect("tool");
        assert_eq!(
            serde_json::to_string(&tool["inputSchema"]).expect("stringify"),
            r#"{"type":"object","required":["q"],"additionalProperties":false,"properties":{"q":{"type":"string"}}}"#
        );
    }

    fn collect() -> (Sidecar, Arc<Mutex<Vec<Value>>>) {
        let sink = Arc::new(Mutex::new(Vec::new()));
        let emit_sink = Arc::clone(&sink);
        let sidecar = Sidecar::new(Arc::new(move |message| {
            emit_sink.lock().expect("sink").push(message);
        }));
        (sidecar, sink)
    }

    fn collect_with_host(
        host: impl Fn(&Value) -> Option<Value> + Send + Sync + 'static,
    ) -> (Sidecar, Arc<Mutex<Vec<Value>>>) {
        let sink = Arc::new(Mutex::new(Vec::new()));
        let holder: Arc<Mutex<Option<Sidecar>>> = Arc::new(Mutex::new(None));
        let emit_sink = Arc::clone(&sink);
        let emit_holder = Arc::clone(&holder);
        let host = Arc::new(host);
        let sidecar = Sidecar::new(Arc::new(move |message| {
            emit_sink.lock().expect("sink").push(message.clone());
            if message.get("kind") == Some(&json!("request"))
                && message.get("method") == Some(&json!("module_call"))
            {
                if let Some(reply) = host(&message) {
                    if let Some(sidecar) = emit_holder.lock().expect("holder").as_ref() {
                        sidecar.handle_value(reply);
                    }
                }
            }
        }));
        *holder.lock().expect("holder") = Some(sidecar.clone());
        (sidecar, sink)
    }

    fn host_ok(call: &Value, payload: Value) -> Value {
        json!({
            "kind": "response",
            "messageId": format!("host-{}", call.get("messageId").and_then(Value::as_str).unwrap_or("x")),
            "inReplyTo": call.get("messageId").and_then(Value::as_str).unwrap_or(""),
            "requestId": call.get("requestId").and_then(Value::as_str).unwrap_or(""),
            "ok": true,
            "payload": payload,
        })
    }

    fn host_fail(call: &Value, code: &str) -> Value {
        json!({
            "kind": "response",
            "messageId": format!("host-{}", call.get("messageId").and_then(Value::as_str).unwrap_or("x")),
            "inReplyTo": call.get("messageId").and_then(Value::as_str).unwrap_or(""),
            "requestId": call.get("requestId").and_then(Value::as_str).unwrap_or(""),
            "ok": false,
            "final": true,
            "outcome": "failed",
            "code": code,
            "error": { "code": code, "message": "host rejected module_call" },
        })
    }

    fn last_user_from_call(call: &Value) -> String {
        last_user_text_from_messages(call.pointer("/payload/request/messages"))
            .unwrap_or_else(|| DEFAULT_STUB_TEXT.to_string())
    }

    fn conversation_has_tool_result(call: &Value) -> bool {
        call.pointer("/payload/request/messages")
            .and_then(Value::as_array)
            .is_some_and(|messages| {
                messages.iter().any(|message| {
                    message
                        .get("content")
                        .and_then(Value::as_array)
                        .is_some_and(|blocks| {
                            blocks.iter().any(|block| {
                                block.get("type").and_then(Value::as_str) == Some("tool_result")
                            })
                        })
                })
            })
    }

    fn host_prepared(call: &Value) -> Value {
        let request = call
            .pointer("/payload/request")
            .cloned()
            .unwrap_or(json!({}));
        host_ok(
            call,
            json!({
                "prepared": {
                    "request": request,
                    "provider": request.get("provider").and_then(Value::as_str).unwrap_or(STUB_PROVIDER),
                    "model": request.get("model").and_then(Value::as_str).unwrap_or(STUB_MODEL),
                }
            }),
        )
    }

    fn text_events(prompt: &str) -> Value {
        json!([
            { "type": "request_started", "provider": STUB_PROVIDER, "model": STUB_MODEL },
            { "type": "message_start", "role": "assistant" },
            { "type": "text_delta", "text": format!("HOST[{prompt}]") },
            { "type": "message_end", "finishReason": "stop" }
        ])
    }

    fn tool_events(prompt: &str) -> Value {
        json!([
            { "type": "request_started", "provider": STUB_PROVIDER, "model": STUB_MODEL },
            { "type": "message_start", "role": "assistant" },
            {
                "type": "tool_call_end",
                "toolCall": {
                    "id": "host-tool-1",
                    "name": "lookup",
                    "input": { "q": prompt }
                }
            },
            { "type": "message_end", "finishReason": "tool_call" }
        ])
    }

    fn reply_model_ops(call: &Value, events: Value) -> Option<Value> {
        match call.pointer("/payload/operation").and_then(Value::as_str) {
            Some("prepare") => Some(host_prepared(call)),
            Some("stream") | Some("stream_next") => {
                Some(host_ok(call, json!({ "events": events, "done": true })))
            }
            Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
            _ => None,
        }
    }

    fn text_host(call: &Value) -> Option<Value> {
        if call.get("module").and_then(Value::as_str) != Some("model") {
            return None;
        }
        let prompt = last_user_from_call(call);
        reply_model_ops(call, text_events(&prompt))
    }

    fn single_tool_host(call: &Value) -> Option<Value> {
        match call.get("module").and_then(Value::as_str) {
            Some("model") => {
                let prompt = last_user_from_call(call);
                let events = if conversation_has_tool_result(call) {
                    text_events(&prompt)
                } else {
                    tool_events(&prompt)
                };
                reply_model_ops(call, events)
            }
            Some("capability") => {
                let name = call
                    .pointer("/payload/name")
                    .and_then(Value::as_str)
                    .unwrap_or("lookup");
                let prompt = call
                    .pointer("/payload/arguments/q")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                Some(host_ok(
                    call,
                    json!({
                        "type": "success",
                        "toolCallId": call.pointer("/payload/toolCallId"),
                        "toolName": name,
                        "content": [{ "type": "text", "text": format!("HOST_RESULT[{name}]: {prompt}") }],
                        "data": { "q": prompt, "value": format!("HOST_RESULT[{name}]: {prompt}") },
                    }),
                ))
            }
            _ => None,
        }
    }

    /// Portable pump used by the F-9(b) test so the same body works on
    /// baseline `c5bed6c1` (no module_call) and this tip (host must reply).
    fn reply_if_module_call(sidecar: &Sidecar, sink: &Mutex<Vec<Value>>, timeout_ms: u64) {
        let finals_before = sink
            .lock()
            .expect("sink")
            .iter()
            .filter(|m| {
                m.get("kind").and_then(Value::as_str) == Some("event")
                    && m.get("final") == Some(&Value::Bool(true))
            })
            .count();
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        let mut replied = std::collections::HashSet::new();
        loop {
            let snapshot = sink.lock().expect("sink").clone();
            let finals_now = snapshot
                .iter()
                .filter(|m| {
                    m.get("kind").and_then(Value::as_str) == Some("event")
                        && m.get("final") == Some(&Value::Bool(true))
                })
                .count();
            if finals_now > finals_before {
                return;
            }
            for message in &snapshot {
                if message.get("kind").and_then(Value::as_str) == Some("request")
                    && message.get("method").and_then(Value::as_str) == Some("module_call")
                {
                    let id = message
                        .get("messageId")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    if !id.is_empty() && replied.insert(id.clone()) {
                        if let Some(reply) = text_host(message).or_else(|| {
                            Some(json!({
                                "kind": "response",
                                "messageId": format!("host-{id}"),
                                "inReplyTo": id,
                                "requestId": message.get("requestId").and_then(Value::as_str).unwrap_or(""),
                                "ok": true,
                                "payload": { "events": [], "done": true, "closed": true }
                            }))
                        }) {
                            sidecar.handle_value(reply);
                        }
                    }
                }
            }
            if Instant::now() >= deadline {
                return;
            }
            thread::sleep(Duration::from_millis(5));
        }
    }

    fn client_payload_json(user_text: &str) -> String {
        json!({
            "agent": { "id": "pilotdeck-stub", "provider": "pilotdeck-stub", "model": "pilotdeck-stub" },
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": user_text }]
            }],
            "tools": [{
                "name": "lookup",
                "description": "Look up a value",
                "inputSchema": { "type": "object" }
            }],
            "permissionContext": {},
            "hostModules": { "model": true, "capability": true }
        })
        .to_string()
    }

    fn execute_line(
        message_id: &str,
        run_id: &str,
        operation_id: &str,
        request_id: &str,
        payload: &str,
    ) -> String {
        format!(
            r#"{{"kind":"request","messageId":"{message_id}","method":"execute","runId":"{run_id}","operationId":"{operation_id}","requestId":"{request_id}","payload":{payload}}}"#
        )
    }

    fn wait_for(
        sink: &Mutex<Vec<Value>>,
        pred: impl Fn(&[Value]) -> bool,
        timeout_ms: u64,
    ) -> Vec<Value> {
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            let snapshot = sink.lock().expect("sink").clone();
            if pred(&snapshot) {
                return snapshot;
            }
            if Instant::now() >= deadline {
                panic!("timed out waiting for sidecar messages: {snapshot:?}");
            }
            thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn hello_capabilities_handshake() {
        let (sidecar, sink) = collect();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"hello-1","method":"hello","payload":{}}"#,
        );
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"caps-1","method":"capabilities","payload":{}}"#,
        );
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["ok"], true);
        assert_eq!(lines[0]["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(lines[0]["moduleId"], MODULE_ID);
        assert_eq!(lines[1]["inReplyTo"], "caps-1");
        assert_eq!(lines[1]["payload"]["transport"], "stdio");
        assert_eq!(lines[1]["payload"]["methods"][0]["name"], "execute");
        assert_eq!(lines[1]["payload"]["methods"][0]["enabled"], true);
        assert_eq!(lines[1]["payload"]["methods"][3]["name"], "resume");
        assert_eq!(lines[1]["payload"]["methods"][3]["enabled"], false);
    }

    #[test]
    fn rejects_invalid_json_and_unknown_kind() {
        let (sidecar, sink) = collect();
        sidecar.handle_line("{not json");
        sidecar.handle_line(r#"{"kind":"nope","messageId":"x"}"#);
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(lines[0]["code"], "INVALID_JSON");
        assert_eq!(lines[1]["code"], "INVALID_KIND");
        assert_eq!(lines[0]["kind"], "error");
    }

    #[test]
    fn execute_pure_text_emits_events_and_final_outcome() {
        let (sidecar, sink) = collect_with_host(text_host);
        sidecar.handle_line(&execute_line(
            "ex-1",
            "run-1",
            "op-1",
            "req-1",
            &client_payload_json("What is the status?"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(lines[0]["ok"], true);
        assert!(lines[0]
            .get("streamId")
            .and_then(Value::as_str)
            .is_some_and(|id| !id.is_empty()));
        assert_eq!(lines[0].get("final"), None);
        let calls: Vec<_> = lines
            .iter()
            .filter(|m| m["kind"] == "request" && m["method"] == "module_call")
            .collect();
        assert_eq!(
            calls
                .iter()
                .map(|m| m["payload"]["operation"].as_str().unwrap_or(""))
                .collect::<Vec<_>>(),
            ["prepare", "stream", "close_stream"]
        );
        assert_eq!(calls[0]["module"], "model");
        let preparation_id = calls[0]["payload"]["preparationId"]
            .as_str()
            .expect("sidecar-minted preparationId");
        assert!(!preparation_id.is_empty());
        assert_eq!(calls[1]["payload"]["preparationId"], preparation_id);
        assert_eq!(calls[2]["payload"]["preparationId"], preparation_id);
        assert!(validate_module_message(calls[0]).is_ok());
        assert!(validate_module_message(calls[1]).is_ok());
        assert!(validate_module_message(calls[2]).is_ok());
        let events: Vec<_> = lines.iter().filter(|m| m["kind"] == "event").collect();
        assert_eq!(events[0]["final"], false);
        assert!(events[0].get("moduleInstanceId").is_none());
        assert!(events[0].get("connectionGeneration").is_none());
        let terminal = events
            .iter()
            .find(|m| m["final"] == true)
            .expect("final event");
        assert_eq!(terminal["outcome"], "completed");
        assert_eq!(terminal["eventType"], "agent.execute.completed");
        assert_eq!(terminal["payload"]["result"]["type"], "success");
        assert_eq!(terminal["payload"]["result"]["sessionId"], "run-1");
        assert_eq!(terminal["payload"]["result"]["turnId"], "op-1");
        assert!(validate_module_message(terminal).is_ok());
        assert!(validate_module_message(&lines[0]).is_ok());
        let message = events
            .iter()
            .find(|m| m["eventType"] == "agent.assistant_message")
            .expect("pure_text agent.assistant_message");
        assert_eq!(message["payload"]["type"], "assistant_message");
        assert_eq!(message["payload"]["message"]["content"][0]["type"], "text");
        assert_eq!(
            message["payload"]["message"]["content"][0]["text"],
            "HOST[What is the status?]"
        );
        assert!(message["payload"]["message"]["content"].is_array());
        assert!(terminal["payload"]["messages"][0]["content"].is_array());
        assert_eq!(
            terminal["payload"]["messages"][0]["content"][0]["type"],
            "text"
        );
        assert_eq!(
            terminal["payload"]["messages"][0]["content"][0]["text"],
            "HOST[What is the status?]"
        );
        assert_eq!(
            events
                .iter()
                .filter(|m| m["eventType"] == "agent.tool_calls_detected"
                    || m["eventType"] == "agent.tool_result")
                .count(),
            0
        );
    }

    #[test]
    fn execute_single_tool_emits_tool_call_result_and_final_text() {
        let (sidecar, sink) = collect_with_host(single_tool_host);
        sidecar.handle_line(&format!(
            r#"{{"kind":"request","messageId":"ex-st","method":"execute","runId":"run-st","operationId":"op-st","requestId":"req-st","sessionId":"sess-st","turnId":"turn-st","payload":{}}}"#,
            client_payload_json("Look up the status")
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(lines[0]["ok"], true);
        let calls: Vec<_> = lines
            .iter()
            .filter(|m| m["kind"] == "request" && m["method"] == "module_call")
            .collect();
        assert_eq!(
            calls
                .iter()
                .map(|m| (
                    m["module"].as_str().unwrap(),
                    m["payload"]["operation"].as_str().unwrap_or("")
                ))
                .collect::<Vec<_>>(),
            [
                ("model", "prepare"),
                ("model", "stream"),
                ("model", "close_stream"),
                ("capability", "execute"),
                ("model", "prepare"),
                ("model", "stream"),
                ("model", "close_stream"),
            ]
        );
        let events: Vec<_> = lines.iter().filter(|m| m["kind"] == "event").collect();
        let detected = events
            .iter()
            .find(|m| m["eventType"] == "agent.tool_calls_detected")
            .expect("tool_calls_detected");
        assert_eq!(detected["final"], false);
        assert_eq!(detected["payload"]["type"], "tool_calls_detected");
        assert_eq!(detected["payload"]["sessionId"], "sess-st");
        assert_eq!(detected["payload"]["turnId"], "turn-st");
        let call = &detected["payload"]["calls"][0];
        assert_eq!(call["name"], "lookup");
        assert_eq!(call["input"]["q"], "Look up the status");
        let tool_call_id = call["id"].as_str().expect("tool call id");
        assert!(!tool_call_id.is_empty());
        assert_eq!(call["timeline"]["id"], format!("tool:{tool_call_id}"));

        let tool_result = events
            .iter()
            .find(|m| m["eventType"] == "agent.tool_result")
            .expect("tool_result");
        assert_eq!(tool_result["payload"]["type"], "tool_result");
        assert_eq!(tool_result["payload"]["result"]["type"], "success");
        assert_eq!(tool_result["payload"]["result"]["toolName"], "lookup");
        assert_eq!(tool_result["payload"]["result"]["toolCallId"], tool_call_id);
        let result_text = tool_result["payload"]["result"]["content"][0]["text"]
            .as_str()
            .expect("tool result text");
        assert!(result_text.contains("Look up the status"));
        assert!(result_text.contains("lookup"));

        assert!(events
            .iter()
            .any(|m| m["eventType"] == "agent.turn_continued"
                && m["payload"]["reason"] == "next_turn"));

        let assistant = events
            .iter()
            .rev()
            .find(|m| m["eventType"] == "agent.assistant_message")
            .expect("final assistant_message");
        assert_eq!(assistant["payload"]["type"], "assistant_message");
        assert_eq!(
            assistant["payload"]["message"]["content"][0]["text"],
            "HOST[Look up the status]"
        );

        let terminal = events
            .iter()
            .find(|m| m["final"] == true)
            .expect("completed");
        assert_eq!(terminal["outcome"], "completed");
        assert_eq!(terminal["eventType"], "agent.execute.completed");
        assert_eq!(terminal["payload"]["result"]["type"], "success");
        assert_eq!(terminal["payload"]["result"]["sessionId"], "sess-st");
        assert_eq!(terminal["payload"]["result"]["turnId"], "turn-st");
        assert_eq!(terminal["payload"]["result"]["turns"], 2);
        let first_types: Vec<_> = terminal["payload"]["messages"][0]["content"]
            .as_array()
            .expect("assistant content")
            .iter()
            .map(|block| block["type"].as_str().unwrap_or(""))
            .collect();
        assert_eq!(first_types, ["tool_call"]);
        assert_eq!(
            terminal["payload"]["messages"][0]["content"][0]["timeline"]["id"],
            format!("tool:{tool_call_id}")
        );
        assert_eq!(
            terminal["payload"]["messages"][0]["content"][0]["timeline"]["order"],
            0
        );
        assert_eq!(
            terminal["payload"]["messages"][0]["content"][0]["timeline"]["revision"],
            2
        );
        assert!(terminal["payload"]["messages"][0]["content"][0]["timeline"]
            .get("previousId")
            .is_none());
        assert!(terminal["payload"]["messages"][0]["content"][0]
            .get("raw")
            .is_none());
        assert_eq!(
            terminal["payload"]["messages"][0]["metadata"]["model"],
            "pilotdeck-stub"
        );
        assert_eq!(
            terminal["payload"]["messages"][1]["content"]
                .as_array()
                .map(|c| c.len()),
            Some(1)
        );
        assert_eq!(
            terminal["payload"]["messages"][1]["content"][0]["type"],
            "tool_result"
        );
        assert!(terminal["payload"]["messages"][1]["content"][0]
            .get("raw")
            .is_some());
        assert_eq!(
            terminal["payload"]["messages"][1]["content"][0]["timeline"]["order"],
            1
        );
        assert_eq!(
            terminal["payload"]["messages"][1]["content"][0]["timeline"]["revision"],
            4
        );
        assert_eq!(
            terminal["payload"]["messages"][1]["content"][0]["timeline"]["previousId"],
            format!("tool:{tool_call_id}")
        );
        assert_eq!(
            terminal["payload"]["messages"][1]["content"][0]["raw"]["data"]["q"],
            "Look up the status"
        );
        assert!(terminal["payload"]["messages"][1]["content"][0]["raw"]
            .get("startedAt")
            .is_none());
        assert!(terminal["payload"]["messages"][1]["content"][0]["raw"]
            .get("completedAt")
            .is_none());
        assert_eq!(
            terminal["payload"]["messages"][2]["content"][0]["text"],
            "HOST[Look up the status]"
        );
        for event in &events {
            assert!(validate_module_message(event).is_ok(), "{event}");
        }
        assert!(validate_module_message(&lines[0]).is_ok());
    }

    #[test]
    fn single_tool_emits_durable_assistant_message_and_tool_results_projected() {
        let (sidecar, sink) = collect_with_host(single_tool_host);
        sidecar.handle_line(&format!(
            r#"{{"kind":"request","messageId":"ex-dur","method":"execute","runId":"run-dur","operationId":"op-dur","requestId":"req-dur","sessionId":"sess-dur","turnId":"turn-dur","payload":{}}}"#,
            client_payload_json("Look up the status")
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let events: Vec<_> = lines.iter().filter(|m| m["kind"] == "event").collect();
        let types: Vec<&str> = events
            .iter()
            .filter_map(|m| m["eventType"].as_str())
            .collect();
        let idx = |event_type: &str, pred: &dyn Fn(&Value) -> bool| {
            events
                .iter()
                .position(|m| m["eventType"] == event_type && pred(m))
                .unwrap_or_else(|| panic!("missing {event_type} in {types:?}"))
        };
        let assistant_tool = idx("agent.assistant_message", &|m| {
            m["payload"]["message"]["content"][0]["type"] == "tool_call"
        });
        let detected = idx("agent.tool_calls_detected", &|_| true);
        let tool_result = idx("agent.tool_result", &|_| true);
        let projected = idx("agent.tool_results_projected", &|_| true);
        let continued = idx("agent.turn_continued", &|m| {
            m["payload"]["reason"] == "next_turn"
        });
        let assistant_final = idx("agent.assistant_message", &|m| {
            m["payload"]["message"]["content"][0]["type"] == "text"
        });
        assert_eq!(
            events
                .iter()
                .filter(|m| m["eventType"] == "agent.tool_results_projected")
                .count(),
            1,
            "one projected event for the merged results message"
        );
        let assistant_line = lines
            .iter()
            .position(|m| m["eventType"] == "agent.assistant_message")
            .expect("assistant_message line");
        let capability_line = lines
            .iter()
            .position(|m| {
                m["kind"] == "request"
                    && m["module"] == "capability"
                    && m["payload"]["operation"] == "execute"
            })
            .expect("capability.execute");
        assert!(
            assistant_line < capability_line,
            "assistant_message must precede capability.execute"
        );
        assert!(
            assistant_tool < detected
                && detected < tool_result
                && tool_result < projected
                && projected < continued
                && continued < assistant_final,
            "durable order {types:?}"
        );

        let tool_msg = events[assistant_tool];
        assert_eq!(tool_msg["payload"]["type"], "assistant_message");
        assert_eq!(tool_msg["payload"]["sessionId"], "sess-dur");
        assert_eq!(tool_msg["payload"]["turnId"], "turn-dur");
        assert_eq!(tool_msg["payload"]["message"]["role"], "assistant");
        assert!(tool_msg["payload"]["message"]["content"].is_array());
        assert_eq!(
            tool_msg["payload"]["message"]["content"][0]["type"],
            "tool_call"
        );
        let tool_call_id = tool_msg["payload"]["message"]["content"][0]["id"]
            .as_str()
            .expect("tool call id");
        assert_eq!(
            tool_msg["payload"]["message"]["content"][0]["timeline"]["id"],
            format!("tool:{tool_call_id}")
        );
        assert_eq!(
            tool_msg["payload"]["message"]["content"][0]["timeline"]["order"],
            0
        );
        assert_eq!(
            tool_msg["payload"]["message"]["content"][0]["timeline"]["revision"],
            2
        );
        assert!(tool_msg["payload"]["message"]["content"][0]
            .get("raw")
            .is_none());
        assert_eq!(
            tool_msg["payload"]["message"]["metadata"]["model"],
            "pilotdeck-stub"
        );
        assert!(validate_module_message(tool_msg).is_ok());

        let projected_msg = events[projected];
        assert_eq!(projected_msg["payload"]["type"], "tool_results_projected");
        assert_eq!(projected_msg["payload"]["sessionId"], "sess-dur");
        assert_eq!(projected_msg["payload"]["turnId"], "turn-dur");
        assert_eq!(projected_msg["payload"]["message"]["role"], "user");
        assert!(projected_msg["payload"]["message"]["content"].is_array());
        assert_eq!(
            projected_msg["payload"]["message"]["content"][0]["type"],
            "tool_result"
        );
        assert_eq!(
            projected_msg["payload"]["message"]["content"][0]["toolCallId"],
            tool_call_id
        );
        assert_eq!(
            projected_msg["payload"]["message"]["content"][0]["timeline"]["id"],
            format!("result:{tool_call_id}")
        );
        assert_eq!(
            projected_msg["payload"]["message"]["content"][0]["timeline"]["order"],
            1
        );
        assert_eq!(
            projected_msg["payload"]["message"]["content"][0]["timeline"]["revision"],
            4
        );
        assert!(projected_msg["payload"]["message"]["content"][0]
            .get("raw")
            .is_some());
        assert_eq!(
            projected_msg["payload"]["message"]["content"][0]["raw"]["data"]["q"],
            "Look up the status"
        );
        assert!(validate_module_message(projected_msg).is_ok());
    }

    #[test]
    fn execute_single_tool_prompt_mutation_changes_output() {
        let (sidecar, sink) = collect_with_host(single_tool_host);
        sidecar.handle_line(&execute_line(
            "ex-a",
            "run-a",
            "op-a",
            "req-a",
            &client_payload_json("alpha-prompt"),
        ));
        sidecar.join();
        sidecar.handle_line(&execute_line(
            "ex-b",
            "run-b",
            "op-b",
            "req-b",
            &client_payload_json("beta-prompt"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let finals: Vec<_> = lines
            .iter()
            .filter(|m| {
                m["eventType"] == "agent.assistant_message"
                    && m["payload"]["message"]["content"][0]["type"] == "text"
            })
            .collect();
        assert_eq!(finals.len(), 2);
        let text_a = finals[0]["payload"]["message"]["content"][0]["text"]
            .as_str()
            .unwrap();
        let text_b = finals[1]["payload"]["message"]["content"][0]["text"]
            .as_str()
            .unwrap();
        assert_ne!(text_a, text_b);
        assert!(text_a.contains("alpha-prompt"));
        assert!(text_b.contains("beta-prompt"));
        let inputs: Vec<_> = lines
            .iter()
            .filter(|m| m["eventType"] == "agent.tool_calls_detected")
            .map(|m| {
                m["payload"]["calls"][0]["input"]["q"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(inputs, ["alpha-prompt", "beta-prompt"]);
    }

    #[test]
    fn execute_prompt_comes_from_last_user_text_block_not_q_or_tools() {
        let (sidecar, sink) = collect_with_host(text_host);
        let payload = json!({
            "q": "ignore-q",
            "scenario": "single_tool",
            "tools": [{ "name": "lookup", "inputSchema": {} }],
            "messages": [
                { "role": "user", "content": [{ "type": "text", "text": "first" }] },
                { "role": "assistant", "content": [{ "type": "text", "text": "ack" }] },
                { "role": "user", "content": [{ "type": "text", "text": "block-prompt" }] }
            ]
        });
        sidecar.handle_line(&execute_line(
            "ex-b1",
            "run-b1",
            "op-b1",
            "req-b1",
            &payload.to_string(),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let call = lines
            .iter()
            .find(|m| m["kind"] == "request" && m["method"] == "module_call")
            .expect("model module_call");
        assert_eq!(
            last_user_text_from_messages(call.pointer("/payload/request/messages")).as_deref(),
            Some("block-prompt")
        );
        let message = lines
            .iter()
            .find(|m| m["eventType"] == "agent.assistant_message")
            .expect("text path despite tools[] + scenario");
        assert_eq!(
            message["payload"]["message"]["content"][0]["text"],
            "HOST[block-prompt]"
        );
        assert!(lines.iter().all(
            |m| m.get("eventType").and_then(Value::as_str) != Some("agent.tool_calls_detected")
        ));
    }

    #[test]
    fn completed_final_echoes_request_session_and_turn_ids() {
        let (sidecar, sink) = collect_with_host(text_host);
        sidecar.handle_line(&format!(
            r#"{{"kind":"request","messageId":"ex-ids","method":"execute","runId":"run-ids","operationId":"op-ids","requestId":"req-ids","sessionId":"sess-host","turnId":"turn-host","payload":{}}}"#,
            client_payload_json("hi")
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let terminal = lines
            .iter()
            .find(|m| m["kind"] == "event" && m["final"] == true)
            .expect("final event");
        assert_eq!(terminal["payload"]["result"]["type"], "success");
        assert_eq!(terminal["payload"]["result"]["sessionId"], "sess-host");
        assert_eq!(terminal["payload"]["result"]["turnId"], "turn-host");
        assert_eq!(terminal["payload"]["result"]["stopReason"], "completed");
    }

    #[test]
    fn execute_duplicate_keys_use_last_request_id() {
        let (sidecar, sink) = collect_with_host(text_host);
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"ex-dup","method":"execute","runId":"run-1","operationId":"op-dup","requestId":"first","payload":{"q":"A"},"requestId":"second","payload":{"messages":[{"role":"user","content":[{"type":"text","text":"B"}]}]}}"#,
        );
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(lines[0]["requestId"], "second");
        let terminal = lines
            .iter()
            .find(|m| m["kind"] == "event" && m["final"] == true)
            .unwrap();
        assert_eq!(terminal["requestId"], "second");
        assert_eq!(
            terminal["payload"]["messages"][0]["content"][0]["type"],
            "text"
        );
        assert!(terminal["payload"]["messages"][0]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains('B'));
    }

    fn assert_content_is_block_array(content: &Value, where_: &str) {
        let blocks = content
            .as_array()
            .unwrap_or_else(|| panic!("{where_}: content must be a block array, have {content}"));
        assert!(
            !blocks.is_empty(),
            "{where_}: content blocks must not be empty"
        );
        for block in blocks {
            assert!(
                block
                    .get("type")
                    .and_then(Value::as_str)
                    .is_some_and(|ty| !ty.is_empty()),
                "{where_}: each block needs type, have {block}"
            );
        }
    }

    fn assert_outbound_contents_are_blocks(lines: &[Value]) {
        for message in lines {
            if let Some(messages) = message
                .pointer("/payload/messages")
                .and_then(Value::as_array)
            {
                for (index, item) in messages.iter().enumerate() {
                    if item.get("content").is_some() {
                        assert_content_is_block_array(
                            &item["content"],
                            &format!("payload.messages[{index}] in {message}"),
                        );
                    }
                }
            }
            if message.pointer("/payload/message/content").is_some() {
                assert_content_is_block_array(
                    &message["payload"]["message"]["content"],
                    &format!("payload.message.content in {message}"),
                );
            }
            if message.pointer("/payload/result/content").is_some() {
                assert_content_is_block_array(
                    &message["payload"]["result"]["content"],
                    &format!("payload.result.content in {message}"),
                );
            }
            if let Some(messages) = message
                .pointer("/payload/request/messages")
                .and_then(Value::as_array)
            {
                for (index, item) in messages.iter().enumerate() {
                    if item.get("content").is_some() {
                        assert_content_is_block_array(
                            &item["content"],
                            &format!("module_call request.messages[{index}] in {message}"),
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn outbound_content_is_block_array_for_pure_text_and_single_tool() {
        let (sidecar, sink) = collect_with_host(text_host);
        sidecar.handle_line(&execute_line(
            "ex-text",
            "run-text",
            "op-text",
            "req-text",
            &client_payload_json("What is the status?"),
        ));
        sidecar.join();
        let text_lines = sink.lock().expect("sink").clone();
        assert_outbound_contents_are_blocks(&text_lines);
        let text_terminal = text_lines
            .iter()
            .find(|m| m["eventType"] == "agent.execute.completed")
            .expect("pure_text completed");
        assert_content_is_block_array(
            &text_terminal["payload"]["messages"][0]["content"],
            "pure_text completed messages[0].content",
        );
        let text_event = text_lines
            .iter()
            .find(|m| m["eventType"] == "agent.assistant_message")
            .expect("pure_text assistant_message");
        assert_content_is_block_array(
            &text_event["payload"]["message"]["content"],
            "pure_text assistant_message.content",
        );

        let (sidecar, sink) = collect_with_host(single_tool_host);
        sidecar.handle_line(&execute_line(
            "ex-tool",
            "run-tool",
            "op-tool",
            "req-tool",
            &client_payload_json("Look up the status"),
        ));
        sidecar.join();
        let tool_lines = sink.lock().expect("sink").clone();
        assert_outbound_contents_are_blocks(&tool_lines);
        let tool_terminal = tool_lines
            .iter()
            .find(|m| m["eventType"] == "agent.execute.completed")
            .expect("single_tool completed");
        for (index, item) in tool_terminal["payload"]["messages"]
            .as_array()
            .expect("single_tool messages")
            .iter()
            .enumerate()
        {
            assert_content_is_block_array(
                &item["content"],
                &format!("single_tool completed messages[{index}].content"),
            );
        }
        let tool_event = tool_lines
            .iter()
            .find(|m| m["eventType"] == "agent.assistant_message")
            .expect("single_tool assistant_message");
        assert_content_is_block_array(
            &tool_event["payload"]["message"]["content"],
            "single_tool assistant_message.content",
        );
    }

    fn capability_string_or_blocks_host(
        content: Value,
    ) -> impl Fn(&Value) -> Option<Value> + Send + Sync + 'static {
        move |call: &Value| match call.get("module").and_then(Value::as_str) {
            Some("model") => single_tool_host(call),
            Some("capability") => Some(host_ok(
                call,
                json!({
                    "type": "success",
                    "toolCallId": call.pointer("/payload/toolCallId"),
                    "toolName": call.pointer("/payload/name"),
                    "content": content,
                }),
            )),
            _ => None,
        }
    }

    #[test]
    fn capability_result_wraps_host_string_content_as_text_block() {
        let (sidecar, sink) =
            collect_with_host(capability_string_or_blocks_host(json!("plain-host-text")));
        sidecar.handle_line(&execute_line(
            "ex-cap-s",
            "run-cap-s",
            "op-cap-s",
            "req-cap-s",
            &client_payload_json("Look up the status"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let tool_result = lines
            .iter()
            .find(|m| m["eventType"] == "agent.tool_result")
            .expect("tool_result");
        assert_eq!(
            tool_result["payload"]["result"]["content"],
            json!([{ "type": "text", "text": "plain-host-text" }])
        );
        assert_outbound_contents_are_blocks(&lines);
    }

    #[test]
    fn capability_result_keeps_host_content_block_array() {
        let blocks = json!([
            { "type": "text", "text": "block-one" },
            { "type": "text", "text": "block-two" }
        ]);
        let (sidecar, sink) = collect_with_host(capability_string_or_blocks_host(blocks.clone()));
        sidecar.handle_line(&execute_line(
            "ex-cap-a",
            "run-cap-a",
            "op-cap-a",
            "req-cap-a",
            &client_payload_json("Look up the status"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let tool_result = lines
            .iter()
            .find(|m| m["eventType"] == "agent.tool_result")
            .expect("tool_result");
        assert_eq!(tool_result["payload"]["result"]["content"], blocks);
        assert_outbound_contents_are_blocks(&lines);
    }

    fn budget_snapshot() -> Value {
        json!({
            "tokens": 10,
            "maxContextTokens": 128000,
            "warningRatio": 0.8,
            "blockingRatio": 0.9,
            "state": "ok",
            "ratio": 0.000078125
        })
    }

    fn with_budget_host(
        inner: impl Fn(&Value) -> Option<Value> + Send + Sync + 'static,
    ) -> impl Fn(&Value) -> Option<Value> + Send + Sync + 'static {
        move |call: &Value| {
            if call.get("module").and_then(Value::as_str) == Some("budget") {
                return Some(host_ok(call, json!({ "snapshot": budget_snapshot() })));
            }
            inner(call)
        }
    }

    fn payload_with_budget_and_view(user_text: &str) -> String {
        json!({
            "agent": {
                "id": "pilotdeck-stub",
                "provider": "pilotdeck-stub",
                "model": "pilotdeck-stub",
                "maxOutputTokens": 1024,
                "maxContextTokens": 128000,
                "systemPrompt": "You are a test agent."
            },
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": user_text }]
            }],
            "tools": [{
                "name": "lookup",
                "description": "Look up a value",
                "inputSchema": { "type": "object" },
                "permission": "auto",
                "extraManifestField": true
            }],
            "hostModules": {
                "model": true,
                "capability": true,
                "budget": { "methods": ["evaluate_request_budget"] }
            }
        })
        .to_string()
    }

    #[test]
    fn context_budget_is_emitted_when_host_advertises_budget() {
        let (sidecar, sink) = collect_with_host(with_budget_host(text_host));
        sidecar.handle_line(&execute_line(
            "ex-bud",
            "run-bud",
            "op-bud",
            "req-bud",
            &payload_with_budget_and_view("What is the status?"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let budget = lines
            .iter()
            .find(|m| m["eventType"] == "agent.context_budget")
            .expect("context_budget");
        assert_eq!(budget["payload"]["type"], "context_budget");
        assert_eq!(budget["payload"]["snapshot"]["tokens"], 10);
        assert_eq!(budget["payload"]["snapshot"]["state"], "ok");
        assert!(lines.iter().any(|m| {
            m["kind"] == "request"
                && m["module"] == "budget"
                && m["payload"]["operation"] == "evaluate_request_budget"
        }));
    }

    #[test]
    fn model_request_carries_agent_view_not_raw_manifest() {
        let (sidecar, sink) = collect_with_host(with_budget_host(text_host));
        sidecar.handle_line(&execute_line(
            "ex-view",
            "run-view",
            "op-view",
            "req-view",
            &payload_with_budget_and_view("What is the status?"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let prepare = lines
            .iter()
            .find(|m| {
                m["kind"] == "request"
                    && m["module"] == "model"
                    && m["payload"]["operation"] == "prepare"
            })
            .expect("prepare");
        let request = &prepare["payload"]["request"];
        assert_eq!(request["maxOutputTokens"], 1024);
        assert_eq!(request["systemPrompt"], "You are a test agent.");
        assert_eq!(request["stream"], true);
        assert_eq!(request["tools"][0]["name"], "lookup");
        assert_eq!(request["tools"][0]["description"], "Look up a value");
        assert_eq!(
            request["tools"][0]["inputSchema"],
            json!({ "type": "object" })
        );
        assert!(request["tools"][0].get("permission").is_none());
        assert!(request["tools"][0].get("extraManifestField").is_none());
    }

    fn payload_with_gated_tools(user_text: &str) -> String {
        json!({
            "agent": {
                "id": "pilotdeck-stub",
                "provider": "pilotdeck-stub",
                "model": "pilotdeck-stub",
                "maxOutputTokens": 1024,
                "systemPrompt": "You are a test agent."
            },
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": user_text }]
            }],
            "tools": [
                { "name": "lookup", "description": "Look up", "inputSchema": { "type": "object" } },
                { "name": "ask_user_question", "description": "Ask", "inputSchema": { "type": "object" }, "requiresUserInteraction": true },
                { "name": "enter_plan_mode", "description": "Enter plan", "inputSchema": { "type": "object" } },
                { "name": "exit_plan_mode", "description": "Exit plan", "inputSchema": { "type": "object" } }
            ],
            "permissionContext": { "mode": "default", "canPrompt": false },
            "hostModules": {
                "model": true,
                "capability": true,
                "budget": { "methods": ["evaluate_request_budget"] }
            }
        })
        .to_string()
    }

    #[test]
    fn model_request_filters_plan_and_prompt_gated_tools() {
        let (sidecar, sink) = collect_with_host(with_budget_host(text_host));
        sidecar.handle_line(&execute_line(
            "ex-filter",
            "run-filter",
            "op-filter",
            "req-filter",
            &payload_with_gated_tools("What is the status?"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let prepare = lines
            .iter()
            .find(|m| {
                m["kind"] == "request"
                    && m["module"] == "model"
                    && m["payload"]["operation"] == "prepare"
            })
            .expect("prepare");
        let tools = prepare["payload"]["request"]["tools"]
            .as_array()
            .expect("tools");
        let names: Vec<&str> = tools
            .iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str))
            .collect();
        assert_eq!(names, vec!["lookup"]);
    }

    fn with_prepared_context_host(
        inner: impl Fn(&Value) -> Option<Value> + Send + Sync + 'static,
    ) -> impl Fn(&Value) -> Option<Value> + Send + Sync + 'static {
        move |call: &Value| {
            if call.get("module").and_then(Value::as_str) == Some("context") {
                let input = call.pointer("/payload/input").cloned().unwrap_or(json!({}));
                return Some(host_ok(
                    call,
                    json!({
                        "result": {
                            "messages": input.get("messages").cloned().unwrap_or(json!([])),
                            "systemPrompt": "PREPARED_SYSTEM_PROMPT",
                            "systemPromptParts": ["PREPARED_SYSTEM_PROMPT"],
                            "tools": input.get("tools").cloned().unwrap_or(json!([])),
                            "diagnostics": [],
                            "boundaries": []
                        }
                    }),
                ));
            }
            inner(call)
        }
    }

    fn payload_with_context(user_text: &str) -> String {
        json!({
            "agent": {
                "id": "pilotdeck-stub",
                "provider": "pilotdeck-stub",
                "model": "pilotdeck-stub",
                "cwd": "/tmp/test-home",
                "maxOutputTokens": 1024,
                "systemPrompt": "You are a test agent."
            },
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": user_text }]
            }],
            "tools": [
                { "name": "lookup", "description": "Look up", "inputSchema": { "type": "object" } },
                { "name": "ask_user_question", "description": "Ask", "inputSchema": { "type": "object" }, "requiresUserInteraction": true },
                { "name": "enter_plan_mode", "description": "Enter plan", "inputSchema": { "type": "object" } },
                { "name": "exit_plan_mode", "description": "Exit plan", "inputSchema": { "type": "object" } }
            ],
            "permissionContext": { "mode": "default", "canPrompt": false },
            "hostModules": {
                "model": true,
                "capability": true,
                "budget": { "methods": ["evaluate_request_budget"] },
                "context": { "methods": ["prepare_for_model"] }
            }
        })
        .to_string()
    }

    #[test]
    fn prepare_for_model_supplies_system_prompt_and_filtered_tools() {
        let (sidecar, sink) =
            collect_with_host(with_budget_host(with_prepared_context_host(text_host)));
        sidecar.handle_line(&execute_line(
            "ex-prep",
            "run-prep",
            "op-prep",
            "req-prep",
            &payload_with_context("What is the status?"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let prepare_ctx = lines
            .iter()
            .find(|m| {
                m["kind"] == "request"
                    && m["module"] == "context"
                    && m["payload"]["operation"] == "prepare_for_model"
            })
            .expect("prepare_for_model");
        let sent_tools = prepare_ctx["payload"]["input"]["tools"]
            .as_array()
            .expect("input tools");
        let sent_names: Vec<&str> = sent_tools
            .iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str))
            .collect();
        assert_eq!(sent_names, vec!["lookup"]);
        assert_eq!(
            prepare_ctx["payload"]["input"]["customSystemPrompt"],
            "You are a test agent."
        );
        let budget = lines
            .iter()
            .find(|m| {
                m["kind"] == "request"
                    && m["module"] == "budget"
                    && m["payload"]["operation"] == "evaluate_request_budget"
            })
            .expect("budget");
        assert_eq!(
            budget["payload"]["request"]["systemPrompt"],
            "PREPARED_SYSTEM_PROMPT"
        );
        let prepare = lines
            .iter()
            .find(|m| {
                m["kind"] == "request"
                    && m["module"] == "model"
                    && m["payload"]["operation"] == "prepare"
            })
            .expect("prepare");
        let request = &prepare["payload"]["request"];
        assert_eq!(request["systemPrompt"], "PREPARED_SYSTEM_PROMPT");
        assert_eq!(request["tools"][0]["name"], "lookup");
        assert_eq!(request["tools"].as_array().map(|t| t.len()), Some(1));
    }

    fn text_then_tool_host(call: &Value) -> Option<Value> {
        if call.get("module").and_then(Value::as_str) != Some("model") {
            return single_tool_host(call);
        }
        if conversation_has_tool_result(call) {
            return text_host(call);
        }
        let prompt = last_user_from_call(call);
        reply_model_ops(
            call,
            json!([
                { "type": "request_started", "provider": STUB_PROVIDER, "model": STUB_MODEL },
                { "type": "message_start", "role": "assistant" },
                { "type": "text_delta", "text": format!("before-tool:{prompt}") },
                {
                    "type": "tool_call_end",
                    "toolCall": {
                        "id": "host-tool-1",
                        "name": "lookup",
                        "input": { "q": prompt }
                    }
                },
                { "type": "message_end", "finishReason": "tool_call" }
            ]),
        )
    }

    #[test]
    fn first_round_keeps_text_before_tool_calls_in_one_assistant_message() {
        let (sidecar, sink) = collect_with_host(text_then_tool_host);
        sidecar.handle_line(&execute_line(
            "ex-pre",
            "run-pre",
            "op-pre",
            "req-pre",
            &client_payload_json("Look up the status"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let terminal = lines
            .iter()
            .find(|m| m["eventType"] == "agent.execute.completed")
            .expect("completed");
        let content = terminal["payload"]["messages"][0]["content"]
            .as_array()
            .expect("merged assistant");
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[0]["text"], "before-tool:Look up the status");
        assert_eq!(content[1]["type"], "tool_call");
        assert_eq!(
            terminal["payload"]["messages"][1]["content"]
                .as_array()
                .map(|c| c.len()),
            Some(1)
        );
        assert_eq!(
            lines
                .iter()
                .filter(|m| m["eventType"] == "agent.tool_calls_detected")
                .count(),
            1
        );
    }

    fn multi_tool_host(call: &Value) -> Option<Value> {
        match call.get("module").and_then(Value::as_str) {
            Some("model") if !conversation_has_tool_result(call) => reply_model_ops(
                call,
                json!([
                    { "type": "request_started", "provider": STUB_PROVIDER, "model": STUB_MODEL },
                    { "type": "message_start", "role": "assistant" },
                    {
                        "type": "tool_call_end",
                        "toolCall": { "id": "t1", "name": "lookup", "input": { "q": "one" } }
                    },
                    {
                        "type": "tool_call_end",
                        "toolCall": { "id": "t2", "name": "lookup", "input": { "q": "two" } }
                    },
                    { "type": "message_end", "finishReason": "tool_call" }
                ]),
            ),
            Some("model") => text_host(call),
            Some("capability") => single_tool_host(call),
            _ => None,
        }
    }

    #[test]
    fn same_round_tool_calls_merge_into_one_assistant_and_one_results_message() {
        let (sidecar, sink) = collect_with_host(multi_tool_host);
        sidecar.handle_line(&execute_line(
            "ex-mt",
            "run-mt",
            "op-mt",
            "req-mt",
            &client_payload_json("Look up the status"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let terminal = lines
            .iter()
            .find(|m| m["eventType"] == "agent.execute.completed")
            .expect("completed");
        assert_eq!(
            terminal["payload"]["messages"][0]["content"]
                .as_array()
                .map(|c| c.iter().filter(|b| b["type"] == "tool_call").count()),
            Some(2)
        );
        assert_eq!(
            terminal["payload"]["messages"][1]["content"]
                .as_array()
                .map(|c| c.iter().filter(|b| b["type"] == "tool_result").count()),
            Some(2)
        );
        assert_eq!(
            lines
                .iter()
                .filter(|m| m["eventType"] == "agent.tool_calls_detected")
                .count(),
            1
        );
        assert_eq!(
            lines
                .iter()
                .filter(|m| m["eventType"] == "agent.tool_results_projected")
                .count(),
            1,
            "merged results message emits one tool_results_projected"
        );
    }

    fn always_tool_host(call: &Value) -> Option<Value> {
        match call.get("module").and_then(Value::as_str) {
            Some("model") => {
                let prompt = last_user_from_call(call);
                reply_model_ops(call, tool_events(&prompt))
            }
            Some("capability") => single_tool_host(call),
            _ => None,
        }
    }

    #[test]
    fn second_round_tool_calls_fail_explicitly() {
        let (sidecar, sink) = collect_with_host(always_tool_host);
        sidecar.handle_line(&execute_line(
            "ex-2t",
            "run-2t",
            "op-2t",
            "req-2t",
            &client_payload_json("Look up the status"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let terminal = lines
            .iter()
            .find(|m| m["kind"] == "event" && m["final"] == true)
            .expect("terminal");
        assert_eq!(terminal["outcome"], "failed");
        assert_eq!(terminal["code"], "UNEXPECTED_SECOND_TURN_TOOL_CALLS");
    }

    fn capability_error_or_filter_host(
        content: Value,
        error: Option<Value>,
    ) -> impl Fn(&Value) -> Option<Value> + Send + Sync + 'static {
        move |call: &Value| match call.get("module").and_then(Value::as_str) {
            Some("model") => single_tool_host(call),
            Some("capability") => {
                let mut payload = json!({
                    "type": if error.is_some() { "error" } else { "success" },
                    "toolCallId": call.pointer("/payload/toolCallId"),
                    "toolName": call.pointer("/payload/name"),
                    "content": content,
                });
                if let Some(error) = &error {
                    payload["error"] = error.clone();
                }
                Some(host_ok(call, payload))
            }
            _ => None,
        }
    }

    #[test]
    fn capability_result_keeps_error_and_marks_tool_result_is_error() {
        let (sidecar, sink) = collect_with_host(capability_error_or_filter_host(
            json!([{ "type": "text", "text": "boom" }]),
            Some(json!({ "code": "tool_failed", "message": "lookup failed" })),
        ));
        sidecar.handle_line(&execute_line(
            "ex-err",
            "run-err",
            "op-err",
            "req-err",
            &client_payload_json("Look up the status"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let tool_result = lines
            .iter()
            .find(|m| m["eventType"] == "agent.tool_result")
            .expect("tool_result");
        assert_eq!(tool_result["payload"]["result"]["type"], "error");
        assert_eq!(
            tool_result["payload"]["result"]["error"]["code"],
            "tool_failed"
        );
        let terminal = lines
            .iter()
            .find(|m| m["eventType"] == "agent.execute.completed")
            .expect("completed");
        assert_eq!(
            terminal["payload"]["messages"][1]["content"][0]["isError"],
            true
        );
    }

    fn capability_execute_fail_host(call: &Value) -> Option<Value> {
        match call.get("module").and_then(Value::as_str) {
            Some("model") => single_tool_host(call),
            Some("capability") => Some(host_fail(call, "HOST_REJECTED")),
            _ => None,
        }
    }

    fn capability_execute_hang_host(call: &Value) -> Option<Value> {
        match call.get("module").and_then(Value::as_str) {
            Some("model") => single_tool_host(call),
            Some("capability") => None,
            _ => None,
        }
    }

    fn capability_execute_fail_first_of_two_host(call: &Value) -> Option<Value> {
        match call.get("module").and_then(Value::as_str) {
            Some("model") if !conversation_has_tool_result(call) => reply_model_ops(
                call,
                json!([
                    { "type": "request_started", "provider": STUB_PROVIDER, "model": STUB_MODEL },
                    { "type": "message_start", "role": "assistant" },
                    {
                        "type": "tool_call_end",
                        "toolCall": { "id": "t1", "name": "lookup", "input": { "q": "one" } }
                    },
                    {
                        "type": "tool_call_end",
                        "toolCall": { "id": "t2", "name": "lookup", "input": { "q": "two" } }
                    },
                    { "type": "message_end", "finishReason": "tool_call" }
                ]),
            ),
            Some("model") => text_host(call),
            Some("capability") => Some(host_fail(call, "HOST_REJECTED")),
            _ => None,
        }
    }

    /// First capability.execute succeeds; the second fails. Locks Rust
    /// sequential `[success, error]` (known-diff vs TS whole-batch catch).
    fn capability_execute_ok_then_fail_host(call: &Value) -> Option<Value> {
        match call.get("module").and_then(Value::as_str) {
            Some("model") if !conversation_has_tool_result(call) => reply_model_ops(
                call,
                json!([
                    { "type": "request_started", "provider": STUB_PROVIDER, "model": STUB_MODEL },
                    { "type": "message_start", "role": "assistant" },
                    {
                        "type": "tool_call_end",
                        "toolCall": { "id": "t1", "name": "lookup", "input": { "q": "one" } }
                    },
                    {
                        "type": "tool_call_end",
                        "toolCall": { "id": "t2", "name": "lookup", "input": { "q": "two" } }
                    },
                    { "type": "message_end", "finishReason": "tool_call" }
                ]),
            ),
            Some("model") => text_host(call),
            Some("capability") => {
                let id = call
                    .pointer("/payload/toolCallId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if id == "t1" {
                    Some(host_ok(
                        call,
                        json!({
                            "type": "success",
                            "toolCallId": "t1",
                            "toolName": "lookup",
                            "content": [{ "type": "text", "text": "ok-one" }],
                        }),
                    ))
                } else {
                    Some(host_fail(call, "HOST_REJECTED"))
                }
            }
            _ => None,
        }
    }

    fn capability_error_without_type_host(call: &Value) -> Option<Value> {
        match call.get("module").and_then(Value::as_str) {
            Some("model") => single_tool_host(call),
            Some("capability") => Some(host_ok(
                call,
                json!({
                    "toolCallId": call.pointer("/payload/toolCallId"),
                    "toolName": call.pointer("/payload/name"),
                    "error": { "code": "tool_failed", "message": "lookup failed" },
                    "content": [{ "type": "text", "text": "boom" }],
                }),
            )),
            _ => None,
        }
    }

    fn assert_synthesized_recovery_result(
        result: &Value,
        tool_name: &str,
        raw_message: &str,
        cwd: &str,
        permission_mode: &str,
    ) {
        assert_eq!(result["type"], "error");
        assert_eq!(result["error"]["code"], "tool_execution_failed");
        assert_eq!(result["error"]["message"], raw_message);
        let expected = crate::error_recovery::build_tool_error_recovery(
            "tool_execution_failed",
            tool_name,
            raw_message,
            cwd,
            permission_mode,
        );
        assert_eq!(result["content"][0]["type"], "text");
        assert_eq!(result["content"][0]["text"], expected.message);
        assert_eq!(result["metadata"]["recovery"], expected.advice.to_json());
        assert!(
            result["startedAt"]
                .as_str()
                .is_some_and(|ts| parse_iso_ms(ts).is_some()),
            "startedAt must be ISO-8601, got {}",
            result["startedAt"]
        );
        assert!(
            result["completedAt"]
                .as_str()
                .is_some_and(|ts| parse_iso_ms(ts).is_some()),
            "completedAt must be ISO-8601, got {}",
            result["completedAt"]
        );
    }

    fn client_payload_with_module_call_timeout(user_text: &str, timeout_ms: u64) -> String {
        let mut payload: Value =
            serde_json::from_str(&client_payload_json(user_text)).expect("payload");
        payload["moduleCallTimeoutMs"] = json!(timeout_ms);
        payload.to_string()
    }

    /// QA G5 / TS AgentLoop.ts:2029 then :2032 / :2070-2071 — every outstanding
    /// tool_call gets an isError tool_result (`result.ts:66`) before projected.
    fn assert_is_error_tool_results_then_projected(lines: &[Value], expected_ids: &[&str]) {
        let events: Vec<_> = lines.iter().filter(|m| m["kind"] == "event").collect();
        let types: Vec<&str> = events
            .iter()
            .filter_map(|m| m["eventType"].as_str())
            .collect();
        let result_idxs: Vec<usize> = events
            .iter()
            .enumerate()
            .filter(|(_, m)| m["eventType"] == "agent.tool_result")
            .map(|(i, _)| i)
            .collect();
        let projected_idx = events
            .iter()
            .position(|m| m["eventType"] == "agent.tool_results_projected")
            .unwrap_or_else(|| panic!("missing projected in {types:?}"));
        assert_eq!(
            result_idxs.len(),
            expected_ids.len(),
            "one tool_result per outstanding tool_call, have {types:?}"
        );
        for (idx, expected_id) in result_idxs.iter().zip(expected_ids) {
            assert!(
                *idx < projected_idx,
                "tool_result must precede projected: {types:?}"
            );
            let result = &events[*idx]["payload"]["result"];
            assert_eq!(result["type"], "error");
            assert_eq!(result["toolCallId"], *expected_id);
            assert_eq!(result["error"]["code"], "tool_execution_failed");
            assert!(result.get("error").and_then(|e| e.get("message")).is_some());
        }
        assert!(
            events[projected_idx + 1..]
                .iter()
                .all(|m| m["eventType"] != "agent.tool_result"),
            "no tool_result after projected: {types:?}"
        );
        let blocks = events[projected_idx]["payload"]["message"]["content"]
            .as_array()
            .expect("projected content");
        assert_eq!(blocks.len(), expected_ids.len());
        for (block, expected_id) in blocks.iter().zip(expected_ids) {
            assert_eq!(block["type"], "tool_result");
            assert_eq!(block["toolCallId"], *expected_id);
            assert_eq!(block["isError"], true);
        }
    }

    #[test]
    fn capability_execute_fail_emits_is_error_tool_result_then_projected() {
        let (sidecar, sink) = collect_with_host(capability_execute_fail_host);
        sidecar.handle_line(&execute_line(
            "ex-cap-fail",
            "run-cap-fail",
            "op-cap-fail",
            "req-cap-fail",
            &client_payload_json("Look up the status"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_is_error_tool_results_then_projected(&lines, &["host-tool-1"]);
        let tool_result = lines
            .iter()
            .find(|m| m["eventType"] == "agent.tool_result")
            .expect("tool_result");
        assert_eq!(
            tool_result["payload"]["result"]["error"]["message"],
            "host rejected module_call"
        );
        assert!(
            lines
                .iter()
                .any(|m| m["eventType"] == "agent.execute.completed"),
            "TS continues after synthesized results, have {lines:?}"
        );
        assert!(
            lines
                .iter()
                .all(|m| m["eventType"] != "agent.execute.failed"),
            "capability execute fail must not abort the turn: {lines:?}"
        );
    }

    #[test]
    fn capability_execute_timeout_emits_is_error_tool_result_then_projected() {
        let (sidecar, sink) = collect_with_host(capability_execute_hang_host);
        sidecar.handle_line(&execute_line(
            "ex-cap-to",
            "run-cap-to",
            "op-cap-to",
            "req-cap-to",
            &client_payload_with_module_call_timeout("Look up the status", 40),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert!(
            lines.iter().any(|m| {
                m["kind"] == "request"
                    && m["module"] == "capability"
                    && m["payload"]["operation"] == "execute"
            }),
            "must attempt capability.execute: {lines:?}"
        );
        assert_is_error_tool_results_then_projected(&lines, &["host-tool-1"]);
        let tool_result = lines
            .iter()
            .find(|m| m["eventType"] == "agent.tool_result")
            .expect("tool_result");
        assert_eq!(
            tool_result["payload"]["result"]["error"]["message"],
            "Host module_call timed out."
        );
        assert!(
            lines
                .iter()
                .any(|m| m["eventType"] == "agent.execute.completed"),
            "TS continues after synthesized results, have {lines:?}"
        );
        assert!(
            lines
                .iter()
                .all(|m| m["eventType"] != "agent.execute.failed"),
            "capability execute timeout must not abort the turn: {lines:?}"
        );
    }

    #[test]
    fn capability_execute_fail_covers_every_outstanding_tool_call() {
        let (sidecar, sink) = collect_with_host(capability_execute_fail_first_of_two_host);
        sidecar.handle_line(&execute_line(
            "ex-cap-2",
            "run-cap-2",
            "op-cap-2",
            "req-cap-2",
            &client_payload_json("Look up the status"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(
            lines
                .iter()
                .filter(|m| {
                    m["kind"] == "request"
                        && m["module"] == "capability"
                        && m["payload"]["operation"] == "execute"
                })
                .count(),
            1,
            "failing executeAll must not start later tool_calls: {lines:?}"
        );
        assert_is_error_tool_results_then_projected(&lines, &["t1", "t2"]);
    }

    /// T-P1-03-FU-B A1 / #28 R1 m-1: lock Rust sequential ok-then-fail.
    /// Known-diff: TS `executeAll` catch rewrites the whole batch to
    /// `[error, error]`; Rust keeps the earlier success (`[success, error]`).
    #[test]
    fn capability_execute_ok_then_fail_keeps_success_then_synthesized_error() {
        let (sidecar, sink) = collect_with_host(capability_execute_ok_then_fail_host);
        sidecar.handle_line(&execute_line(
            "ex-cap-ok-fail",
            "run-cap-ok-fail",
            "op-cap-ok-fail",
            "req-cap-ok-fail",
            &client_payload_json("Look up the status"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(
            lines
                .iter()
                .filter(|m| {
                    m["kind"] == "request"
                        && m["module"] == "capability"
                        && m["payload"]["operation"] == "execute"
                })
                .count(),
            2,
            "ok-then-fail must execute the first tool before the second fails: {lines:?}"
        );
        let results: Vec<&Value> = lines
            .iter()
            .filter(|m| m["eventType"] == "agent.tool_result")
            .collect();
        assert_eq!(results.len(), 2, "one tool_result per tool_call: {lines:?}");
        assert_eq!(results[0]["payload"]["result"]["type"], "success");
        assert_eq!(results[0]["payload"]["result"]["toolCallId"], "t1");
        assert_eq!(
            results[0]["payload"]["result"]["content"][0]["text"],
            "ok-one"
        );
        assert_eq!(results[1]["payload"]["result"]["type"], "error");
        assert_eq!(results[1]["payload"]["result"]["toolCallId"], "t2");
        assert_synthesized_recovery_result(
            &results[1]["payload"]["result"],
            "lookup",
            "host rejected module_call",
            ".",
            "default",
        );
        let projected = lines
            .iter()
            .find(|m| m["eventType"] == "agent.tool_results_projected")
            .expect("projected");
        let blocks = projected["payload"]["message"]["content"]
            .as_array()
            .expect("projected content");
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0]["toolCallId"], "t1");
        assert_ne!(blocks[0].get("isError"), Some(&json!(true)));
        assert_eq!(blocks[1]["toolCallId"], "t2");
        assert_eq!(blocks[1]["isError"], true);
        assert!(
            lines
                .iter()
                .any(|m| m["eventType"] == "agent.execute.completed"),
            "ok-then-fail must continue the turn: {lines:?}"
        );
    }

    /// T-P1-03-FU-B A2 / #28 R1 m-2: synthesized result content is
    /// `buildToolErrorRecovery`-equivalent, with metadata.recovery + timestamps.
    #[test]
    fn capability_execute_fail_synthesizes_ts_recovery_result() {
        let (sidecar, sink) = collect_with_host(capability_execute_fail_host);
        sidecar.handle_line(&execute_line(
            "ex-cap-rec",
            "run-cap-rec",
            "op-cap-rec",
            "req-cap-rec",
            &client_payload_json("Look up the status"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let tool_result = lines
            .iter()
            .find(|m| m["eventType"] == "agent.tool_result")
            .expect("tool_result");
        assert_synthesized_recovery_result(
            &tool_result["payload"]["result"],
            "lookup",
            "host rejected module_call",
            ".",
            "default",
        );
        let projected = lines
            .iter()
            .find(|m| m["eventType"] == "agent.tool_results_projected")
            .expect("projected");
        let raw = &projected["payload"]["message"]["content"][0]["raw"];
        assert_eq!(
            raw["metadata"]["recovery"]["failureClass"],
            "environment_issue"
        );
        assert!(raw["content"][0]["text"]
            .as_str()
            .is_some_and(|text| text.starts_with("TOOL_ERROR[tool_execution_failed][lookup]")));
    }

    fn client_payload_with_recovery_context(user_text: &str, cwd: &str, mode: &str) -> String {
        let mut payload: Value =
            serde_json::from_str(&client_payload_json(user_text)).expect("payload");
        payload["agent"]["cwd"] = json!(cwd);
        payload["permissionContext"]["mode"] = json!(mode);
        payload.to_string()
    }

    #[test]
    fn recovery_cwd_reads_agent_cwd_same_as_context_prepare() {
        assert_eq!(
            recovery_cwd(&json!({ "agent": { "cwd": "/tmp/test-home" } })),
            "/tmp/test-home"
        );
        assert_eq!(recovery_cwd(&json!({ "agent": { "cwd": "" } })), ".");
        assert_eq!(recovery_cwd(&json!({})), ".");
        assert_eq!(
            permission_mode(&json!({ "permissionContext": { "mode": "bypassPermissions" } })),
            "bypassPermissions"
        );
        assert_eq!(
            permission_mode(&json!({ "agent": { "permissionMode": "plan" } })),
            "plan"
        );
        assert_eq!(permission_mode(&json!({})), "default");
    }

    /// T-P1-03-FU-B R1 M2: fail-fill must not hardcode cwd="." / permissionMode=default.
    #[test]
    fn capability_execute_fail_uses_payload_cwd_and_permission_mode() {
        let (sidecar, sink) = collect_with_host(capability_execute_fail_host);
        sidecar.handle_line(&execute_line(
            "ex-cap-rec-ctx",
            "run-cap-rec-ctx",
            "op-cap-rec-ctx",
            "req-cap-rec-ctx",
            &client_payload_with_recovery_context(
                "Look up the status",
                "/tmp/test-home",
                "bypassPermissions",
            ),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let tool_result = lines
            .iter()
            .find(|m| m["eventType"] == "agent.tool_result")
            .expect("tool_result");
        let result = &tool_result["payload"]["result"];
        assert_synthesized_recovery_result(
            result,
            "lookup",
            "host rejected module_call",
            "/tmp/test-home",
            "bypassPermissions",
        );
        let text = result["content"][0]["text"]
            .as_str()
            .expect("recovery text");
        assert!(
            text.contains("Current permission mode: bypassPermissions."),
            "non-default permissionMode must appear in recovery text, got {text}"
        );
        assert!(
            !text.contains("Current permission mode: default."),
            "hardcoded default permissionMode must not appear, got {text}"
        );
    }

    /// T-P1-03-FU-B A3 / #28 R1 m-3: `isError` only when `result.type === "error"`
    /// (`src/tool/protocol/result.ts:66`). An `error` field without `type` must
    /// not mark the projected block.
    #[test]
    fn tool_result_block_is_error_only_when_type_is_error() {
        let mut timeline = TurnTimeline::new("turn-a3");
        let without_type = json!({
            "error": { "code": "tool_failed", "message": "lookup failed" },
            "content": [{ "type": "text", "text": "boom" }],
        });
        let block = tool_result_block(&without_type, "t-a3", &mut timeline);
        assert!(
            block.get("isError").is_none(),
            "error field without type must not set isError (result.ts:66), got {block}"
        );
        assert_eq!(block["type"], "tool_result");
        assert_eq!(block["toolCallId"], "t-a3");

        let mut typed = TurnTimeline::new("turn-a3-err");
        let with_type = json!({
            "type": "error",
            "error": { "code": "tool_failed", "message": "lookup failed" },
            "content": [{ "type": "text", "text": "boom" }],
        });
        let err_block = tool_result_block(&with_type, "t-a3-err", &mut typed);
        assert_eq!(
            err_block["isError"], true,
            "type:error must still set isError"
        );
    }

    #[test]
    fn capability_result_error_field_without_type_does_not_mark_is_error() {
        let (sidecar, sink) = collect_with_host(capability_error_without_type_host);
        sidecar.handle_line(&execute_line(
            "ex-err-notype",
            "run-err-notype",
            "op-err-notype",
            "req-err-notype",
            &client_payload_json("Look up the status"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let tool_result = lines
            .iter()
            .find(|m| m["eventType"] == "agent.tool_result")
            .expect("tool_result");
        assert_ne!(
            tool_result["payload"]["result"]["type"], "error",
            "omitted type must not become type:error: {}",
            tool_result["payload"]["result"]
        );
        assert_eq!(
            tool_result["payload"]["result"]["error"]["message"],
            "lookup failed"
        );
        let terminal = lines
            .iter()
            .find(|m| m["eventType"] == "agent.execute.completed")
            .expect("completed");
        let block = &terminal["payload"]["messages"][1]["content"][0];
        assert_ne!(
            block.get("isError"),
            Some(&json!(true)),
            "error field without type must not project isError: {block}"
        );
    }

    #[test]
    fn capability_result_filters_json_file_and_rejects_empty_or_string_arrays() {
        let (sidecar, sink) = collect_with_host(capability_error_or_filter_host(
            json!([
                { "type": "json", "value": { "ok": true } },
                { "type": "file", "path": "/tmp/x", "mimeType": "text/plain", "description": "note" }
            ]),
            None,
        ));
        sidecar.handle_line(&execute_line(
            "ex-filt",
            "run-filt",
            "op-filt",
            "req-filt",
            &client_payload_json("Look up the status"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let content = &lines
            .iter()
            .find(|m| m["eventType"] == "agent.tool_result")
            .expect("tool_result")["payload"]["result"]["content"];
        assert_eq!(content[0]["type"], "text");
        assert!(content[0]["text"].as_str().unwrap().contains("ok"));
        assert_eq!(content[1]["type"], "text");
        assert_eq!(content[1]["text"], "[File: /tmp/x, text/plain, note]");

        let (sidecar, sink) = collect_with_host(capability_error_or_filter_host(json!([]), None));
        sidecar.handle_line(&execute_line(
            "ex-empty",
            "run-empty",
            "op-empty",
            "req-empty",
            &client_payload_json("Look up the status"),
        ));
        sidecar.join();
        let empty_lines = sink.lock().expect("sink").clone();
        let empty = &empty_lines
            .iter()
            .find(|m| m["eventType"] == "agent.tool_result")
            .unwrap()["payload"]["result"]["content"];
        assert_eq!(
            empty,
            &json!([{ "type": "text", "text": "Tool completed with no output." }])
        );

        let (sidecar, sink) = collect_with_host(capability_error_or_filter_host(
            json!(["plain", "strings"]),
            None,
        ));
        sidecar.handle_line(&execute_line(
            "ex-str",
            "run-str",
            "op-str",
            "req-str",
            &client_payload_json("Look up the status"),
        ));
        sidecar.join();
        let string_lines = sink.lock().expect("sink").clone();
        let strings = &string_lines
            .iter()
            .find(|m| m["eventType"] == "agent.tool_result")
            .unwrap()["payload"]["result"]["content"];
        assert_eq!(
            strings,
            &json!([
                { "type": "text", "text": "plain" },
                { "type": "text", "text": "strings" }
            ])
        );
    }

    fn hang_stream_host(call: &Value) -> Option<Value> {
        if call.get("module").and_then(Value::as_str) != Some("model") {
            return None;
        }
        match call.pointer("/payload/operation").and_then(Value::as_str) {
            Some("prepare") => Some(host_prepared(call)),
            Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
            _ => None,
        }
    }

    fn hang_prepare_host(call: &Value) -> Option<Value> {
        if call.get("module").and_then(Value::as_str) != Some("model") {
            return None;
        }
        match call.pointer("/payload/operation").and_then(Value::as_str) {
            Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
            _ => None,
        }
    }

    #[test]
    fn cancel_while_host_omits_stream_still_closes_stream() {
        let (sidecar, sink) = collect_with_host(hang_stream_host);
        sidecar.handle_line(&execute_line(
            "ex-hang-s",
            "run-hang-s",
            "op-hang-s",
            "req-hang-s",
            &client_payload_json("What is the status?"),
        ));
        let _ = wait_for(
            &sink,
            |lines| {
                lines.iter().any(|m| {
                    m["kind"] == "request"
                        && m["module"] == "model"
                        && m["payload"]["operation"] == "stream"
                })
            },
            1_000,
        );
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"cancel-hang-s","method":"cancel","runId":"run-hang-s","operationId":"op-hang-s","requestId":"req-hang-s","reason":"user_cancelled"}"#,
        );
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let terminal = lines
            .iter()
            .find(|m| m["kind"] == "event" && m["final"] == true)
            .expect("cancelled");
        assert_eq!(terminal["outcome"], "cancelled");
        assert!(lines.iter().any(|m| {
            m["kind"] == "request"
                && m["module"] == "model"
                && m["payload"]["operation"] == "close_stream"
        }));
    }

    #[test]
    fn cancel_during_prepare_still_sends_close_stream() {
        let (sidecar, sink) = collect_with_host(hang_prepare_host);
        sidecar.handle_line(&execute_line(
            "ex-hang-p",
            "run-hang-p",
            "op-hang-p",
            "req-hang-p",
            &client_payload_json("What is the status?"),
        ));
        let _ = wait_for(
            &sink,
            |lines| {
                lines.iter().any(|m| {
                    m["kind"] == "request"
                        && m["module"] == "model"
                        && m["payload"]["operation"] == "prepare"
                })
            },
            1_000,
        );
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"cancel-hang-p","method":"cancel","runId":"run-hang-p","operationId":"op-hang-p","requestId":"req-hang-p","reason":"user_cancelled"}"#,
        );
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let terminal = lines
            .iter()
            .find(|m| m["kind"] == "event" && m["final"] == true)
            .expect("cancelled");
        assert_eq!(terminal["outcome"], "cancelled");
        assert!(
            lines.iter().any(|m| {
                m["kind"] == "request"
                    && m["module"] == "model"
                    && m["payload"]["operation"] == "close_stream"
            }),
            "prepare interrupt must still close_stream: {lines:?}"
        );
    }

    #[test]
    fn inbound_module_call_is_still_unexpected() {
        let (sidecar, sink) = collect();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"mod-in","method":"module_call","runId":"run-1","operationId":"op-1","requestId":"req-mod","module":"model","payload":{}}"#,
        );
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(lines[0]["ok"], false);
        assert_eq!(lines[0]["code"], "UNEXPECTED_MODULE_CALL");
        assert_eq!(lines[0]["inReplyTo"], "mod-in");
    }

    #[test]
    fn module_call_host_ok_false_fails_execute() {
        let (sidecar, sink) = collect_with_host(|call| Some(host_fail(call, "HOST_REJECTED")));
        sidecar.handle_line(&execute_line(
            "ex-fail",
            "run-fail",
            "op-fail",
            "req-fail",
            &client_payload_json("What is the status?"),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert!(lines
            .iter()
            .any(|m| m["kind"] == "request" && m["method"] == "module_call"));
        let terminal = lines
            .iter()
            .find(|m| m["kind"] == "event" && m["final"] == true)
            .expect("failed terminal");
        assert_eq!(terminal["outcome"], "failed");
        assert_eq!(terminal["code"], "HOST_REJECTED");
        assert_eq!(terminal["eventType"], "agent.execute.failed");
    }

    #[test]
    fn module_call_timeout_fails_execute() {
        let (sidecar, sink) = collect();
        sidecar.handle_line(&execute_line(
            "ex-to",
            "run-to",
            "op-to",
            "req-to",
            r#"{"messages":[{"role":"user","content":[{"type":"text","text":"hang"}]}],"moduleCallTimeoutMs":40}"#,
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert!(lines
            .iter()
            .any(|m| m["kind"] == "request" && m["method"] == "module_call"));
        let terminal = lines
            .iter()
            .find(|m| m["kind"] == "event" && m["final"] == true)
            .expect("timeout terminal");
        assert_eq!(terminal["outcome"], "failed");
        assert_eq!(terminal["code"], "MODULE_CALL_TIMEOUT");
    }

    fn assert_cancel_won_before_message(
        lines: &[Value],
        outcome: &str,
        delay_ms: u64,
        elapsed: Duration,
    ) {
        assert!(
            elapsed < Duration::from_millis(delay_ms),
            "cancel must beat stub delay {delay_ms}ms, took {elapsed:?}"
        );
        assert!(
            elapsed <= Duration::from_secs(2),
            "cancel mid-execute must terminate within 2s, took {elapsed:?}"
        );
        let terminal_idx = lines
            .iter()
            .position(|m| m["kind"] == "event" && m["final"] == true)
            .expect("final event");
        let terminal = &lines[terminal_idx];
        assert_eq!(terminal["outcome"], outcome);
        assert_eq!(terminal["sequence"], 0);
        assert!(
            lines[..terminal_idx]
                .iter()
                .all(|m| m.get("eventType").and_then(Value::as_str) != Some("agent.message")),
            "cancel must win before agent.message, have {lines:?}"
        );
    }

    #[test]
    fn cancel_mid_execute_matches_ts_outcome() {
        const DELAY_MS: u64 = 10_000;
        let (sidecar, sink) = collect();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"ex-slow","method":"execute","runId":"run-c","operationId":"op-c","requestId":"req-c","payload":{"delayMs":10000,"scenario":"pure_text"}}"#,
        );
        let _ = wait_for(
            &sink,
            |lines| lines.iter().any(|m| m["inReplyTo"] == "ex-slow"),
            500,
        );
        thread::sleep(Duration::from_millis(50));
        let started = Instant::now();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"cancel-1","method":"cancel","runId":"run-c","operationId":"op-c","requestId":"req-c","reason":"user_cancelled"}"#,
        );
        sidecar.join();
        let elapsed = started.elapsed();
        let lines = sink.lock().expect("sink").clone();
        let cancel = lines.iter().find(|m| m["inReplyTo"] == "cancel-1").unwrap();
        assert_eq!(cancel["ok"], true);
        assert_eq!(cancel["payload"]["cancelled"], true);
        assert_cancel_won_before_message(&lines, "cancelled", DELAY_MS, elapsed);
        let terminal = lines
            .iter()
            .find(|m| m["kind"] == "event" && m["final"] == true)
            .unwrap();
        assert_eq!(terminal["payload"]["result"]["type"], "aborted");
        assert_eq!(terminal["payload"]["result"]["sessionId"], "run-c");
        assert_eq!(terminal["payload"]["result"]["turnId"], "op-c");
        assert_eq!(
            terminal["payload"]["result"]["stopReason"],
            "aborted_streaming"
        );
        assert!(terminal["payload"]["messages"].is_array());
    }

    #[test]
    fn timeout_cancel_is_result_unknown() {
        const DELAY_MS: u64 = 10_000;
        let (sidecar, sink) = collect();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"ex-t","method":"execute","runId":"run-t","operationId":"op-t","requestId":"req-t","payload":{"delayMs":10000}}"#,
        );
        let _ = wait_for(
            &sink,
            |lines| lines.iter().any(|m| m["inReplyTo"] == "ex-t"),
            500,
        );
        thread::sleep(Duration::from_millis(50));
        let started = Instant::now();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"cancel-t","method":"cancel","runId":"run-t","operationId":"op-t","requestId":"req-t","reason":"timeout:run-t"}"#,
        );
        sidecar.join();
        let elapsed = started.elapsed();
        let lines = sink.lock().expect("sink").clone();
        let terminal = lines
            .iter()
            .find(|m| m["kind"] == "event" && m["final"] == true)
            .unwrap();
        assert_eq!(terminal["code"], "DEADLINE_EXCEEDED");
        assert_cancel_won_before_message(&lines, "result_unknown", DELAY_MS, elapsed);
    }

    #[test]
    fn runtime_deadline_during_stub_sleep_is_result_unknown() {
        const DELAY_MS: u64 = 500;
        let (sidecar, sink) = collect();
        let deadline = format_unix_ms(now_unix_ms() + 100);
        let line = format!(
            r#"{{"kind":"request","messageId":"ex-dl","method":"execute","runId":"run-dl","operationId":"op-dl","requestId":"req-dl","operationDeadline":"{deadline}","payload":{{"delayMs":500,"scenario":"pure_text"}}}}"#
        );
        let started = Instant::now();
        sidecar.handle_line(&line);
        sidecar.join();
        let elapsed = started.elapsed();
        let lines = sink.lock().expect("sink").clone();
        assert!(
            elapsed < Duration::from_millis(DELAY_MS),
            "runtime deadline must beat stub delay {DELAY_MS}ms, took {elapsed:?}"
        );
        let terminal = lines
            .iter()
            .find(|m| m["kind"] == "event" && m["final"] == true)
            .expect("final event");
        assert_eq!(terminal["outcome"], "result_unknown");
        assert_eq!(terminal["eventType"], "agent.execute.result_unknown");
        assert_eq!(terminal["code"], "DEADLINE_EXCEEDED");
        assert_eq!(terminal["sequence"], 0);
        assert!(
            lines
                .iter()
                .all(|m| m.get("outcome") != Some(&Value::String("completed".into()))),
            "runtime deadline must not complete, have {lines:?}"
        );
        assert!(
            lines
                .iter()
                .all(|m| m.get("eventType").and_then(Value::as_str) != Some("agent.message")),
            "deadline must win before agent.message, have {lines:?}"
        );
    }

    #[test]
    fn expired_offset_iso_deadline_is_rejected_not_ignored() {
        let (sidecar, sink) = collect();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"ex-iso","method":"execute","runId":"run-iso","operationId":"op-iso","requestId":"req-iso","operationDeadline":"2020-01-01T00:00:00+00:00","payload":{"scenario":"pure_text","delayMs":500}}"#,
        );
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let rejected = lines
            .iter()
            .find(|m| m["inReplyTo"] == "ex-iso")
            .expect("deadline response");
        assert_eq!(rejected["ok"], false);
        assert_eq!(rejected["code"], "DEADLINE_EXCEEDED");
        assert_eq!(rejected["outcome"], "failed");
        assert!(
            lines
                .iter()
                .all(|m| m.get("outcome") != Some(&Value::String("completed".into()))),
            "+00:00 expired deadline must not be ignored, have {lines:?}"
        );
    }

    #[test]
    fn future_deadline_completes_when_not_expired() {
        let (sidecar, sink) = collect_with_host(text_host);
        let deadline = format_unix_ms(now_unix_ms() + 60_000);
        let line = format!(
            r#"{{"kind":"request","messageId":"ex-far","method":"execute","runId":"run-far","operationId":"op-far","requestId":"req-far","operationDeadline":"{deadline}","payload":{{"delayMs":20,"messages":[{{"role":"user","content":[{{"type":"text","text":"ok"}}]}}]}}}}"#
        );
        sidecar.handle_line(&line);
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let terminal = lines
            .iter()
            .find(|m| m["kind"] == "event" && m["final"] == true)
            .expect("final event");
        assert_eq!(terminal["outcome"], "completed");
        assert_eq!(terminal["eventType"], "agent.execute.completed");
        assert_ne!(terminal["outcome"], "result_unknown");
        assert!(
            lines
                .iter()
                .all(|m| m.get("code") != Some(&Value::String("DEADLINE_EXCEEDED".into()))),
            "unexpired deadline must not emit DEADLINE_EXCEEDED, have {lines:?}"
        );
    }

    #[test]
    fn attempt_deadline_during_stub_sleep_is_result_unknown() {
        const DELAY_MS: u64 = 500;
        let (sidecar, sink) = collect();
        let deadline = format_unix_ms(now_unix_ms() + 100);
        let line = format!(
            r#"{{"kind":"request","messageId":"ex-ad","method":"execute","runId":"run-ad","operationId":"op-ad","requestId":"req-ad","attemptDeadline":"{deadline}","payload":{{"delayMs":500,"scenario":"pure_text"}}}}"#
        );
        let started = Instant::now();
        sidecar.handle_line(&line);
        sidecar.join();
        let elapsed = started.elapsed();
        let lines = sink.lock().expect("sink").clone();
        assert!(
            elapsed < Duration::from_millis(DELAY_MS),
            "attemptDeadline must beat stub delay {DELAY_MS}ms, took {elapsed:?}"
        );
        let terminal = lines
            .iter()
            .find(|m| m["kind"] == "event" && m["final"] == true)
            .expect("final event");
        assert_eq!(terminal["outcome"], "result_unknown");
        assert_eq!(terminal["eventType"], "agent.execute.result_unknown");
        assert_eq!(terminal["code"], "DEADLINE_EXCEEDED");
        assert!(
            lines
                .iter()
                .all(|m| m.get("outcome") != Some(&Value::String("completed".into()))),
            "attemptDeadline must not complete, have {lines:?}"
        );
    }

    #[test]
    fn earliest_deadline_uses_sooner_of_operation_and_attempt() {
        const DELAY_MS: u64 = 800;
        let (sidecar, sink) = collect();
        let later = format_unix_ms(now_unix_ms() + 5_000);
        let sooner = format_unix_ms(now_unix_ms() + 100);
        let line = format!(
            r#"{{"kind":"request","messageId":"ex-min","method":"execute","runId":"run-min","operationId":"op-min","requestId":"req-min","operationDeadline":"{later}","attemptDeadline":"{sooner}","payload":{{"delayMs":800,"scenario":"pure_text"}}}}"#
        );
        let started = Instant::now();
        sidecar.handle_line(&line);
        sidecar.join();
        let elapsed = started.elapsed();
        let lines = sink.lock().expect("sink").clone();
        assert!(
            elapsed < Duration::from_millis(DELAY_MS),
            "earlier attemptDeadline must beat stub delay and the later operationDeadline, took {elapsed:?}"
        );
        let terminal = lines
            .iter()
            .find(|m| m["kind"] == "event" && m["final"] == true)
            .expect("final event");
        assert_eq!(terminal["outcome"], "result_unknown");
        assert_eq!(terminal["code"], "DEADLINE_EXCEEDED");
        assert!(
            lines
                .iter()
                .all(|m| m.get("outcome") != Some(&Value::String("completed".into()))),
            "min deadline must not wait for the later field, have {lines:?}"
        );
    }

    #[test]
    fn execute_finished_run_mismatch_is_rejected() {
        let (sidecar, sink) = collect_with_host(text_host);
        sidecar.handle_line(&execute_line(
            "ex-done",
            "run-a",
            "op-reuse",
            "req-a",
            &client_payload_json("What is the status?"),
        ));
        sidecar.join();
        sidecar.handle_line(&execute_line(
            "ex-reuse",
            "run-b",
            "op-reuse",
            "req-b",
            &client_payload_json("What is the status?"),
        ));
        let lines = sink.lock().expect("sink").clone();
        let rejected = lines.iter().find(|m| m["inReplyTo"] == "ex-reuse").unwrap();
        assert_eq!(rejected["ok"], false);
        assert_eq!(rejected["code"], "OPERATION_RUN_MISMATCH");
        assert!(
            lines
                .iter()
                .filter(|m| m["eventType"] == "agent.execute.completed")
                .count()
                == 1,
            "mismatch must not start a second run, have {lines:?}"
        );
    }

    /// F-9(b) merged: first run cancel, second run same runId complete.
    /// `recordFinal` keeps the first outcome (`moduleRuntime.ts:51`); accept
    /// still allows the same-runId re-execute (`moduleRuntime.ts:31-34`).
    /// This body must also pass on baseline `c5bed6c1` (copy + run there):
    /// cancel uses delay, complete replies only if a module_call appears.
    #[test]
    fn execute_finished_cancel_then_complete_keeps_cancelled_status() {
        let (sidecar, sink) = collect();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"ex-done","method":"execute","runId":"run-a","operationId":"op-reuse","requestId":"req-a","payload":{"delayMs":10000}}"#,
        );
        let _ = wait_for(
            &sink,
            |lines| lines.iter().any(|m| m["inReplyTo"] == "ex-done"),
            500,
        );
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"cancel-1","method":"cancel","runId":"run-a","operationId":"op-reuse","requestId":"req-a","reason":"user_cancelled"}"#,
        );
        sidecar.join();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"ex-reuse","method":"execute","runId":"run-a","operationId":"op-reuse","requestId":"req-b","payload":{}}"#,
        );
        reply_if_module_call(&sidecar, &sink, 2_000);
        sidecar.join();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"st-a","method":"status","requestId":"req-a"}"#,
        );
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"st-b","method":"status","requestId":"req-b"}"#,
        );
        let lines = sink.lock().expect("sink").clone();
        let accepted = lines.iter().find(|m| m["inReplyTo"] == "ex-reuse").unwrap();
        assert_eq!(accepted["ok"], true);
        assert!(accepted.get("code").is_none());
        let status_a = lines.iter().find(|m| m["inReplyTo"] == "st-a").unwrap();
        let status_b = lines.iter().find(|m| m["inReplyTo"] == "st-b").unwrap();
        assert_eq!(status_a["ok"], true);
        assert_eq!(status_a["payload"]["outcome"], "cancelled");
        assert_eq!(status_a["payload"]["state"], "cancelled");
        assert_eq!(status_b["ok"], true);
        assert_eq!(status_b["payload"]["outcome"], "cancelled");
        assert_eq!(status_b["payload"]["state"], "cancelled");
        assert_eq!(status_b["payload"]["runId"], "run-a");
        assert!(
            status_b["payload"]["requestIds"]
                .as_array()
                .is_some_and(|ids| {
                    ids.iter().any(|id| id == "req-a") && ids.iter().any(|id| id == "req-b")
                }),
            "both requestIds stay on the first snapshot, have {status_b}"
        );
    }

    #[test]
    fn status_and_stale_cancel_and_unsupported_resume_ack() {
        let (sidecar, sink) = collect();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"ex-s","method":"execute","runId":"run-s","operationId":"op-s","requestId":"req-s","payload":{"delayMs":200}}"#,
        );
        let _ = wait_for(
            &sink,
            |lines| lines.iter().any(|m| m["inReplyTo"] == "ex-s"),
            500,
        );
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"st-1","method":"status","requestId":"req-s"}"#,
        );
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"stale","method":"cancel","runId":"old-run","operationId":"op-s","requestId":"req-s","reason":"stale"}"#,
        );
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"resume-1","method":"resume","streamId":"stream-1","previousBinding":{"moduleInstanceId":"i","connectionGeneration":"c"},"lastAppliedSequence":-1}"#,
        );
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"ack-1","method":"ack","streamId":"stream-1","lastAppliedSequence":0}"#,
        );
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"cancel-s","method":"cancel","runId":"run-s","operationId":"op-s","reason":"done"}"#,
        );
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let status = lines.iter().find(|m| m["inReplyTo"] == "st-1").unwrap();
        assert_eq!(status["ok"], true);
        assert_eq!(status["payload"]["state"], "running");
        assert_eq!(
            lines.iter().find(|m| m["inReplyTo"] == "stale").unwrap()["code"],
            "OPERATION_IDENTITY_MISMATCH"
        );
        assert_eq!(
            lines.iter().find(|m| m["inReplyTo"] == "resume-1").unwrap()["code"],
            "RESUME_UNSUPPORTED"
        );
        assert_eq!(
            lines.iter().find(|m| m["inReplyTo"] == "ack-1").unwrap()["code"],
            "ACK_UNSUPPORTED"
        );
        let cancel_s = lines.iter().find(|m| m["inReplyTo"] == "cancel-s").unwrap();
        assert_eq!(cancel_s["ok"], true);
        assert!(
            cancel_s.get("requestId").is_none(),
            "cancel without requestId must omit the key, have {cancel_s}"
        );
    }

    #[test]
    fn cancel_unknown_and_status_unknown() {
        let (sidecar, sink) = collect();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"c-miss","method":"cancel","runId":"r","operationId":"missing","reason":"x"}"#,
        );
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"s-miss","method":"status","requestId":"nope"}"#,
        );
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(lines[0]["code"], "UNKNOWN_OPERATION");
        assert_eq!(lines[1]["code"], "UNKNOWN_REQUEST");
    }

    fn pull_methods_payload(user_text: &str, methods: &[&str]) -> String {
        let mut payload: Value =
            serde_json::from_str(&client_payload_json(user_text)).expect("payload");
        payload["hostModules"]["model"] = json!({ "methods": methods });
        payload.to_string()
    }

    fn model_operations(lines: &[Value]) -> Vec<&str> {
        lines
            .iter()
            .filter(|message| message["kind"] == "request" && message["method"] == "module_call")
            .map(|message| message["payload"]["operation"].as_str().unwrap_or(""))
            .collect()
    }

    fn text_delta_events(lines: &[Value]) -> Vec<&Value> {
        lines
            .iter()
            .filter(|message| {
                message["eventType"] == "agent.model_event"
                    && message["payload"]["event"]["type"] == "text_delta"
            })
            .collect()
    }

    #[test]
    fn stream_next_emits_each_text_delta_before_the_next_pull() {
        let pulls = Arc::new(AtomicUsize::new(0));
        let host_pulls = Arc::clone(&pulls);
        let (sidecar, sink) = collect_with_host(move |call: &Value| {
            if call.get("module").and_then(Value::as_str) != Some("model") {
                return None;
            }
            match call.pointer("/payload/operation").and_then(Value::as_str) {
                Some("prepare") => Some(host_prepared(call)),
                Some("stream") => Some(host_ok(
                    call,
                    json!({ "events": [{ "type": "text_delta", "text": "UNARY" }], "done": true }),
                )),
                Some("stream_next") => {
                    let n = host_pulls.fetch_add(1, Ordering::SeqCst);
                    let payload = match n {
                        0 => json!({
                            "events": [{ "type": "text_delta", "text": "AB" }],
                            "done": false
                        }),
                        1 => json!({
                            "events": [{ "type": "text_delta", "text": "C" }],
                            "done": false
                        }),
                        _ => json!({
                            "events": [{ "type": "message_end", "finishReason": "stop" }],
                            "done": true
                        }),
                    };
                    Some(host_ok(call, payload))
                }
                Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
                _ => None,
            }
        });
        sidecar.handle_line(&execute_line(
            "ex-pull",
            "run-pull",
            "op-pull",
            "req-pull",
            &pull_methods_payload(
                "stream incrementally",
                &["prepare", "stream", "stream_next", "close_stream"],
            ),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(
            model_operations(&lines),
            ["prepare", "stream_next", "stream_next", "stream_next"]
        );
        let deltas = text_delta_events(&lines);
        assert_eq!(deltas.len(), 2);
        assert_eq!(deltas[0]["payload"]["type"], "model_event");
        assert_eq!(deltas[0]["payload"]["event"]["text"], "AB");
        assert_eq!(deltas[1]["payload"]["event"]["text"], "C");
        assert_eq!(deltas[0]["payload"]["sessionId"], "run-pull");
        assert_eq!(deltas[0]["payload"]["turnId"], "op-pull");
        let block_id = deltas[0]["payload"]["blockId"]
            .as_str()
            .expect("text block id");
        assert!(!block_id.is_empty());
        assert_eq!(deltas[1]["payload"]["blockId"], block_id);
        let first_delta = lines
            .iter()
            .position(|message| message["eventType"] == "agent.model_event")
            .expect("first model_event");
        let second_pull = lines
            .iter()
            .enumerate()
            .filter(|(_, message)| {
                message["kind"] == "request" && message["payload"]["operation"] == "stream_next"
            })
            .nth(1)
            .expect("second stream_next")
            .0;
        assert!(
            first_delta < second_pull,
            "text_delta must be emitted before the next stream_next, have {lines:?}"
        );
        let assistant = lines
            .iter()
            .find(|message| message["eventType"] == "agent.assistant_message")
            .expect("assistant_message");
        assert_eq!(assistant["payload"]["message"]["content"][0]["text"], "ABC");
        assert_eq!(
            assistant["payload"]["message"]["content"][0]["blockId"],
            block_id
        );
        let terminal = lines
            .iter()
            .find(|message| message["final"] == true)
            .expect("terminal");
        assert_eq!(terminal["outcome"], "completed");
        assert_eq!(pulls.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn stream_next_falls_back_to_unary_stream_when_host_does_not_advertise_it() {
        let (sidecar, sink) = collect_with_host(|call: &Value| {
            if call.get("module").and_then(Value::as_str) != Some("model") {
                return None;
            }
            match call.pointer("/payload/operation").and_then(Value::as_str) {
                Some("prepare") => Some(host_prepared(call)),
                Some("stream") => Some(host_ok(
                    call,
                    json!({
                        "events": [
                            { "type": "text_delta", "text": "ONE" },
                            { "type": "text_delta", "text": "TWO" }
                        ],
                        "done": true
                    }),
                )),
                Some("stream_next") => Some(host_ok(
                    call,
                    json!({ "events": [{ "type": "text_delta", "text": "PULLED" }], "done": true }),
                )),
                Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
                _ => None,
            }
        });
        sidecar.handle_line(&execute_line(
            "ex-unary",
            "run-unary",
            "op-unary",
            "req-unary",
            &pull_methods_payload("fallback", &["prepare", "stream", "close_stream"]),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(
            model_operations(&lines),
            ["prepare", "stream", "close_stream"]
        );
        assert!(text_delta_events(&lines).is_empty());
        let assistant = lines
            .iter()
            .find(|message| message["eventType"] == "agent.assistant_message")
            .expect("assistant_message");
        assert_eq!(
            assistant["payload"]["message"]["content"][0]["text"],
            "ONETWO"
        );
        assert!(assistant["payload"]["message"]["content"][0]
            .get("blockId")
            .is_none());
        assert_eq!(
            lines
                .iter()
                .find(|message| message["final"] == true)
                .expect("terminal")["outcome"],
            "completed"
        );
    }

    #[test]
    fn stream_next_error_frame_is_emitted_then_the_unfinished_stream_is_closed() {
        let (sidecar, sink) = collect_with_host({
            let pulls = AtomicUsize::new(0);
            move |call: &Value| {
                if call.get("module").and_then(Value::as_str) != Some("model") {
                    return None;
                }
                match call.pointer("/payload/operation").and_then(Value::as_str) {
                    Some("prepare") => Some(host_prepared(call)),
                    Some("stream_next") => {
                        let n = pulls.fetch_add(1, Ordering::SeqCst);
                        if n == 0 {
                            Some(host_ok(
                                call,
                                json!({
                                    "events": [{ "type": "text_delta", "text": "partial" }],
                                    "done": false
                                }),
                            ))
                        } else {
                            Some(host_ok(
                                call,
                                json!({
                                    "events": [{
                                        "type": "error",
                                        "error": {
                                            "code": "stream_interrupted",
                                            "message": "provider dropped the stream"
                                        }
                                    }],
                                    "done": false
                                }),
                            ))
                        }
                    }
                    Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
                    Some("stream") => Some(host_ok(
                        call,
                        json!({ "events": [{ "type": "text_delta", "text": "UNARY" }], "done": true }),
                    )),
                    _ => None,
                }
            }
        });
        sidecar.handle_line(&execute_line(
            "ex-err",
            "run-err",
            "op-err",
            "req-err",
            &pull_methods_payload("error frame", &["prepare", "stream_next", "close_stream"]),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(
            model_operations(&lines),
            ["prepare", "stream_next", "stream_next", "close_stream"]
        );
        let deltas = text_delta_events(&lines);
        assert_eq!(deltas.len(), 1);
        assert_eq!(deltas[0]["payload"]["event"]["text"], "partial");
        let error = lines
            .iter()
            .find(|message| {
                message["eventType"] == "agent.model_event"
                    && message["payload"]["event"]["type"] == "error"
            })
            .expect("error model_event");
        assert_eq!(
            error["payload"]["event"]["error"]["code"],
            "stream_interrupted"
        );
        let delta_at = lines
            .iter()
            .position(|message| {
                message["eventType"] == "agent.model_event"
                    && message["payload"]["event"]["type"] == "text_delta"
            })
            .expect("delta");
        let error_at = lines
            .iter()
            .position(|message| {
                message["eventType"] == "agent.model_event"
                    && message["payload"]["event"]["type"] == "error"
            })
            .expect("error event");
        let close_at = lines
            .iter()
            .position(|message| message["payload"]["operation"] == "close_stream")
            .expect("close_stream");
        assert!(delta_at < error_at && error_at < close_at);
        let terminal = lines
            .iter()
            .find(|message| message["final"] == true)
            .expect("terminal");
        assert_eq!(terminal["outcome"], "failed");
        assert_eq!(terminal["code"], "stream_interrupted");
        assert!(lines
            .iter()
            .all(|message| message["eventType"] != "agent.assistant_message"));
    }

    #[test]
    fn stream_next_end_frame_completes_and_malformed_frame_fails() {
        let (sidecar, sink) = collect_with_host({
            let pulls = AtomicUsize::new(0);
            move |call: &Value| {
                if call.get("module").and_then(Value::as_str) != Some("model") {
                    return None;
                }
                match call.pointer("/payload/operation").and_then(Value::as_str) {
                    Some("prepare") => Some(host_prepared(call)),
                    Some("stream_next") => {
                        let n = pulls.fetch_add(1, Ordering::SeqCst);
                        let payload = if n == 0 {
                            json!({
                                "events": [{ "type": "text_delta", "text": "done-with" }],
                                "done": false
                            })
                        } else {
                            json!({ "events": [], "done": true })
                        };
                        Some(host_ok(call, payload))
                    }
                    Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
                    _ => None,
                }
            }
        });
        sidecar.handle_line(&execute_line(
            "ex-end",
            "run-end",
            "op-end",
            "req-end",
            &pull_methods_payload("end frame", &["prepare", "stream_next", "close_stream"]),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(
            model_operations(&lines),
            ["prepare", "stream_next", "stream_next"]
        );
        assert_eq!(
            text_delta_events(&lines)[0]["payload"]["event"]["text"],
            "done-with"
        );
        assert_eq!(
            lines
                .iter()
                .find(|message| message["eventType"] == "agent.assistant_message")
                .expect("assistant")["payload"]["message"]["content"][0]["text"],
            "done-with"
        );
        assert_eq!(
            lines
                .iter()
                .find(|message| message["final"] == true)
                .expect("terminal")["outcome"],
            "completed"
        );

        let (sidecar, sink) = collect_with_host({
            let pulls = AtomicUsize::new(0);
            move |call: &Value| {
                if call.get("module").and_then(Value::as_str) != Some("model") {
                    return None;
                }
                match call.pointer("/payload/operation").and_then(Value::as_str) {
                    Some("prepare") => Some(host_prepared(call)),
                    Some("stream_next") => {
                        let n = pulls.fetch_add(1, Ordering::SeqCst);
                        if n == 0 {
                            Some(host_ok(
                                call,
                                json!({
                                    "events": [{ "type": "text_delta", "text": "kept" }],
                                    "done": false
                                }),
                            ))
                        } else {
                            Some(host_ok(call, json!({ "events": [] })))
                        }
                    }
                    Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
                    _ => None,
                }
            }
        });
        sidecar.handle_line(&execute_line(
            "ex-bad",
            "run-bad",
            "op-bad",
            "req-bad",
            &pull_methods_payload(
                "malformed frame",
                &["prepare", "stream_next", "close_stream"],
            ),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(
            model_operations(&lines),
            ["prepare", "stream_next", "stream_next", "close_stream"]
        );
        assert_eq!(
            text_delta_events(&lines)[0]["payload"]["event"]["text"],
            "kept"
        );
        let terminal = lines
            .iter()
            .find(|message| message["final"] == true)
            .expect("terminal");
        assert_eq!(terminal["outcome"], "failed");
        assert_eq!(terminal["code"], "INVALID_MODEL_RESPONSE");
    }

    #[test]
    fn stream_next_accepts_more_than_8192_non_empty_frames() {
        const FRAMES: usize = 8_193;
        let pulls = Arc::new(AtomicUsize::new(0));
        let host_pulls = Arc::clone(&pulls);
        let (sidecar, sink) = collect_with_host(move |call: &Value| {
            if call.get("module").and_then(Value::as_str) != Some("model") {
                return None;
            }
            match call.pointer("/payload/operation").and_then(Value::as_str) {
                Some("prepare") => Some(host_prepared(call)),
                Some("stream_next") => {
                    let index = host_pulls.fetch_add(1, Ordering::SeqCst);
                    let done = index + 1 >= FRAMES;
                    Some(host_ok(
                        call,
                        json!({
                            "events": [{ "type": "text_delta", "text": "x" }],
                            "done": done
                        }),
                    ))
                }
                Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
                _ => None,
            }
        });
        sidecar.handle_line(&execute_line(
            "ex-many",
            "run-many",
            "op-many",
            "req-many",
            &pull_methods_payload("many frames", &["prepare", "stream_next", "close_stream"]),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(text_delta_events(&lines).len(), FRAMES);
        let assistant = lines
            .iter()
            .find(|message| message["eventType"] == "agent.assistant_message")
            .expect("assistant");
        assert_eq!(
            assistant["payload"]["message"]["content"][0]["text"]
                .as_str()
                .expect("text")
                .len(),
            FRAMES
        );
        assert_eq!(
            lines
                .iter()
                .find(|message| message["final"] == true)
                .expect("terminal")["outcome"],
            "completed"
        );
        assert_eq!(pulls.load(Ordering::SeqCst), FRAMES);
    }

    #[test]
    fn stream_next_consecutive_empty_frames_fail() {
        let limit = super::MAX_CONSECUTIVE_EMPTY_STREAM_FRAMES;
        let pulls = Arc::new(AtomicUsize::new(0));
        let host_pulls = Arc::clone(&pulls);
        let (sidecar, sink) = collect_with_host(move |call: &Value| {
            if call.get("module").and_then(Value::as_str) != Some("model") {
                return None;
            }
            match call.pointer("/payload/operation").and_then(Value::as_str) {
                Some("prepare") => Some(host_prepared(call)),
                Some("stream_next") => {
                    host_pulls.fetch_add(1, Ordering::SeqCst);
                    Some(host_ok(call, json!({ "events": [], "done": false })))
                }
                Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
                _ => None,
            }
        });
        sidecar.handle_line(&execute_line(
            "ex-empty",
            "run-empty",
            "op-empty",
            "req-empty",
            &pull_methods_payload("empty frames", &["prepare", "stream_next", "close_stream"]),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(pulls.load(Ordering::SeqCst), limit + 1);
        assert!(model_operations(&lines).contains(&"close_stream"));
        let terminal = lines
            .iter()
            .find(|message| message["final"] == true)
            .expect("terminal");
        assert_eq!(terminal["outcome"], "failed");
        assert_eq!(terminal["code"], "INVALID_MODEL_RESPONSE");
    }

    #[test]
    fn stream_next_tool_call_keeps_pre_tool_text_block_id() {
        let before = AtomicUsize::new(0);
        let after = AtomicUsize::new(0);
        let (sidecar, sink) = collect_with_host(move |call: &Value| {
            match call.get("module").and_then(Value::as_str) {
                Some("capability") => single_tool_host(call),
                Some("model") => match call.pointer("/payload/operation").and_then(Value::as_str) {
                    Some("prepare") => Some(host_prepared(call)),
                    Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
                    Some("stream_next") => {
                        let payload = if conversation_has_tool_result(call) {
                            let index = after.fetch_add(1, Ordering::SeqCst);
                            if index == 0 {
                                json!({
                                    "events": [{ "type": "text_delta", "text": "after" }],
                                    "done": true
                                })
                            } else {
                                json!({ "events": [], "done": true })
                            }
                        } else {
                            let index = before.fetch_add(1, Ordering::SeqCst);
                            match index {
                                0 => json!({
                                    "events": [{ "type": "text_delta", "text": "before-tool" }],
                                    "done": false
                                }),
                                1 => json!({
                                    "events": [{
                                        "type": "tool_call_end",
                                        "toolCall": {
                                            "id": "host-tool-1",
                                            "name": "lookup",
                                            "input": { "q": "Look up the status" }
                                        }
                                    }],
                                    "done": false
                                }),
                                _ => json!({
                                    "events": [{ "type": "message_end", "finishReason": "tool_call" }],
                                    "done": true
                                }),
                            }
                        };
                        Some(host_ok(call, payload))
                    }
                    _ => None,
                },
                _ => None,
            }
        });
        sidecar.handle_line(&execute_line(
            "ex-tool",
            "run-tool",
            "op-tool",
            "req-tool",
            &pull_methods_payload(
                "Look up the status",
                &["prepare", "stream_next", "close_stream"],
            ),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let delta = text_delta_events(&lines)
            .into_iter()
            .find(|event| event["payload"]["event"]["text"] == "before-tool")
            .expect("pre-tool delta");
        let block_id = delta["payload"]["blockId"].as_str().expect("block id");
        let pretool = lines
            .iter()
            .find(|message| {
                message["eventType"] == "agent.assistant_message"
                    && message["payload"]["message"]["content"]
                        .as_array()
                        .is_some_and(|blocks| {
                            blocks.iter().any(|block| block["type"] == "tool_call")
                        })
            })
            .expect("pre-tool assistant");
        let text_block = pretool["payload"]["message"]["content"]
            .as_array()
            .expect("content")
            .iter()
            .find(|block| block["type"] == "text")
            .expect("text block");
        assert_eq!(text_block["text"], "before-tool");
        assert_eq!(text_block["blockId"], block_id);
        assert!(lines
            .iter()
            .any(|message| message["eventType"] == "agent.tool_result"));
        let terminal = lines
            .iter()
            .find(|message| message["final"] == true)
            .expect("terminal");
        assert_eq!(terminal["outcome"], "completed");
        let final_text = lines
            .iter()
            .filter(|message| message["eventType"] == "agent.assistant_message")
            .filter_map(|message| {
                message["payload"]["message"]["content"]
                    .as_array()
                    .and_then(|blocks| blocks.iter().find(|block| block["type"] == "text"))
                    .and_then(|block| block["text"].as_str())
            })
            .last()
            .expect("final text");
        assert_eq!(final_text, "after");
    }

    #[test]
    fn stream_next_cancel_closes_stream_and_cancels() {
        let (sidecar, sink) = collect_with_host(|call: &Value| {
            if call.get("module").and_then(Value::as_str) != Some("model") {
                return None;
            }
            match call.pointer("/payload/operation").and_then(Value::as_str) {
                Some("prepare") => Some(host_prepared(call)),
                Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
                _ => None,
            }
        });
        sidecar.handle_line(&execute_line(
            "ex-cancel",
            "run-cancel",
            "op-cancel",
            "req-cancel",
            &pull_methods_payload(
                "cancel mid pull",
                &["prepare", "stream_next", "close_stream"],
            ),
        ));
        let _ = wait_for(
            &sink,
            |lines| {
                lines.iter().any(|message| {
                    message["kind"] == "request" && message["payload"]["operation"] == "stream_next"
                })
            },
            1_000,
        );
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"cancel-pull","method":"cancel","runId":"run-cancel","operationId":"op-cancel","requestId":"req-cancel","reason":"user_cancelled"}"#,
        );
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert!(lines
            .iter()
            .any(|message| message["payload"]["operation"] == "close_stream"));
        assert_eq!(
            lines
                .iter()
                .find(|message| message["final"] == true)
                .expect("terminal")["outcome"],
            "cancelled"
        );
    }

    #[test]
    fn stream_next_host_rejection_fails_and_closes() {
        let pulls = AtomicUsize::new(0);
        let (sidecar, sink) = collect_with_host(move |call: &Value| {
            if call.get("module").and_then(Value::as_str) != Some("model") {
                return None;
            }
            match call.pointer("/payload/operation").and_then(Value::as_str) {
                Some("prepare") => Some(host_prepared(call)),
                Some("stream_next") => {
                    let index = pulls.fetch_add(1, Ordering::SeqCst);
                    if index == 0 {
                        Some(host_ok(
                            call,
                            json!({
                                "events": [{ "type": "text_delta", "text": "partial" }],
                                "done": false
                            }),
                        ))
                    } else {
                        Some(host_fail(call, "HOST_REJECTED"))
                    }
                }
                Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
                _ => None,
            }
        });
        sidecar.handle_line(&execute_line(
            "ex-reject",
            "run-reject",
            "op-reject",
            "req-reject",
            &pull_methods_payload("reject", &["prepare", "stream_next", "close_stream"]),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(
            text_delta_events(&lines)[0]["payload"]["event"]["text"],
            "partial"
        );
        assert!(model_operations(&lines).contains(&"close_stream"));
        let terminal = lines
            .iter()
            .find(|message| message["final"] == true)
            .expect("terminal");
        assert_eq!(terminal["outcome"], "failed");
        assert_eq!(terminal["code"], "HOST_REJECTED");
    }

    #[test]
    fn stream_next_timeout_fails_and_closes() {
        let (sidecar, sink) = collect_with_host(|call: &Value| {
            if call.get("module").and_then(Value::as_str) != Some("model") {
                return None;
            }
            match call.pointer("/payload/operation").and_then(Value::as_str) {
                Some("prepare") => Some(host_prepared(call)),
                Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
                _ => None,
            }
        });
        let mut payload: Value = serde_json::from_str(&pull_methods_payload(
            "timeout",
            &["prepare", "stream_next", "close_stream"],
        ))
        .expect("payload");
        payload["moduleCallTimeoutMs"] = json!(40);
        sidecar.handle_line(&execute_line(
            "ex-pull-to",
            "run-pull-to",
            "op-pull-to",
            "req-pull-to",
            &payload.to_string(),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert!(model_operations(&lines).contains(&"stream_next"));
        assert!(model_operations(&lines).contains(&"close_stream"));
        let terminal = lines
            .iter()
            .find(|message| message["final"] == true)
            .expect("terminal");
        assert_eq!(terminal["outcome"], "failed");
        assert_eq!(terminal["code"], "MODULE_CALL_TIMEOUT");
    }

    #[test]
    fn unary_stream_error_event_fails_instead_of_completing() {
        let (sidecar, sink) = collect_with_host(|call: &Value| {
            if call.get("module").and_then(Value::as_str) != Some("model") {
                return None;
            }
            match call.pointer("/payload/operation").and_then(Value::as_str) {
                Some("prepare") => Some(host_prepared(call)),
                Some("stream") => Some(host_ok(
                    call,
                    json!({
                        "events": [
                            { "type": "text_delta", "text": "partial" },
                            {
                                "type": "error",
                                "error": {
                                    "code": "stream_interrupted",
                                    "message": "provider failed"
                                }
                            }
                        ],
                        "done": true
                    }),
                )),
                Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
                _ => None,
            }
        });
        sidecar.handle_line(&execute_line(
            "ex-unary-err",
            "run-unary-err",
            "op-unary-err",
            "req-unary-err",
            &pull_methods_payload("unary error", &["prepare", "stream", "close_stream"]),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(
            model_operations(&lines),
            ["prepare", "stream", "close_stream"]
        );
        let error = lines
            .iter()
            .find(|message| {
                message["eventType"] == "agent.model_event"
                    && message["payload"]["event"]["type"] == "error"
            })
            .expect("error event");
        assert_eq!(
            error["payload"]["event"]["error"]["code"],
            "stream_interrupted"
        );
        assert!(lines
            .iter()
            .all(|message| message["eventType"] != "agent.assistant_message"));
        let terminal = lines
            .iter()
            .find(|message| message["final"] == true)
            .expect("terminal");
        assert_eq!(terminal["outcome"], "failed");
        assert_eq!(terminal["code"], "stream_interrupted");
    }

    #[test]
    fn stream_next_closes_thinking_block_with_the_same_id() {
        let pulls = AtomicUsize::new(0);
        let (sidecar, sink) = collect_with_host(move |call: &Value| {
            if call.get("module").and_then(Value::as_str) != Some("model") {
                return None;
            }
            match call.pointer("/payload/operation").and_then(Value::as_str) {
                Some("prepare") => Some(host_prepared(call)),
                Some("stream_next") => {
                    let index = pulls.fetch_add(1, Ordering::SeqCst);
                    let payload = match index {
                        0 => json!({
                            "events": [{ "type": "thinking_delta", "text": "ab" }],
                            "done": false
                        }),
                        1 => json!({
                            "events": [{ "type": "thinking_delta", "text": "c" }],
                            "done": false
                        }),
                        2 => json!({
                            "events": [{ "type": "text_delta", "text": "OK" }],
                            "done": false
                        }),
                        _ => json!({ "events": [], "done": true }),
                    };
                    Some(host_ok(call, payload))
                }
                Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
                _ => None,
            }
        });
        sidecar.handle_line(&execute_line(
            "ex-think",
            "run-think",
            "op-think",
            "req-think",
            &pull_methods_payload("thinking", &["prepare", "stream_next", "close_stream"]),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let thinking: Vec<&Value> = lines
            .iter()
            .filter(|message| {
                message["eventType"] == "agent.model_event"
                    && message["payload"]["event"]["type"] == "thinking_delta"
            })
            .collect();
        assert_eq!(thinking.len(), 2);
        let thinking_id = thinking[0]["payload"]["blockId"]
            .as_str()
            .expect("thinking id");
        assert_eq!(thinking[1]["payload"]["blockId"], thinking_id);
        let assistant = lines
            .iter()
            .find(|message| message["eventType"] == "agent.assistant_message")
            .expect("assistant");
        let content = assistant["payload"]["message"]["content"]
            .as_array()
            .expect("content");
        assert_eq!(content[0]["type"], "thinking");
        assert_eq!(content[0]["text"], "abc");
        assert_eq!(content[0]["blockId"], thinking_id);
        assert_eq!(content[1]["type"], "text");
        assert_eq!(content[1]["text"], "OK");
        assert_eq!(
            content[1]["blockId"],
            text_delta_events(&lines)[0]["payload"]["blockId"]
        );
        assert_eq!(
            lines
                .iter()
                .find(|message| message["final"] == true)
                .expect("terminal")["outcome"],
            "completed"
        );
    }

    #[test]
    fn thinking_signature_round_trip_keeps_last_non_empty_signature() {
        let (sidecar, sink) = collect_with_host(|call: &Value| {
            match (
                call.get("module").and_then(Value::as_str),
                call.pointer("/payload/operation").and_then(Value::as_str),
            ) {
                (Some("model"), Some("prepare")) => Some(host_prepared(call)),
                (Some("model"), Some("stream_next")) => {
                    let payload = if conversation_has_tool_result(call) {
                        json!({
                            "events": [{ "type": "text_delta", "text": "done" }],
                            "done": true
                        })
                    } else {
                        json!({
                            "events": [
                                { "type": "thinking_delta", "text": "plan", "signature": "", "reasoningContent": "r1" },
                                { "type": "thinking_delta", "text": " more", "signature": "sig-a", "reasoningContent": "r2" },
                                { "type": "thinking_delta", "text": "", "signature": "sig-b" },
                                { "type": "thinking_delta", "text": "", "signature": "" },
                                {
                                    "type": "tool_call_end",
                                    "toolCall": { "id": "host-tool-1", "name": "lookup", "input": { "q": "status" } }
                                }
                            ],
                            "done": true
                        })
                    };
                    Some(host_ok(call, payload))
                }
                (Some("model"), Some("close_stream")) => {
                    Some(host_ok(call, json!({ "closed": true })))
                }
                (Some("capability"), Some("execute")) => single_tool_host(call),
                _ => None,
            }
        });
        sidecar.handle_line(&execute_line(
            "ex-sig",
            "run-sig",
            "op-sig",
            "req-sig",
            &pull_methods_payload("status", &["prepare", "stream_next", "close_stream"]),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let assistant = lines
            .iter()
            .find(|message| message["eventType"] == "agent.assistant_message")
            .expect("durable assistant");
        let thinking = &assistant["payload"]["message"]["content"][0];
        assert_eq!(thinking["type"], "thinking");
        assert_eq!(thinking["text"], "plan more");
        assert_eq!(thinking["signature"], "sig-b");
        assert_eq!(thinking["reasoningContent"], "r1r2");
        let second_prepare = lines
            .iter()
            .filter(|message| {
                message["kind"] == "request"
                    && message["module"] == "model"
                    && message["payload"]["operation"] == "prepare"
            })
            .nth(1)
            .expect("second prepare");
        let replayed = second_prepare["payload"]["request"]["messages"]
            .as_array()
            .expect("messages")
            .iter()
            .find(|message| message["role"] == "assistant")
            .expect("assistant replay");
        let replayed_thinking = &replayed["content"][0];
        assert_eq!(replayed_thinking["type"], "thinking");
        assert_eq!(replayed_thinking["signature"], "sig-b");
        assert_eq!(replayed_thinking["reasoningContent"], "r1r2");
        assert_eq!(replayed_thinking["text"], "plan more");
        assert!(lines
            .iter()
            .any(|message| { message["final"] == true && message["outcome"] == "completed" }));
    }

    #[test]
    fn empty_thinking_signature_is_not_invented() {
        let (sidecar, sink) = collect_with_host(|call: &Value| {
            match call.pointer("/payload/operation").and_then(Value::as_str) {
                Some("prepare") => Some(host_prepared(call)),
                Some("stream") => Some(host_ok(
                    call,
                    json!({
                        "events": [
                            { "type": "thinking_delta", "text": "x", "signature": "" },
                            { "type": "text_delta", "text": "ok" }
                        ]
                    }),
                )),
                Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
                _ => None,
            }
        });
        sidecar.handle_line(&execute_line(
            "ex-empty-sig",
            "run-empty-sig",
            "op-empty-sig",
            "req-empty-sig",
            &pull_methods_payload("status", &["prepare", "stream", "close_stream"]),
        ));
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        let assistant = lines
            .iter()
            .find(|message| message["eventType"] == "agent.assistant_message")
            .expect("assistant");
        let thinking = &assistant["payload"]["message"]["content"][0];
        assert_eq!(thinking["type"], "thinking");
        assert_eq!(thinking["text"], "x");
        assert!(thinking.get("signature").is_none());
        assert!(thinking.get("reasoningContent").is_none());
    }

    #[test]
    fn stream_uses_host_prepared_request() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_stream = Arc::clone(&seen);
        let (sidecar, sink) = collect_with_host(move |call: &Value| {
            match call.pointer("/payload/operation").and_then(Value::as_str) {
                Some("prepare") => {
                    let mut request = call
                        .pointer("/payload/request")
                        .cloned()
                        .unwrap_or_else(|| json!({}));
                    request["systemPrompt"] = json!("FROM_HOST_PROVIDER");
                    request["provider"] = json!("openai");
                    request["model"] = json!("live-fixture");
                    Some(host_ok(
                        call,
                        json!({
                            "prepared": {
                                "request": request,
                                "provider": "openai",
                                "model": "live-fixture"
                            }
                        }),
                    ))
                }
                Some("stream_next") => {
                    seen_stream.lock().expect("seen").push(
                        call.pointer("/payload/request")
                            .cloned()
                            .unwrap_or(json!({})),
                    );
                    Some(host_ok(
                        call,
                        json!({
                            "events": [{ "type": "text_delta", "text": "FROM_PROVIDER" }],
                            "done": true
                        }),
                    ))
                }
                Some("close_stream") => Some(host_ok(call, json!({ "closed": true }))),
                _ => None,
            }
        });
        sidecar.handle_line(&execute_line(
            "ex-prepared",
            "run-prepared",
            "op-prepared",
            "req-prepared",
            &pull_methods_payload("status", &["prepare", "stream_next", "close_stream"]),
        ));
        sidecar.join();
        let streamed = seen.lock().expect("seen").clone();
        assert_eq!(streamed.len(), 1);
        assert_eq!(streamed[0]["systemPrompt"], "FROM_HOST_PROVIDER");
        assert_eq!(streamed[0]["provider"], "openai");
        assert_eq!(streamed[0]["model"], "live-fixture");
        let lines = sink.lock().expect("sink").clone();
        let assistant = lines
            .iter()
            .find(|message| message["eventType"] == "agent.assistant_message")
            .expect("assistant");
        assert_eq!(
            assistant["payload"]["message"]["content"][0]["text"],
            "FROM_PROVIDER"
        );
        assert_eq!(
            lines
                .iter()
                .find(|message| message["final"] == true)
                .expect("terminal")["outcome"],
            "completed"
        );
    }

    #[test]
    fn tcp_auth_token_gates_hello_and_later_methods() {
        let (tx, rx) = mpsc::channel();
        let sidecar = Sidecar::with_transport_and_auth(
            Arc::new(move |message| {
                let _ = tx.send(message);
            }),
            "tcp",
            Some("secret-token".to_string()),
        );
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"caps-early","method":"capabilities","payload":{}}"#,
        );
        let denied = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(denied["code"], "UNAUTHENTICATED");
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"hello-bad","method":"hello","payload":{"token":"nope"}}"#,
        );
        let rejected = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(rejected["ok"], false);
        assert_eq!(rejected["code"], "UNAUTHENTICATED");
        assert_eq!(rejected["inReplyTo"], "hello-bad");
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"hello-ok","method":"hello","payload":{"token":"secret-token"}}"#,
        );
        let accepted = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(accepted["ok"], true);
        assert_eq!(accepted["inReplyTo"], "hello-ok");
        assert!(accepted
            .get("payload")
            .and_then(|payload| payload.get("token"))
            .is_none());
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"caps-ok","method":"capabilities","payload":{}}"#,
        );
        let caps = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(caps["ok"], true);
        assert_eq!(caps["payload"]["transport"], "tcp");
    }

    #[test]
    fn channel_emit_is_send_sync() {
        let (tx, rx) = mpsc::channel();
        let sidecar = Sidecar::new(Arc::new(move |message| {
            let _ = tx.send(message);
        }));
        sidecar.handle_line(r#"{"kind":"request","messageId":"h","method":"hello","payload":{}}"#);
        let message = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(message["inReplyTo"], "h");
    }
}
