//! Shared B1 / B4 dialogue used by both stdio and TCP transports.

use super::{find_reply, SidecarProcess};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

const FAST: Duration = Duration::from_secs(2);

pub fn s0_hello_capabilities_and_invalid_input(sidecar: &mut SidecarProcess) {
    sidecar.send_json(&json!({
        "kind": "request",
        "messageId": "hello-1",
        "method": "hello",
        "payload": {}
    }));
    sidecar.send_json(&json!({
        "kind": "request",
        "messageId": "caps-1",
        "method": "capabilities",
        "payload": {}
    }));
    sidecar.send_line("{truncated");
    sidecar.send_json(&json!({ "kind": "nope", "messageId": "bad-kind" }));
    sidecar.send_json(&json!({
        "kind": "request",
        "messageId": "hello-bad",
        "method": "hello"
    }));
    let lines = sidecar.wait_for(
        |msgs| {
            msgs.iter()
                .any(|m| m.get("inReplyTo").and_then(Value::as_str) == Some("caps-1"))
                && msgs
                    .iter()
                    .filter(|m| m.get("kind").and_then(Value::as_str) == Some("error"))
                    .count()
                    >= 3
        },
        FAST,
    );
    let hello = find_reply(&lines, "hello-1");
    assert_eq!(hello["ok"], true);
    assert_eq!(hello["protocolVersion"], "2.0");
    assert_eq!(hello["moduleId"], "pilotdeck-agent-loop");
    assert!(hello["moduleInstanceId"]
        .as_str()
        .unwrap()
        .starts_with("pilotdeck-agent-loop-instance-"));
    let caps = find_reply(&lines, "caps-1");
    assert_eq!(caps["payload"]["transport"], sidecar.transport);
    assert_eq!(caps["payload"]["methods"][0]["enabled"], true);
    assert_eq!(caps["payload"]["methods"][3]["enabled"], false);
    assert!(lines.iter().any(|m| m["code"] == "INVALID_JSON"));
    assert!(lines.iter().any(|m| m["code"] == "INVALID_KIND"));
    assert!(lines
        .iter()
        .any(|m| m["code"] == "INVALID_HANDSHAKE_REQUEST"));
}

pub fn s1_execute_pure_text_events_and_final_outcome(sidecar: &mut SidecarProcess) {
    sidecar.send_json(&json!({
        "kind": "request",
        "messageId": "ex-1",
        "method": "execute",
        "runId": "run-1",
        "operationId": "op-1",
        "requestId": "req-1",
        "sessionId": "sess-1",
        "turnId": "turn-1",
        "payload": { "scenario": "pure_text", "q": "What is the status?" }
    }));
    let lines = sidecar.wait_for(
        |msgs| {
            msgs.iter().any(|m| {
                m.get("kind") == Some(&json!("event")) && m.get("final") == Some(&json!(true))
            })
        },
        FAST,
    );
    let accepted = find_reply(&lines, "ex-1");
    assert_eq!(accepted["ok"], true);
    assert_eq!(accepted.get("final"), None);
    assert_eq!(accepted.get("outcome"), None);
    assert!(accepted.get("attemptId").is_none());
    assert!(accepted.get("stepId").is_none());
    let events: Vec<_> = lines.iter().filter(|m| m["kind"] == "event").collect();
    assert!(events.len() >= 2);
    assert_eq!(events[0]["final"], false);
    assert!(events[0].get("moduleInstanceId").is_none());
    assert!(events[0].get("connectionGeneration").is_none());
    let terminal = events.iter().find(|m| m["final"] == true).unwrap();
    assert_eq!(terminal["outcome"], "completed");
    assert_eq!(terminal["payload"]["result"]["type"], "success");
    assert_eq!(terminal["payload"]["result"]["sessionId"], "sess-1");
    assert_eq!(terminal["payload"]["result"]["turnId"], "turn-1");
}

pub fn s1_execute_rejects_forbidden_fields(sidecar: &mut SidecarProcess) {
    sidecar.send_json(&json!({
        "kind": "request",
        "messageId": "ex-bad",
        "method": "execute",
        "runId": "run-1",
        "operationId": "op-1",
        "requestId": "req-1",
        "payload": {},
        "attemptId": "attempt-1"
    }));
    let lines = sidecar.wait_for(|msgs| !msgs.is_empty(), FAST);
    assert_eq!(lines[0]["kind"], "error");
    assert_eq!(lines[0]["code"], "UNSUPPORTED_FIELD");
}

pub fn s1_execute_rejects_step_id(sidecar: &mut SidecarProcess) {
    sidecar.send_json(&json!({
        "kind": "request",
        "messageId": "ex-step",
        "method": "execute",
        "runId": "run-1",
        "operationId": "op-1",
        "requestId": "req-1",
        "payload": {},
        "stepId": "step-1"
    }));
    let lines = sidecar.wait_for(|msgs| !msgs.is_empty(), FAST);
    assert_eq!(lines[0]["kind"], "error");
    assert_eq!(lines[0]["code"], "UNSUPPORTED_FIELD");
}

