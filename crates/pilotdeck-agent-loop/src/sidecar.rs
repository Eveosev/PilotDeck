//! In-process sidecar state machine. Transport (stdio) is layered on top.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::{json, Value};

use crate::protocol::{parse_json_line, validate_module_message, Validation};
use crate::time::{now_iso, now_unix_ms, parse_iso_ms};
use crate::{CAPABILITIES_VERSION, MODULE_ID, PROTOCOL_VERSION};

const STUB_POLL_MS: u64 = 10;
const DEFAULT_STUB_TEXT: &str = "What is the status?";

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
    token: AtomicU64,
    operations: Mutex<Operations>,
    joins: Mutex<Vec<JoinHandle<()>>>,
}

/// Module Protocol sidecar that speaks hello/capabilities/execute/cancel/status.
pub struct Sidecar {
    inner: Arc<Inner>,
}

impl Sidecar {
    pub fn new(emit: Arc<dyn Fn(Value) + Send + Sync>) -> Self {
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
                token,
                operations: Mutex::new(Operations {
                    by_id: HashMap::new(),
                    request_to_operation: HashMap::new(),
                    active: HashMap::new(),
                }),
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

        if deadline_already_exceeded(&request) {
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
        let handle = thread::spawn(move || {
            run_stub_execute(StubJob {
                inner,
                run_id,
                operation_id,
                request_id,
                stream_id,
                payload,
                cancel,
                deadline_exceeded,
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
            "transport": "stdio",
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
    stream_id: String,
    payload: Value,
    cancel: Arc<AtomicBool>,
    deadline_exceeded: Arc<AtomicBool>,
}

fn run_stub_execute(job: StubJob) {
    let delay = stub_delay_ms(&job.payload);
    let mut sequence: u64 = 0;
    let cancelled_during_delay = sleep_cancellable(delay, &job.cancel);
    if cancelled_during_delay {
        emit_cancelled_terminal(&job, sequence);
        return;
    }

    let prompt = stub_prompt(&job.payload);
    let scenario = stub_scenario(&job.payload);
    let text = format!("STUB[{scenario}]: {prompt}");
    (job.inner.emit)(json!({
        "kind": "event",
        "messageId": next_id(&job.inner, "event"),
        "eventType": "agent.message",
        "streamId": job.stream_id,
        "sequence": sequence,
        "runId": job.run_id,
        "operationId": job.operation_id,
        "requestId": job.request_id,
        "final": false,
        "payload": {
            "type": "message",
            "role": "assistant",
            "text": text,
            "stub": true,
        },
    }));
    sequence += 1;

    if job.cancel.load(Ordering::SeqCst) {
        emit_cancelled_terminal(&job, sequence);
        return;
    }

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
            "result": {
                "type": "success",
                "stopReason": "completed",
                "turns": 1
            },
            "messages": [{ "role": "assistant", "content": text }],
            "stub": { "model": "pilotdeck-stub", "scenario": scenario }
        },
    }));
    clear_active(&job);
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
        "payload": {},
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

fn sleep_cancellable(delay_ms: u64, cancel: &AtomicBool) -> bool {
    let mut remaining = delay_ms;
    while remaining > 0 {
        if cancel.load(Ordering::SeqCst) {
            return true;
        }
        let slice = remaining.min(STUB_POLL_MS);
        thread::sleep(Duration::from_millis(slice));
        remaining = remaining.saturating_sub(slice);
    }
    cancel.load(Ordering::SeqCst)
}

fn stub_delay_ms(payload: &Value) -> u64 {
    payload
        .pointer("/stub/delayMs")
        .or_else(|| payload.get("delayMs"))
        .and_then(value_as_u64)
        .unwrap_or(0)
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

fn stub_prompt(payload: &Value) -> String {
    if let Some(text) = payload
        .get("q")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        return text.to_string();
    }
    if let Some(text) = payload
        .get("prompt")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        return text.to_string();
    }
    if let Some(messages) = payload.get("messages").and_then(Value::as_array) {
        for message in messages.iter().rev() {
            if let Some(text) = message
                .get("content")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                return text.to_string();
            }
            if let Some(text) = message
                .get("text")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                return text.to_string();
            }
        }
    }
    DEFAULT_STUB_TEXT.to_string()
}

fn stub_scenario(payload: &Value) -> String {
    payload
        .get("scenario")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or("pure_text")
        .to_string()
}

fn deadline_already_exceeded(request: &Value) -> bool {
    let now = now_unix_ms();
    ["operationDeadline", "attemptDeadline"]
        .into_iter()
        .filter_map(|field| {
            request
                .get(field)
                .and_then(Value::as_str)
                .and_then(parse_iso_ms)
        })
        .min()
        .is_some_and(|deadline| deadline <= now)
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
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let n = token.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}-{n:x}-{:x}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;
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
        let (sidecar, sink) = collect();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"ex-1","method":"execute","runId":"run-1","operationId":"op-1","requestId":"req-1","payload":{"scenario":"pure_text","q":"What is the status?"}}"#,
        );
        sidecar.join();
        let lines = sink.lock().expect("sink").clone();
        assert_eq!(lines[0]["ok"], true);
        assert!(lines[0]
            .get("streamId")
            .and_then(Value::as_str)
            .is_some_and(|id| !id.is_empty()));
        assert_eq!(lines[0].get("final"), None);
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
        assert!(validate_module_message(terminal).is_ok());
        assert!(validate_module_message(&lines[0]).is_ok());
    }

    #[test]
    fn execute_duplicate_keys_use_last_request_id() {
        let (sidecar, sink) = collect();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"ex-dup","method":"execute","runId":"run-1","operationId":"op-dup","requestId":"first","payload":{"q":"A"},"requestId":"second","payload":{"q":"B","scenario":"pure_text"}}"#,
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
    fn execute_finished_run_mismatch_is_rejected() {
        let (sidecar, sink) = collect();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"ex-done","method":"execute","runId":"run-a","operationId":"op-reuse","requestId":"req-a","payload":{"scenario":"pure_text"}}"#,
        );
        sidecar.join();
        sidecar.handle_line(
            r#"{"kind":"request","messageId":"ex-reuse","method":"execute","runId":"run-b","operationId":"op-reuse","requestId":"req-b","payload":{"scenario":"pure_text"}}"#,
        );
        let lines = sink.lock().expect("sink").clone();
        let rejected = lines.iter().find(|m| m["inReplyTo"] == "ex-reuse").unwrap();
        assert_eq!(rejected["ok"], false);
        assert_eq!(rejected["code"], "OPERATION_RUN_MISMATCH");
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
