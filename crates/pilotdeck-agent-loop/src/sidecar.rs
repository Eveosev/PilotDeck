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
        let token = AtomicU64::new(0);
        let module_instance_id = format!("{MODULE_ID}-instance-{}", next_token_from(&token));
        let connection_generation = format!("{}-{}", module_instance_id, next_token_from(&token));
        Self {
            inner: Arc::new(Inner {
                emit,
                module_id: MODULE_ID.to_string(),
                module_instance_id,
                connection_generation,
                capabilities_version: CAPABILITIES_VERSION.to_string(),
                transport: transport.to_string(),
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
            self.handle_host_response(value);
            return;
        }
        if kind != "request" {
            return;
        }
        let message_id = value.get("messageId").and_then(Value::as_str).unwrap_or("");
        match value.get("method").and_then(Value::as_str).unwrap_or("") {
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
    let first = match call_host_model(&job, &conversation) {
        Ok(assembled) => assembled,
        Err(other) => {
            finish_host_call(&job, sequence, other);
            return;
        }
    };
    let calls = first.tool_calls;
    if calls.is_empty() {
        let text = first.text;
        if !emit_text_only_turn(&job, &text, &mut sequence) {
            return;
        }
        emit_completed(&job, sequence, 1, json!([{ "role": "assistant", "content": text }]));
        return;
    }

    let mut transcript = Vec::new();
    if !run_tool_calls(&job, &mut conversation, &calls, &mut sequence, &mut transcript) {
        return;
    }
    let second = match call_host_model(&job, &conversation) {
        Ok(assembled) => assembled,
        Err(other) => {
            finish_host_call(&job, sequence, other);
            return;
        }
    };
    let text = second.text;
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
                "content": [{ "type": "text", "text": text }],
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
        "content": [{ "type": "text", "text": text }],
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
            let message = response
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("Host module_call failed.");
            emit_failed_terminal(job, sequence, code, message);
        }
        HostCall::Ok(_) => {}
    }
}