pub fn s0_non_utf8_line_is_invalid_json_and_keeps_serving(sidecar: &mut SidecarProcess) {
    sidecar.send_bytes(b"\xff\xfe\n");
    sidecar.send_json(&json!({
        "kind": "request",
        "messageId": "hello-utf8",
        "method": "hello",
        "payload": {}
    }));
    let lines = sidecar.wait_for(
        |msgs| {
            msgs.iter()
                .any(|m| m.get("code") == Some(&json!("INVALID_JSON")))
                && msgs
                    .iter()
                    .any(|m| m.get("inReplyTo") == Some(&json!("hello-utf8")))
        },
        FAST,
    );
    assert!(
        sidecar.is_running(),
        "sidecar must stay up after a non-UTF-8 frame"
    );
    assert!(lines.iter().any(|m| m["code"] == "INVALID_JSON"));
    assert_eq!(find_reply(&lines, "hello-utf8")["ok"], true);
}

/// Full B4: hello already implied by execute path; execute → status → cancel,
/// plus resume/ack reject. This is not a hello→execute→status-only smoke.
pub fn s2_cancel_status_and_explicit_resume_ack_reject(sidecar: &mut SidecarProcess) {
    sidecar.send_json(&json!({
        "kind": "request",
        "messageId": "ex-slow",
        "method": "execute",
        "runId": "run-c",
        "operationId": "op-c",
        "requestId": "req-c",
        "sessionId": "sess-c",
        "turnId": "turn-c",
        "payload": { "scenario": "pure_text", "delayMs": 10_000 }
    }));
    let _ = sidecar.wait_for(
        |msgs| {
            msgs.iter()
                .any(|m| m.get("inReplyTo") == Some(&json!("ex-slow")))
        },
        FAST,
    );
    sidecar.send_json(&json!({
        "kind": "request",
        "messageId": "st-run",
        "method": "status",
        "requestId": "req-c"
    }));
    std::thread::sleep(Duration::from_millis(50));
    let started = Instant::now();
    sidecar.send_json(&json!({
        "kind": "request",
        "messageId": "cancel-1",
        "method": "cancel",
        "runId": "run-c",
        "operationId": "op-c",
        "requestId": "req-c",
        "reason": "user_cancelled"
    }));
    sidecar.send_json(&json!({
        "kind": "request",
        "messageId": "resume-1",
        "method": "resume",
        "streamId": "stream-1",
        "previousBinding": { "moduleInstanceId": "i", "connectionGeneration": "c" },
        "lastAppliedSequence": -1
    }));
    sidecar.send_json(&json!({
        "kind": "request",
        "messageId": "ack-1",
        "method": "ack",
        "streamId": "stream-1",
        "lastAppliedSequence": 0
    }));
    let lines = sidecar.wait_for(
        |msgs| {
            msgs.iter().any(|m| {
                m.get("kind") == Some(&json!("event")) && m.get("final") == Some(&json!(true))
            }) && msgs
                .iter()
                .any(|m| m.get("inReplyTo") == Some(&json!("resume-1")))
                && msgs
                    .iter()
                    .any(|m| m.get("inReplyTo") == Some(&json!("ack-1")))
        },
        Duration::from_secs(3),
    );
    assert!(
        started.elapsed() <= Duration::from_secs(2),
        "cancel mid-execute must terminate within 2s, took {:?}",
        started.elapsed()
    );
    assert_eq!(find_reply(&lines, "st-run")["ok"], true);
    assert_eq!(find_reply(&lines, "cancel-1")["ok"], true);
    assert_eq!(find_reply(&lines, "cancel-1")["payload"]["cancelled"], true);
    assert_eq!(find_reply(&lines, "resume-1")["code"], "RESUME_UNSUPPORTED");
    assert_eq!(find_reply(&lines, "ack-1")["code"], "ACK_UNSUPPORTED");
    let terminal_idx = lines
        .iter()
        .position(|m| m["kind"] == "event" && m["final"] == true)
        .unwrap();
    let terminal = &lines[terminal_idx];
    assert_eq!(terminal["outcome"], "cancelled");
    assert_eq!(terminal["sequence"], 0);
    assert_eq!(terminal["payload"]["result"]["type"], "aborted");
    assert_eq!(terminal["payload"]["result"]["sessionId"], "sess-c");
    assert_eq!(terminal["payload"]["result"]["turnId"], "turn-c");
    assert!(
        lines[..terminal_idx]
            .iter()
            .all(|m| m.get("eventType") != Some(&json!("agent.message"))),
        "cancel must win before agent.message, have {:?}",
        lines
    );
    sidecar.send_json(&json!({
        "kind": "request",
        "messageId": "st-done",
        "method": "status",
        "requestId": "req-c"
    }));
    let after = sidecar.wait_for(
        |msgs| {
            msgs.iter()
                .any(|m| m.get("inReplyTo") == Some(&json!("st-done")))
        },
        FAST,
    );
    assert_eq!(
        find_reply(&after, "st-done")["payload"]["outcome"],
        "cancelled"
    );
}
