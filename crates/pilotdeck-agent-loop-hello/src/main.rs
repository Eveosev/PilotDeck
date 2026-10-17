use std::io::{self, BufRead, Write};
use std::process;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

/// Same Module Protocol version as `MODULE_PROTOCOL_VERSION` in `src/agent/modules/protocol.ts`.
const PROTOCOL_VERSION: &str = "2.0";
const MODULE_ID: &str = "pilotdeck-agent-loop-hello";
const CAPABILITIES_VERSION: &str = "1";

static TOKEN: AtomicU64 = AtomicU64::new(0);

fn main() {
    let module_instance_id = format!("{MODULE_ID}-instance-{}", next_token());
    let connection_generation = format!("{module_instance_id}-{}", next_token());

    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut seq: u64 = 0;

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("stdin read failed: {error}");
                process::exit(1);
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        seq += 1;
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(value) => handle_message(&value, &module_instance_id, &connection_generation),
            Err(_) => json!({
                "kind": "error",
                "messageId": format!("parse-{seq}"),
                "code": "INVALID_JSON",
                "message": "Module message is not valid JSON.",
                "retryability": "unsafe",
            }),
        };
        if let Err(error) = writeln!(stdout, "{reply}") {
            eprintln!("stdout write failed: {error}");
            process::exit(1);
        }
        if let Err(error) = stdout.flush() {
            eprintln!("stdout flush failed: {error}");
            process::exit(1);
        }
    }
}

fn handle_message(value: &Value, module_instance_id: &str, connection_generation: &str) -> Value {
    if value.get("kind").and_then(Value::as_str) != Some("request") {
        return protocol_error(
            "INVALID_KIND",
            "Hello sidecar only accepts Module Protocol request frames.",
        );
    }
    let Some(message_id) = value
        .get("messageId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
    else {
        return protocol_error("MISSING_MESSAGE_ID", "Message messageId is required.");
    };
    match value.get("method").and_then(Value::as_str).unwrap_or("") {
        method @ ("hello" | "capabilities") => {
            if !value.get("payload").is_some_and(Value::is_object) {
                return protocol_error("INVALID_HANDSHAKE_REQUEST", "Handshake requires payload.");
            }
            handshake_response(
                method,
                message_id,
                module_instance_id,
                connection_generation,
            )
        }
        method @ ("execute" | "cancel" | "status" | "resume" | "ack" | "module_call") => json!({
            "kind": "response",
            "messageId": format!("{method}-{}", next_token()),
            "inReplyTo": message_id,
            "ok": false,
            "code": "METHOD_UNSUPPORTED",
            "error": { "message": "Hello sidecar implements hello and capabilities only." },
        }),
        _ => protocol_error("INVALID_METHOD", "Module request method is invalid."),
    }
}

fn handshake_response(
    method: &str,
    in_reply_to: &str,
    module_instance_id: &str,
    connection_generation: &str,
) -> Value {
    let mut response = json!({
        "kind": "response",
        "messageId": format!("{method}-{}", next_token()),
        "inReplyTo": in_reply_to,
        "ok": true,
        "protocolVersion": PROTOCOL_VERSION,
        "moduleId": MODULE_ID,
        "moduleInstanceId": module_instance_id,
        "connectionGeneration": connection_generation,
        "capabilitiesVersion": CAPABILITIES_VERSION,
        "payload": {},
    });
    if method == "capabilities" {
        response["payload"] = json!({
            "capabilitiesVersion": CAPABILITIES_VERSION,
            "transport": "stdio",
            "methods": [
                { "name": "execute", "enabled": false },
                { "name": "cancel", "enabled": false },
                { "name": "status", "enabled": false },
                { "name": "resume", "enabled": false },
                { "name": "ack", "enabled": false },
            ],
        });
    }
    response
}

fn protocol_error(code: &str, message: &str) -> Value {
    json!({
        "kind": "error",
        "messageId": format!("validation-{}", next_token()),
        "code": code,
        "message": message,
        "retryability": "unsafe",
    })
}

fn next_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let n = TOKEN.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:x}-{n:x}-{:x}", process::id())
}