fn emit_text_only_turn(job: &StubJob, text: &str, sequence: &mut u64) -> bool {
    emit_stub_event(
        job,
        "event",
        "agent.message",
        *sequence,
        json!({
            "type": "message",
            "role": "assistant",
            "text": text,
            "sessionId": job.session_id,
            "turnId": job.turn_id,
            "stub": true,
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
    calls: &[Value],
    sequence: &mut u64,
    transcript: &mut Vec<Value>,
) -> bool {
    emit_stub_event(
        job,
        "event",
        "agent.tool_calls_detected",
        *sequence,
        json!({
            "type": "tool_calls_detected",
            "sessionId": job.session_id,
            "turnId": job.turn_id,
            "calls": calls.iter().map(|call| {
                json!({
                    "id": call.get("id").cloned().unwrap_or(Value::Null),
                    "name": call.get("name").cloned().unwrap_or(Value::Null),
                    "input": call.get("input").cloned().unwrap_or(json!({})),
                })
            }).collect::<Vec<_>>(),
        }),
    );
    *sequence += 1;
    if stub_interrupted(job) {
        emit_cancelled_terminal(job, *sequence);
        return false;
    }

    for call in calls {
        let tool_call_id = call.get("id").and_then(Value::as_str).unwrap_or("");
        let tool_name = call.get("name").and_then(Value::as_str).unwrap_or("");
        let tool_input = call.get("input").cloned().unwrap_or(json!({}));
        let started_at = now_iso();
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
            other => {
                finish_host_call(job, *sequence, other);
                return false;
            }
        };
        if stub_interrupted(job) {
            emit_cancelled_terminal(job, *sequence);
            return false;
        }
        let result = capability_result(&capability, tool_call_id, tool_name, &started_at);
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
        if stub_interrupted(job) {
            emit_cancelled_terminal(job, *sequence);
            return false;
        }
        let assistant_call = json!({
            "role": "assistant",
            "content": [{
                "type": "tool_call",
                "id": tool_call_id,
                "name": tool_name,
                "input": tool_input,
            }],
        });
        let user_result = json!({
            "role": "user",
            "content": [{
                "type": "tool_result",
                "toolCallId": tool_call_id,
                "content": result.get("content").cloned().unwrap_or(json!([])),
            }],
        });
        append_conversation(conversation, assistant_call.clone());
        append_conversation(conversation, user_result.clone());
        transcript.push(assistant_call);
        transcript.push(user_result);
    }
    true
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
    last_user_text_from_messages(payload.get("messages")).unwrap_or_else(|| DEFAULT_STUB_TEXT.to_string())
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
    tool_calls: Vec<Value>,
}

fn model_request(payload: &Value, messages: &Value) -> Value {
    let mut request = json!({
        "provider": first_nonempty_id(&[
            payload.pointer("/agent/provider"),
            payload.pointer("/hostModules/model/provider"),
        ]).unwrap_or_else(|| STUB_PROVIDER.to_string()),
        "model": first_nonempty_id(&[
            payload.get("modelOverride"),
            payload.pointer("/agent/model"),
            payload.pointer("/hostModules/model/model"),
        ]).unwrap_or_else(|| STUB_MODEL.to_string()),
        "messages": messages,
    });
    if let Some(tools) = payload.get("tools") {
        request["tools"] = tools.clone();
    }
    request
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
/// `preparationId`, then `prepare` → `stream` → `close_stream`.
fn call_host_model(job: &StubJob, conversation: &Value) -> Result<AssembledModel, HostCall> {
    let preparation_id = next_id(&job.inner, "prepared");
    let request = model_request(&job.payload, conversation);
    let context = model_execution_context(job);
    match call_host_module(
        job,
        "model",
        json!({
            "operation": "prepare",
            "preparationId": preparation_id,
            "request": request,
            "context": context,
        }),
    ) {
        HostCall::Ok(_) => {}
        other => return Err(other),
    }
    if stub_interrupted(job) {
        let _ = close_host_stream(job, &preparation_id);
        return Err(HostCall::Interrupted);
    }
    let stream = call_host_module(
        job,
        "model",
        json!({
            "operation": "stream",
            "preparationId": preparation_id,
            "request": request,
            "context": context,
        }),
    );
    if stub_interrupted(job) {
        let _ = close_host_stream(job, &preparation_id);
        return Err(HostCall::Interrupted);
    }
    let assembled = match stream {
        HostCall::Ok(response) => assemble_from_host_response(&response),
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
    let mut tool_calls = Vec::new();
    for event in events {
        match event.get("type").and_then(Value::as_str) {
            Some("text_delta") => {
                if let Some(delta) = event.get("text").and_then(Value::as_str) {
                    text.push_str(delta);
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
    AssembledModel { text, tool_calls }
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
                    Value::String(raw) => serde_json::from_str(raw).unwrap_or(json!({ "raw": raw })),
                    other => other.clone(),
                })
        })
        .unwrap_or(json!({}));
    Some(json!({ "id": id, "name": name, "input": input }))
}

fn capability_result(response: &Value, tool_call_id: &str, tool_name: &str, started_at: &str) -> Value {
    let payload = response.get("payload").cloned().unwrap_or(json!({}));
    let result = payload.get("result").cloned().unwrap_or(payload);
    let content = result
        .get("content")
        .cloned()
        .unwrap_or_else(|| json!([{ "type": "text", "text": result.to_string() }]));
    let completed_at = result
        .get("completedAt")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(now_iso);
    json!({
        "type": result.get("type").and_then(Value::as_str).unwrap_or("success"),
        "toolCallId": result.get("toolCallId").and_then(Value::as_str).unwrap_or(tool_call_id),
        "toolName": result.get("toolName").and_then(Value::as_str).unwrap_or(tool_name),
        "content": content,
        "startedAt": result.get("startedAt").and_then(Value::as_str).unwrap_or(started_at),
        "completedAt": completed_at,
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
    use std::sync::mpsc;
    use std::time::Instant;

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
                let name = call.pointer("/payload/name").and_then(Value::as_str).unwrap_or("lookup");
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

    fn execute_line(message_id: &str, run_id: &str, operation_id: &str, request_id: &str, payload: &str) -> String {
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
            .find(|m| m["eventType"] == "agent.message")
            .expect("pure_text agent.message");
        assert_eq!(message["payload"]["type"], "message");
        assert_eq!(message["payload"]["text"], "HOST[What is the status?]");
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
        assert_eq!(events.len(), 4);
        assert_eq!(events[0]["eventType"], "agent.tool_calls_detected");
        assert_eq!(events[0]["final"], false);
        assert_eq!(events[0]["sequence"], 0);
        assert_eq!(events[0]["payload"]["type"], "tool_calls_detected");
        assert_eq!(events[0]["payload"]["sessionId"], "sess-st");
        assert_eq!(events[0]["payload"]["turnId"], "turn-st");
        let call = &events[0]["payload"]["calls"][0];
        assert_eq!(call["name"], "lookup");
        assert_eq!(call["input"]["q"], "Look up the status");
        let tool_call_id = call["id"].as_str().expect("tool call id");
        assert!(!tool_call_id.is_empty());

        assert_eq!(events[1]["eventType"], "agent.tool_result");
        assert_eq!(events[1]["payload"]["type"], "tool_result");
        assert_eq!(events[1]["payload"]["result"]["type"], "success");
        assert_eq!(events[1]["payload"]["result"]["toolName"], "lookup");
        assert_eq!(events[1]["payload"]["result"]["toolCallId"], tool_call_id);
        let result_text = events[1]["payload"]["result"]["content"][0]["text"]
            .as_str()
            .expect("tool result text");
        assert!(result_text.contains("Look up the status"));
        assert!(result_text.contains("lookup"));

        assert_eq!(events[2]["eventType"], "agent.assistant_message");
        assert_eq!(events[2]["payload"]["type"], "assistant_message");
        assert_eq!(
            events[2]["payload"]["message"]["content"][0]["text"],
            "HOST[Look up the status]"
        );

        let terminal = events[3];
        assert_eq!(terminal["final"], true);
        assert_eq!(terminal["outcome"], "completed");
        assert_eq!(terminal["eventType"], "agent.execute.completed");
        assert_eq!(terminal["payload"]["result"]["type"], "success");
        assert_eq!(terminal["payload"]["result"]["sessionId"], "sess-st");
        assert_eq!(terminal["payload"]["result"]["turnId"], "turn-st");
        assert_eq!(terminal["payload"]["result"]["turns"], 2);
        assert_eq!(
            terminal["payload"]["messages"][0]["content"][0]["type"],
            "tool_call"
        );
        assert_eq!(
            terminal["payload"]["messages"][1]["content"][0]["type"],
            "tool_result"
        );
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
            .filter(|m| m["eventType"] == "agent.assistant_message")
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
            .find(|m| m["eventType"] == "agent.message")
            .expect("text path despite tools[] + scenario");
        assert_eq!(message["payload"]["text"], "HOST[block-prompt]");
        assert!(lines
            .iter()
            .all(|m| m.get("eventType").and_then(Value::as_str) != Some("agent.tool_calls_detected")));
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
        assert!(terminal["payload"]["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains('B'));
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
        assert!(lines.iter().any(|m| m["kind"] == "request" && m["method"] == "module_call"));
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
        assert!(lines.iter().any(|m| m["kind"] == "request" && m["method"] == "module_call"));
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
            status_b["payload"]["requestIds"].as_array().is_some_and(|ids| {
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
