//! G5 / G-MC: real-client-shaped execute over `--listen`, with a non-empty
//! tool manifest. The host mock backend — not the crate — picks pure_text vs
//! single_tool. Sidecar must originate `module_call`; host trace records
//! `model.*` and `tool.*` channels.

mod common;

use common::{client_execute_payload, spawn_sidecar_tcp};
use serde_json::{json, Value};
use std::time::Duration;

const FAST: Duration = Duration::from_secs(3);

fn execute_request(message_id: &str, run_id: &str, operation_id: &str, request_id: &str, user_text: &str) -> Value {
    json!({
        "kind": "request",
        "messageId": message_id,
        "method": "execute",
        "runId": run_id,
        "operationId": operation_id,
        "requestId": request_id,
        "sessionId": format!("sess-{run_id}"),
        "turnId": format!("turn-{operation_id}"),
        "payload": client_execute_payload(user_text),
    })
}

#[test]
fn g5_tcp_listen_real_client_payload_reaches_pure_text_and_single_tool() {
    let mut sidecar = spawn_sidecar_tcp();
    assert_eq!(sidecar.transport, "tcp");

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
    let _ = sidecar.wait_for(
        |msgs| msgs.iter().any(|m| m.get("inReplyTo") == Some(&json!("caps-1"))),
        FAST,
    );

    sidecar.send_json(&execute_request(
        "ex-text",
        "run-text",
        "op-text",
        "req-text",
        "What is the status?",
    ));
    let text_lines = sidecar.wait_for(
        |msgs| {
            msgs.iter().any(|m| {
                m.get("eventType") == Some(&json!("agent.execute.completed"))
                    && m.get("requestId") == Some(&json!("req-text"))
            })
        },
        FAST,
    );
    let text_ops: Vec<_> = text_lines
        .iter()
        .filter(|m| {
            m.get("kind") == Some(&json!("request"))
                && m.get("method") == Some(&json!("module_call"))
                && m.get("requestId") == Some(&json!("req-text"))
        })
        .map(|m| {
            (
                m.get("module").and_then(Value::as_str).unwrap_or(""),
                m.pointer("/payload/operation")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
            )
        })
        .collect();
    assert_eq!(
        text_ops,
        [
            ("model", "prepare"),
            ("model", "stream"),
            ("model", "close_stream")
        ]
    );
    assert!(
        text_lines.iter().any(|m| {
            m.get("kind") == Some(&json!("request"))
                && m.get("method") == Some(&json!("module_call"))
                && m.get("module") == Some(&json!("model"))
                && m.pointer("/payload/operation") == Some(&json!("prepare"))
                && m.pointer("/payload/preparationId")
                    .and_then(Value::as_str)
                    .is_some_and(|id| !id.is_empty())
                && m.get("requestId") == Some(&json!("req-text"))
        }),
        "sidecar must send model prepare with preparationId: {text_lines:?}"
    );
    assert!(
        text_lines.iter().all(|m| {
            m.get("eventType").and_then(Value::as_str) != Some("agent.tool_calls_detected")
                || m.get("requestId") != Some(&json!("req-text"))
        }),
        "pure_text must not emit tool events: {text_lines:?}"
    );
    let text_message = text_lines
        .iter()
        .find(|m| m.get("eventType") == Some(&json!("agent.assistant_message")))
        .expect("pure_text agent.assistant_message");
    assert_eq!(
        text_message["payload"]["message"]["content"][0]["text"],
        "HOST[What is the status?]"
    );
    assert!(text_message["payload"]["message"]["content"].is_array());
    let text_terminal = text_lines
        .iter()
        .find(|m| m.get("eventType") == Some(&json!("agent.execute.completed")))
        .expect("pure_text completed");
    assert!(text_terminal["payload"]["messages"][0]["content"].is_array());
    assert_eq!(
        text_terminal["payload"]["messages"][0]["content"][0]["type"],
        "text"
    );

    sidecar.send_json(&execute_request(
        "ex-tool",
        "run-tool",
        "op-tool",
        "req-tool",
        "Look up the status",
    ));
    let all = sidecar.wait_for(
        |msgs| {
            msgs.iter().any(|m| {
                m.get("eventType") == Some(&json!("agent.execute.completed"))
                    && m.get("requestId") == Some(&json!("req-tool"))
            })
        },
        FAST,
    );
    let tool_calls: Vec<_> = all
        .iter()
        .filter(|m| {
            m.get("kind") == Some(&json!("request"))
                && m.get("method") == Some(&json!("module_call"))
                && m.get("requestId") == Some(&json!("req-tool"))
        })
        .collect();
    assert_eq!(
        tool_calls
            .iter()
            .map(|m| (
                m.get("module").and_then(Value::as_str).unwrap_or(""),
                m.pointer("/payload/operation")
                    .and_then(Value::as_str)
                    .unwrap_or("")
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
    assert!(all.iter().any(|m| {
        m.get("eventType") == Some(&json!("agent.tool_calls_detected"))
            && m.get("requestId") == Some(&json!("req-tool"))
    }));
    assert!(all.iter().any(|m| {
        m.get("eventType") == Some(&json!("agent.tool_result"))
            && m.get("requestId") == Some(&json!("req-tool"))
    }));
    let assistant = all
        .iter()
        .find(|m| {
            m.get("eventType") == Some(&json!("agent.assistant_message"))
                && m.get("requestId") == Some(&json!("req-tool"))
        })
        .expect("single_tool assistant_message");
    assert_eq!(
        assistant["payload"]["message"]["content"][0]["text"],
        "HOST[Look up the status]"
    );

    let channels: Vec<_> = sidecar
        .host_trace
        .iter()
        .filter_map(|row| row.get("channel").and_then(Value::as_str))
        .collect();
    assert!(
        channels.iter().any(|c| c.starts_with("model.")),
        "G-MC host trace must include model.*: {channels:?}"
    );
    assert!(
        channels.iter().any(|c| c.starts_with("tool.")),
        "G-MC host trace must include tool.*: {channels:?}"
    );
    assert!(channels.contains(&"model.request"));
    assert!(channels.contains(&"model.response"));
    assert!(channels.contains(&"tool.call"));
    assert!(channels.contains(&"tool.result"));

    let text_payload = client_execute_payload("What is the status?");
    let tool_payload = client_execute_payload("Look up the status");
    assert_eq!(text_payload["tools"], tool_payload["tools"]);
    assert!(
        text_payload["tools"]
            .as_array()
            .is_some_and(|tools| !tools.is_empty()),
        "manifest must stay non-empty"
    );
    let _ = sidecar.close();
}
