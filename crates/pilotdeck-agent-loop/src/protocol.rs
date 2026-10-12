//! Hand-written Module Protocol validator aligned with `validateModuleMessage`.
//!
//! Incoming JSON is always a [`serde_json::Value`] (duplicate keys: last wins).

use serde_json::Value;

const MODULE_CALL_TARGETS: &[&str] = &[
    "model",
    "budget",
    "turn",
    "capability",
    "permission",
    "checkpoint",
    "context",
    "skills",
    "knowledge",
    "lifecycle",
    "event",
];

const OUTCOMES: &[&str] = &["completed", "failed", "cancelled", "result_unknown"];

/// Result of [`validate_module_message`], matching the TS `{ ok }` / `{ ok, code, message }` shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Validation {
    Ok,
    Invalid { code: &'static str, message: String },
}

impl Validation {
    pub fn is_ok(&self) -> bool {
        matches!(self, Self::Ok)
    }

    pub fn code(&self) -> Option<&'static str> {
        match self {
            Self::Ok => None,
            Self::Invalid { code, .. } => Some(*code),
        }
    }

    pub fn message(&self) -> Option<&str> {
        match self {
            Self::Ok => None,
            Self::Invalid { message, .. } => Some(message),
        }
    }
}

fn invalid(code: &'static str, message: impl Into<String>) -> Validation {
    Validation::Invalid {
        code,
        message: message.into(),
    }
}

/// Validate one already-parsed Module Protocol message.
///
/// Callers must parse raw text with [`serde_json::from_str::<Value>`] first.
/// Do not deserialize the wire frame directly into a derived struct.
pub fn validate_module_message(value: &Value) -> Validation {
    if !is_record(value) {
        return invalid("INVALID_MESSAGE", "Module message must be an object.");
    }
    let message = value;
    let kind = message.get("kind").and_then(Value::as_str);
    if !matches!(kind, Some("request" | "response" | "event" | "error")) {
        return invalid("INVALID_KIND", "Module message kind is invalid.");
    }
    if kind != Some("event") && !is_id(message.get("messageId")) {
        return invalid("MISSING_MESSAGE_ID", "Message messageId is required.");
    }
    if kind == Some("event")
        && message.get("messageId").is_some()
        && !is_id(message.get("messageId"))
    {
        return invalid("INVALID_EVENT_FIELD", "Event messageId is invalid.");
    }
    if kind == Some("request") {
        return validate_request(message);
    }
    if kind == Some("event") {
        return validate_event(message);
    }
    if kind == Some("response") {
        return validate_response(message);
    }
    validate_error(message)
}

fn validate_request(message: &Value) -> Validation {
    match message.get("method").and_then(Value::as_str) {
        Some("execute") => validate_execute(message),
        Some("module_call") => validate_module_call(message),
        Some("cancel") => validate_cancel(message),
        Some("status") => {
            if is_id(message.get("requestId")) {
                Validation::Ok
            } else {
                invalid("INVALID_STATUS_REQUEST", "Status requires requestId.")
            }
        }
        Some("resume") => {
            if is_id(message.get("streamId"))
                && is_binding(message.get("previousBinding"))
                && is_resume_sequence(message.get("lastAppliedSequence"))
            {
                Validation::Ok
            } else {
                invalid(
                    "INVALID_RESUME_REQUEST",
                    "Resume requires streamId, previousBinding, and lastAppliedSequence.",
                )
            }
        }
        Some("ack") => {
            if is_id(message.get("streamId")) && is_sequence(message.get("lastAppliedSequence")) {
                Validation::Ok
            } else {
                invalid(
                    "INVALID_ACK_REQUEST",
                    "Ack requires streamId and lastAppliedSequence.",
                )
            }
        }
        Some("hello" | "capabilities") => {
            if is_record(message.get("payload").unwrap_or(&Value::Null)) {
                Validation::Ok
            } else {
                invalid("INVALID_HANDSHAKE_REQUEST", "Handshake requires payload.")
            }
        }
        _ => invalid("INVALID_METHOD", "Module request method is invalid."),
    }
}

