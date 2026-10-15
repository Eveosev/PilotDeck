mod common;

use common::{spawn_sidecar, suite};

#[test]
fn s0_hello_capabilities_and_invalid_input() {
    let mut sidecar = spawn_sidecar();
    suite::s0_hello_capabilities_and_invalid_input(&mut sidecar);
    let _ = sidecar.close();
}

#[test]
fn s1_execute_pure_text_events_and_final_outcome() {
    let mut sidecar = spawn_sidecar();
    suite::s1_execute_pure_text_events_and_final_outcome(&mut sidecar);
    let _ = sidecar.close();
}

#[test]
fn s1_execute_rejects_forbidden_fields() {
    let mut sidecar = spawn_sidecar();
    suite::s1_execute_rejects_forbidden_fields(&mut sidecar);
    let _ = sidecar.close();
}

#[test]
fn s1_execute_rejects_step_id() {
    let mut sidecar = spawn_sidecar();
    suite::s1_execute_rejects_step_id(&mut sidecar);
    let _ = sidecar.close();
}

#[test]
fn s0_non_utf8_line_is_invalid_json_and_keeps_serving() {
    let mut sidecar = spawn_sidecar();
    suite::s0_non_utf8_line_is_invalid_json_and_keeps_serving(&mut sidecar);
    let _ = sidecar.close();
}

#[test]
fn s2_cancel_status_and_explicit_resume_ack_reject() {
    let mut sidecar = spawn_sidecar();
    suite::s2_cancel_status_and_explicit_resume_ack_reject(&mut sidecar);
    let _ = sidecar.close();
}

#[test]
fn g5_stdio_real_client_payload_reaches_pure_text_and_single_tool() {
    let mut sidecar = spawn_sidecar();
    assert_eq!(sidecar.transport, "stdio");
    suite::g5_real_client_payload(&mut sidecar);
    let _ = sidecar.close();
}

#[test]
fn ts_host_b4_dialogue_over_stdio() {
    let script = common::repo_root().join("crates/pilotdeck-agent-loop/scripts/b4-tcp-host.mjs");
    let bin = env!("CARGO_BIN_EXE_pilotdeck-agent-loop");
    let output = std::process::Command::new("node")
        .arg(&script)
        .arg("--transport")
        .arg("stdio")
        .arg("--bin")
        .arg(bin)
        .current_dir(common::repo_root())
        .output()
        .expect("node b4 stdio host");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "TS host B4 over stdio failed\nstatus={}\nstdout={stdout}\nstderr={stderr}",
        output.status
    );
    let report: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap_or_else(|error| {
        panic!("b4 stdio report JSON: {error}\n{stdout}");
    });
    assert_eq!(report["ok"], true, "{report}");
    assert_eq!(report["transport"], "stdio", "{report}");
    assert_eq!(report["mismatch"], 0, "{report}");
    assert_eq!(report["cancelOk"], true, "{report}");
    assert_eq!(report["statusAfterCancel"], "cancelled", "{report}");
    assert_eq!(report["abortedType"], "aborted", "{report}");
}
