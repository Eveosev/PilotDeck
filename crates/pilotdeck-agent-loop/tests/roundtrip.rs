//! Every Rust-emitted message must pass T-P0a-01 ajv-strict schema AND
//! TS `validateModuleMessage`, with zero accept/reject mismatch.

mod common;

use common::{repo_root, spawn_sidecar};
use serde_json::{json, Value};
use std::fs;
use std::process::Command;
use std::time::Duration;

const FAST: Duration = Duration::from_secs(3);

#[test]
fn rust_emitted_messages_roundtrip_schema_and_ts() {
    let mut sidecar = spawn_sidecar();
    sidecar
        .send_json(&json!({"kind":"request","messageId":"hello-1","method":"hello","payload":{}}));
    sidecar.send_json(
        &json!({"kind":"request","messageId":"caps-1","method":"capabilities","payload":{}}),
    );
    sidecar.send_json(&json!({
        "kind":"request","messageId":"ex-done","method":"execute",
        "runId":"run-done","operationId":"op-done","requestId":"req-done",
        "payload":{"scenario":"pure_text","q":"What is the status?"},
        "sessionId":"sess-done","turnId":"turn-done"
    }));
    let _ = sidecar.wait_for(
        |msgs| {
            msgs.iter().any(|m| {
                m.get("kind") == Some(&json!("event"))
                    && m.get("final") == Some(&json!(true))
                    && m.get("inReplyTo").is_none()
                    && m.get("eventType") == Some(&json!("agent.execute.completed"))
                    && m.get("requestId") == Some(&json!("req-done"))
            })
        },
        FAST,
    );
    sidecar.send_json(&json!({
        "kind":"request","messageId":"ex-1","method":"execute",
        "runId":"run-1","operationId":"op-1","requestId":"req-1",
        "payload":{"scenario":"pure_text","q":"What is the status?","delayMs":2000},
        "sessionId":"sess-1","turnId":"turn-1"
    }));
    let _ = sidecar.wait_for(
        |msgs| {
            msgs.iter()
                .any(|m| m.get("inReplyTo") == Some(&json!("ex-1")))
        },
        FAST,
    );
    sidecar.send_json(
        &json!({"kind":"request","messageId":"st-1","method":"status","requestId":"req-1"}),
    );
    sidecar.send_json(&json!({
        "kind":"request","messageId":"cancel-1","method":"cancel",
        "runId":"run-1","operationId":"op-1","reason":"user_cancelled"
    }));
    sidecar.send_json(&json!({
        "kind":"request","messageId":"resume-1","method":"resume",
        "streamId":"stream-1",
        "previousBinding":{"moduleInstanceId":"i","connectionGeneration":"c"},
        "lastAppliedSequence":-1
    }));
    sidecar.send_json(&json!({
        "kind":"request","messageId":"ack-1","method":"ack",
        "streamId":"stream-1","lastAppliedSequence":0
    }));
    sidecar.send_line("not-json");
    sidecar.send_json(&json!({"kind":"nope","messageId":"x"}));
    sidecar.send_json(&json!({"kind":"request","messageId":"hello-bad","method":"hello"}));
    sidecar.send_json(&json!({
        "kind":"request","messageId":"ex-bad","method":"execute",
        "runId":"run-1","operationId":"op-x","requestId":"req-x",
        "payload":{},"attemptId":"a"
    }));
    sidecar.send_json(&json!({
        "kind":"request","messageId":"ex-step","method":"execute",
        "runId":"run-1","operationId":"op-y","requestId":"req-y",
        "payload":{},"stepId":"s"
    }));
    sidecar.send_json(&json!({"kind":"request","messageId":"st-miss","method":"status"}));
    sidecar.send_json(&json!({
        "kind":"request","messageId":"c-miss","method":"cancel",
        "runId":"r","operationId":"missing"
    }));
    sidecar.send_json(&json!({
        "kind":"request","messageId":"mod-1","method":"module_call",
        "runId":"run-1","operationId":"op-1","requestId":"req-mod",
        "module":"model","payload":{}
    }));

    let _ = sidecar.wait_for(
        |msgs| {
            msgs.iter()
                .any(|m| m.get("inReplyTo") == Some(&json!("mod-1")))
                && msgs
                    .iter()
                    .any(|m| m.get("code") == Some(&json!("INVALID_JSON")))
                && msgs
                    .iter()
                    .any(|m| m.get("inReplyTo") == Some(&json!("cancel-1")))
                && msgs.iter().any(|m| {
                    m.get("kind") == Some(&json!("event"))
                        && m.get("final") == Some(&json!(true))
                        && m.get("eventType") == Some(&json!("agent.execute.completed"))
                })
                && msgs.iter().any(|m| {
                    m.get("kind") == Some(&json!("event"))
                        && m.get("final") == Some(&json!(true))
                        && m.get("eventType") == Some(&json!("agent.execute.cancelled"))
                })
        },
        FAST,
    );
    let lines = sidecar.close();
    assert!(
        !lines.is_empty(),
        "sidecar must emit at least one protocol message"
    );
    assert!(
        lines.iter().any(|m| {
            m.get("eventType") == Some(&json!("agent.execute.completed"))
                && m.get("outcome") == Some(&json!("completed"))
                && m.get("requestId") == Some(&json!("req-done"))
                && m.pointer("/payload/result/sessionId") == Some(&json!("sess-done"))
                && m.pointer("/payload/result/turnId") == Some(&json!("turn-done"))
        }),
        "live corpus must include the completed path with F-5 sessionId/turnId: {lines:?}"
    );
    assert!(
        lines.iter().any(|m| {
            m.get("eventType") == Some(&json!("agent.execute.cancelled"))
                && m.get("outcome") == Some(&json!("cancelled"))
                && m.pointer("/payload/result/type") == Some(&json!("aborted"))
        }),
        "live corpus must include the cancelled path with F-5 aborted shape: {lines:?}"
    );
    let cancel = lines
        .iter()
        .find(|m| m.get("inReplyTo") == Some(&json!("cancel-1")))
        .expect("cancel-1 reply");
    assert!(
        cancel.get("requestId").is_none(),
        "cancel without requestId must omit the key: {cancel}"
    );

    let by_kind = count_kinds(&lines);
    for required in ["response", "event", "error"] {
        assert!(
            by_kind.get(required).copied().unwrap_or(0) >= 1,
            "missing emitted kind {required}: {by_kind:?}"
        );
    }

    let script = repo_root().join("crates/pilotdeck-agent-loop/scripts/roundtrip-validate.mjs");
    let tmp = tempfile_path();
    let payload = json!({
        "messages": lines.iter().enumerate().map(|(index, message)| {
            json!({ "id": format!("emitted-{index}"), "source": "rust-sidecar", "message": message })
        }).collect::<Vec<_>>()
    });
    fs::write(&tmp, serde_json::to_string_pretty(&payload).unwrap()).unwrap();
    if let Ok(dump) = std::env::var("T_P1_01_EMITTED_OUT") {
        fs::write(&dump, serde_json::to_string_pretty(&payload).unwrap()).unwrap();
    }

    let output = Command::new("node")
        .arg(&script)
        .arg("--messages")
        .arg(&tmp)
        .current_dir(repo_root())
        .output()
        .expect("node roundtrip-validate");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "schema/TS roundtrip failed\nstatus={}\nstdout={stdout}\nstderr={stderr}",
        output.status
    );
    let report: Value = serde_json::from_str(stdout.trim()).unwrap_or_else(|error| {
        panic!("roundtrip report JSON: {error}\n{stdout}");
    });
    assert_eq!(report["mismatch"], 0, "schema vs TS mismatch: {report}");
    assert!(report["total"].as_u64().unwrap_or(0) >= lines.len() as u64);
    let _ = fs::remove_file(tmp);
}