fn validate_execute(message: &Value) -> Validation {
    for field in ["runId", "operationId", "requestId"] {
        if !is_id(message.get(field)) {
            return invalid(
                "MISSING_EXECUTE_FIELD",
                format!("Execute request field {field} is required."),
            );
        }
    }
    if !is_record(message.get("payload").unwrap_or(&Value::Null)) {
        return invalid(
            "MISSING_EXECUTE_FIELD",
            "Execute request field payload is required.",
        );
    }
    if message.get("idempotencyKey").is_some() && !is_id(message.get("idempotencyKey")) {
        return invalid(
            "INVALID_EXECUTE_FIELD",
            "Execute request idempotencyKey is invalid.",
        );
    }
    if message.get("operationDeadline").is_some()
        && !message
            .get("operationDeadline")
            .is_some_and(Value::is_string)
    {
        return invalid(
            "INVALID_EXECUTE_FIELD",
            "Execute request operationDeadline is invalid.",
        );
    }
    if message.get("attemptDeadline").is_some()
        && !message.get("attemptDeadline").is_some_and(Value::is_string)
    {
        return invalid(
            "INVALID_EXECUTE_FIELD",
            "Execute request attemptDeadline is invalid.",
        );
    }
    if has_key(message, "attemptId") || has_key(message, "stepId") {
        return invalid(
            "UNSUPPORTED_FIELD",
            "attemptId and stepId are not public fields.",
        );
    }
    Validation::Ok
}

fn validate_module_call(message: &Value) -> Validation {
    for field in ["runId", "operationId", "requestId"] {
        if !is_id(message.get(field)) {
            return invalid(
                "MISSING_MODULE_CALL_FIELD",
                format!("Module call field {field} is required."),
            );
        }
    }
    if !is_record(message.get("payload").unwrap_or(&Value::Null)) {
        return invalid(
            "MISSING_MODULE_CALL_FIELD",
            "Module call field payload is required.",
        );
    }
    if message.get("idempotencyKey").is_some() && !is_id(message.get("idempotencyKey")) {
        return invalid(
            "INVALID_MODULE_CALL_FIELD",
            "Module call idempotencyKey is invalid.",
        );
    }
    let target = message.get("module").and_then(Value::as_str);
    if !target.is_some_and(|module| MODULE_CALL_TARGETS.contains(&module)) {
        return invalid("INVALID_MODULE", "Module call target is invalid.");
    }
    Validation::Ok
}

fn validate_cancel(message: &Value) -> Validation {
    let reason = message.get("reason").and_then(Value::as_str);
    if !is_id(message.get("runId"))
        || !is_id(message.get("operationId"))
        || reason.is_none_or(str::is_empty)
    {
        return invalid(
            "INVALID_CANCEL_REQUEST",
            "Cancel requires runId, operationId, and reason.",
        );
    }
    if message.get("requestId").is_some() && !is_id(message.get("requestId")) {
        return invalid("INVALID_CANCEL_REQUEST", "Cancel requestId is invalid.");
    }
    Validation::Ok
}

fn validate_event(message: &Value) -> Validation {
    for field in ["eventType", "streamId", "runId", "operationId", "requestId"] {
        if !is_id(message.get(field)) {
            return invalid(
                "MISSING_EVENT_FIELD",
                format!("Event field {field} is required."),
            );
        }
    }
    if !is_sequence(message.get("sequence"))
        || !message.get("final").is_some_and(Value::is_boolean)
        || !is_record(message.get("payload").unwrap_or(&Value::Null))
    {
        return invalid(
            "MISSING_EVENT_FIELD",
            "Event sequence, final, and payload are required.",
        );
    }
    let final_flag = message.get("final").and_then(Value::as_bool) == Some(true);
    if final_flag && !is_outcome(message.get("outcome")) {
        return invalid("MISSING_OUTCOME", "Final event requires outcome.");
    }
    if message.get("outcome").is_some() && !is_outcome(message.get("outcome")) {
        return invalid("INVALID_OUTCOME", "Event outcome is invalid.");
    }
    if message.get("code").is_some() && !is_id(message.get("code")) {
        return invalid("INVALID_EVENT_FIELD", "Event code is invalid.");
    }
    if has_key(message, "moduleInstanceId") || has_key(message, "connectionGeneration") {
        return invalid(
            "UNSUPPORTED_FIELD",
            "Connection binding belongs to transport context.",
        );
    }
    Validation::Ok
}

fn validate_response(message: &Value) -> Validation {
    if !is_id(message.get("inReplyTo")) || !message.get("ok").is_some_and(Value::is_boolean) {
        return invalid("INVALID_RESPONSE", "Response requires inReplyTo and ok.");
    }
    let final_flag = message.get("final").and_then(Value::as_bool) == Some(true);
    if final_flag && !is_outcome(message.get("outcome")) {
        return invalid("MISSING_OUTCOME", "Final response requires outcome.");
    }
    if message.get("outcome").is_some() && !is_outcome(message.get("outcome")) {
        return invalid("INVALID_OUTCOME", "Response outcome is invalid.");
    }
    Validation::Ok
}

