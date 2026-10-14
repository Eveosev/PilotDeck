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
