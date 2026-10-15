//! S4: the same B1 / B4 suite as stdio, over `--listen 127.0.0.1:0`.
//! This is not a hello→execute→status-only smoke: cancel/status/resume/ack
//! and malformed frames are included.

mod common;

use common::{repo_root, spawn_sidecar_tcp, suite};
use serde_json::Value;
use std::process::Command;

#[test]
fn s0_hello_capabilities_and_invalid_input() {
    let mut sidecar = spawn_sidecar_tcp();
    assert_eq!(sidecar.transport, "tcp");
    suite::s0_hello_capabilities_and_invalid_input(&mut sidecar);
    let _ = sidecar.close();
}

#[test]
fn s1_execute_pure_text_events_and_final_outcome() {
    let mut sidecar = spawn_sidecar_tcp();
    suite::s1_execute_pure_text_events_and_final_outcome(&mut sidecar);
    let _ = sidecar.close();
}

#[test]
fn s1_execute_rejects_forbidden_fields() {
    let mut sidecar = spawn_sidecar_tcp();
    suite::s1_execute_rejects_forbidden_fields(&mut sidecar);
    let _ = sidecar.close();
}

#[test]
fn s1_execute_rejects_step_id() {
    let mut sidecar = spawn_sidecar_tcp();
    suite::s1_execute_rejects_step_id(&mut sidecar);
    let _ = sidecar.close();
}

#[test]
fn s0_non_utf8_line_is_invalid_json_and_keeps_serving() {
    let mut sidecar = spawn_sidecar_tcp();
    suite::s0_non_utf8_line_is_invalid_json_and_keeps_serving(&mut sidecar);
    let _ = sidecar.close();
}

#[test]
fn s2_cancel_status_and_explicit_resume_ack_reject() {
    let mut sidecar = spawn_sidecar_tcp();
    suite::s2_cancel_status_and_explicit_resume_ack_reject(&mut sidecar);
    let _ = sidecar.close();
}

#[test]
fn tcp_auth_token_rejects_anonymous_hello() {
    let bin = env!("CARGO_BIN_EXE_pilotdeck-agent-loop");
    let mut child = Command::new(bin)
        .arg("--listen")
        .arg("127.0.0.1:0")
        .env("PILOTDECK_AGENT_LOOP_TCP_TOKEN", "production-token")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn authed sidecar");
    let stderr = child.stderr.take().expect("stderr");
    let addr = common::wait_listen_addr(stderr);
    let mut stream = std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(2))
        .expect("connect");
    stream.set_nodelay(true).expect("nodelay");
    use std::io::{BufRead, BufReader, Write};
    let mut reader = BufReader::new(stream.try_clone().expect("clone"));
    writeln!(
        stream,
        r#"{{"kind":"request","messageId":"hello-bad","method":"hello","payload":{{}}}}"#
    )
    .expect("write");
    stream.flush().expect("flush");
    let mut line = String::new();
    reader.read_line(&mut line).expect("read");
    let rejected: Value = serde_json::from_str(line.trim()).expect("json");
    assert_eq!(rejected["ok"], false);
    assert_eq!(rejected["code"], "UNAUTHENTICATED");
    writeln!(
        stream,
        r#"{{"kind":"request","messageId":"hello-ok","method":"hello","payload":{{"token":"production-token"}}}}"#
    )
    .expect("write");
    stream.flush().expect("flush");
    line.clear();
    reader.read_line(&mut line).expect("read");
    let accepted: Value = serde_json::from_str(line.trim()).expect("json");
    assert_eq!(accepted["ok"], true, "{accepted}");
    assert_eq!(accepted["inReplyTo"], "hello-ok");
    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn ts_host_b4_dialogue_over_tcp() {
    let script = repo_root().join("crates/pilotdeck-agent-loop/scripts/b4-tcp-host.mjs");
    let bin = env!("CARGO_BIN_EXE_pilotdeck-agent-loop");
    let output = Command::new("node")
        .arg(&script)
        .arg("--bin")
        .arg(bin)
        .current_dir(repo_root())
        .output()
        .expect("node b4-tcp-host");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "TS host B4 over TCP failed\nstatus={}\nstdout={stdout}\nstderr={stderr}",
        output.status
    );
    let report: Value = serde_json::from_str(stdout.trim()).unwrap_or_else(|error| {
        panic!("b4-tcp-host report JSON: {error}\n{stdout}");
    });
    assert_eq!(report["ok"], true, "{report}");
    assert_eq!(report["mismatch"], 0, "{report}");
    assert_eq!(report["cancelOk"], true, "{report}");
    assert_eq!(report["statusAfterCancel"], "cancelled", "{report}");
    assert_eq!(report["abortedType"], "aborted", "{report}");
}