fn validate_error(message: &Value) -> Validation {
    let text = message.get("message").and_then(Value::as_str);
    if !is_id(message.get("code")) || text.is_none_or(str::is_empty) {
        return invalid("INVALID_ERROR", "Error requires code and message.");
    }
    match message.get("retryability").and_then(Value::as_str) {
        Some("safe" | "unsafe" | "retry_after_status") => Validation::Ok,
        _ => invalid("INVALID_ERROR", "Error retryability is invalid."),
    }
}

fn is_record(value: &Value) -> bool {
    value.is_object()
}

fn is_id(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|id| !id.is_empty())
}

fn is_sequence(value: Option<&Value>) -> bool {
    integer_at_least(value, 0)
}

fn is_resume_sequence(value: Option<&Value>) -> bool {
    integer_at_least(value, -1)
}

fn integer_at_least(value: Option<&Value>, minimum: i64) -> bool {
    let Some(Value::Number(number)) = value else {
        return false;
    };
    if let Some(int) = number.as_i64() {
        return int >= minimum;
    }
    if let Some(uint) = number.as_u64() {
        return i64::try_from(uint)
            .map(|int| int >= minimum)
            .unwrap_or(true);
    }
    number
        .as_f64()
        .is_some_and(|float| float.is_finite() && float.fract() == 0.0 && float >= minimum as f64)
}

fn is_outcome(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|outcome| OUTCOMES.contains(&outcome))
}

fn is_binding(value: Option<&Value>) -> bool {
    let Some(binding) = value else {
        return false;
    };
    is_record(binding)
        && is_id(binding.get("moduleInstanceId"))
        && is_id(binding.get("connectionGeneration"))
}

fn has_key(value: &Value, key: &str) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.contains_key(key))
}