const REQUIRED_INVALID_TYPES: &[&str] = &[
    "invalid/message",
    "invalid/kind",
    "request/hello",
    "request/capabilities",
    "request/execute",
    "request/cancel",
    "request/status",
    "request/resume",
    "request/ack",
    "request/module_call",
    "event",
    "response",
    "error",
];

#[test]
fn invalid_messages_rejected_by_ajv_ts_and_rust() {
    let fixture = repo_root().join("crates/pilotdeck-agent-loop/fixtures/invalid-messages.json");
    let parsed: Value = serde_json::from_str(&fs::read_to_string(&fixture).unwrap()).unwrap();
    let samples = parsed["samples"].as_array().expect("samples array");
    assert!(samples.len() >= REQUIRED_INVALID_TYPES.len());

    let mut seen = std::collections::BTreeSet::new();
    let mut rust_decisions = Vec::new();
    for sample in samples {
        let id = sample["id"].as_str().expect("sample.id");
        let message_type = sample["messageType"].as_str().expect("sample.messageType");
        seen.insert(message_type.to_string());
        let raw = sample["raw"].as_str().expect("sample.raw");
        let value: Value = serde_json::from_str(raw).unwrap_or_else(|error| {
            panic!("invalid fixture {id} is not JSON: {error}");
        });
        let validation = pilotdeck_agent_loop::validate_module_message(&value);
        assert!(
            !validation.is_ok(),
            "Rust validator must reject {id} ({message_type})"
        );
        rust_decisions.push(json!({
            "id": id,
            "ok": false,
            "code": validation.code(),
        }));
    }
    for required in REQUIRED_INVALID_TYPES {
        assert!(
            seen.contains(*required),
            "invalid fixture missing message type {required}; have {seen:?}"
        );
    }
    assert!(
        samples
            .iter()
            .any(|sample| sample["id"] == "execute-attemptId"),
        "must include execute attemptId reject"
    );
    assert!(
        samples
            .iter()
            .any(|sample| sample["id"] == "execute-stepId"),
        "must include execute stepId reject"
    );

    let rust_path = tempfile_path();
    fs::write(
        &rust_path,
        serde_json::to_string_pretty(&json!({
            "validator": "validate_module_message",
            "decisions": rust_decisions,
        }))
        .unwrap(),
    )
    .unwrap();

    let script = repo_root().join("crates/pilotdeck-agent-loop/scripts/roundtrip-validate.mjs");
    let output = Command::new("node")
        .arg(&script)
        .arg("--messages")
        .arg(&fixture)
        .arg("--expect")
        .arg("reject")
        .arg("--rust-decisions")
        .arg(&rust_path)
        .current_dir(repo_root())
        .output()
        .expect("node invalid roundtrip");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "ajv/TS/Rust reject corpus failed\nstatus={}\nstdout={stdout}\nstderr={stderr}",
        output.status
    );
    let report: Value = serde_json::from_str(stdout.trim()).unwrap_or_else(|error| {
        panic!("invalid roundtrip report JSON: {error}\n{stdout}");
    });
    assert_eq!(report["mismatch"], 0, "three-way mismatch: {report}");
    assert_eq!(
        report["expectViolations"], 0,
        "an oracle accepted a negative: {report}"
    );
    assert_eq!(report["tsAccept"], 0);
    assert_eq!(report["schemaAccept"], 0);
    assert_eq!(report["rustAccept"], 0);
    let _ = fs::remove_file(rust_path);
}

fn count_kinds(lines: &[Value]) -> std::collections::BTreeMap<String, usize> {
    let mut map = std::collections::BTreeMap::new();
    for message in lines {
        let kind = message
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        *map.entry(kind.to_string()).or_insert(0) += 1;
    }
    map
}

fn tempfile_path() -> std::path::PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "pilotdeck-agent-loop-roundtrip-{}-{}.json",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    path
}