/// Parse a raw JSON text frame. Duplicate keys: last wins (`serde_json::Value`).
pub fn parse_json_line(line: &str) -> Result<Value, serde_json::Error> {
    serde_json::from_str::<Value>(line)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn raw(text: &str) -> Value {
        serde_json::from_str(text).expect("fixture must be JSON")
    }

    #[test]
    fn hello_and_capabilities_require_payload_object() {
        assert!(validate_module_message(&json!({
            "kind": "request",
            "messageId": "hello-1",
            "method": "hello",
            "payload": {}
        }))
        .is_ok());
        assert_eq!(
            validate_module_message(&json!({
                "kind": "request",
                "messageId": "hello-1",
                "method": "hello"
            }))
            .code(),
            Some("INVALID_HANDSHAKE_REQUEST")
        );
        assert_eq!(
            validate_module_message(&json!({
                "kind": "request",
                "messageId": "caps-1",
                "method": "capabilities",
                "payload": []
            }))
            .code(),
            Some("INVALID_HANDSHAKE_REQUEST")
        );
    }

    #[test]
    fn execute_rejects_missing_fields_and_forbidden_ids() {
        let valid = json!({
            "kind": "request",
            "messageId": "message-1",
            "method": "execute",
            "runId": "run-1",
            "operationId": "operation-1",
            "requestId": "request-1",
            "payload": {}
        });
        assert!(validate_module_message(&valid).is_ok());
        assert_eq!(
            validate_module_message(&json!({
                "kind": "request",
                "messageId": "message-1",
                "method": "execute",
                "runId": "run-1",
                "operationId": "operation-1",
                "payload": {}
            }))
            .code(),
            Some("MISSING_EXECUTE_FIELD")
        );
        let mut with_attempt = valid.clone();
        with_attempt["attemptId"] = json!("attempt-1");
        assert_eq!(
            validate_module_message(&with_attempt).code(),
            Some("UNSUPPORTED_FIELD")
        );
        let mut with_step = valid;
        with_step["stepId"] = json!("step-1");
        assert_eq!(
            validate_module_message(&with_step).code(),
            Some("UNSUPPORTED_FIELD")
        );
    }

    #[test]
    fn execute_duplicate_keys_last_wins_like_json_parse() {
        let value = raw(
            r#"{"kind":"request","messageId":"m","method":"execute","runId":"run-1","operationId":"op-1","requestId":"first","payload":{"prompt":"A"},"requestId":"second","payload":{"prompt":"B","scenario":"pure_text"}}"#,
        );
        assert_eq!(value["requestId"], "second");
        assert_eq!(value["payload"]["prompt"], "B");
        assert!(validate_module_message(&value).is_ok());
    }

    #[test]
    fn cancel_and_status_validate_required_fields() {
        assert!(validate_module_message(&json!({
            "kind": "request",
            "messageId": "cancel-1",
            "method": "cancel",
            "runId": "run-1",
            "operationId": "operation-1",
            "reason": "user_cancelled"
        }))
        .is_ok());
        assert_eq!(
            validate_module_message(&json!({
                "kind": "request",
                "messageId": "cancel-2",
                "method": "cancel",
                "runId": "run-1",
                "operationId": "operation-1"
            }))
            .code(),
            Some("INVALID_CANCEL_REQUEST")
        );
        assert!(validate_module_message(&json!({
            "kind": "request",
            "messageId": "status-1",
            "method": "status",
            "requestId": "request-1"
        }))
        .is_ok());
        assert_eq!(
            validate_module_message(&json!({
                "kind": "request",
                "messageId": "status-1",
                "method": "status"
            }))
            .code(),
            Some("INVALID_STATUS_REQUEST")
        );
    }

    #[test]
    fn resume_and_ack_are_valid_protocol_but_out_of_scope_for_sidecar() {
        assert!(validate_module_message(&json!({
            "kind": "request",
            "messageId": "resume-1",
            "method": "resume",
            "streamId": "stream-1",
            "previousBinding": { "moduleInstanceId": "instance-1", "connectionGeneration": "connection-1" },
            "lastAppliedSequence": -1
        }))
        .is_ok());
        assert_eq!(
            validate_module_message(&json!({
                "kind": "request",
                "messageId": "ack-1",
                "method": "ack",
                "streamId": "stream-1",
                "lastAppliedSequence": -1
            }))
            .code(),
            Some("INVALID_ACK_REQUEST")
        );
        assert!(validate_module_message(&json!({
            "kind": "request",
            "messageId": "ack-2",
            "method": "ack",
            "streamId": "stream-1",
            "lastAppliedSequence": 0
        }))
        .is_ok());
    }

    #[test]
    fn event_and_response_enforce_final_implies_outcome_and_forbidden_binding() {
        assert!(validate_module_message(&json!({
            "kind": "event",
            "eventType": "model.delta",
            "streamId": "stream-1",
            "sequence": 0,
            "runId": "run-1",
            "operationId": "operation-1",
            "requestId": "request-1",
            "final": false,
            "payload": {}
        }))
        .is_ok());
        assert_eq!(
            validate_module_message(&json!({
                "kind": "event",
                "eventType": "model.delta",
                "streamId": "stream-1",
                "sequence": 0,
                "runId": "run-1",
                "operationId": "operation-1",
                "requestId": "request-1",
                "final": true,
                "payload": {}
            }))
            .code(),
            Some("MISSING_OUTCOME")
        );
        assert_eq!(
            validate_module_message(&json!({
                "kind": "event",
                "eventType": "model.delta",
                "streamId": "stream-1",
                "sequence": 0,
                "runId": "run-1",
                "operationId": "operation-1",
                "requestId": "request-1",
                "final": false,
                "payload": {},
                "moduleInstanceId": "instance-1"
            }))
            .code(),
            Some("UNSUPPORTED_FIELD")
        );
        assert_eq!(
            validate_module_message(&json!({
                "kind": "response",
                "messageId": "response-1",
                "inReplyTo": "message-1",
                "ok": true,
                "final": true
            }))
            .code(),
            Some("MISSING_OUTCOME")
        );
        assert!(validate_module_message(&json!({
            "kind": "response",
            "messageId": "response-1",
            "inReplyTo": "message-1",
            "ok": true,
            "final": true,
            "outcome": "completed"
        }))
        .is_ok());
    }

    #[test]
    fn malformed_kind_and_error_retryability() {
        assert_eq!(
            validate_module_message(&json!("not-an-object")).code(),
            Some("INVALID_MESSAGE")
        );
        assert_eq!(
            validate_module_message(&json!({ "kind": "nope", "messageId": "x" })).code(),
            Some("INVALID_KIND")
        );
        assert_eq!(
            validate_module_message(&json!({
                "kind": "error",
                "messageId": "error-1",
                "code": "BROKEN",
                "message": "broken",
                "retryability": "sometimes"
            }))
            .code(),
            Some("INVALID_ERROR")
        );
        assert!(validate_module_message(&json!({
            "kind": "error",
            "messageId": "error-1",
            "code": "INVALID_JSON",
            "message": "Module message is not valid JSON.",
            "retryability": "unsafe"
        }))
        .is_ok());
    }

    #[test]
    fn parse_json_line_last_key_wins() {
        let value = parse_json_line(r#"{"a":1,"a":2,"b":{"k":"old"},"b":{"k":"new"}}"#).unwrap();
        assert_eq!(value["a"], 2);
        assert_eq!(value["b"]["k"], "new");
    }
}
