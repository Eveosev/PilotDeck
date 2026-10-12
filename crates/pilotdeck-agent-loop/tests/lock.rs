//! Lock tests for T-P1-01 PR-A. These fail on base `1da663a2` because the
//! `pilotdeck-agent-loop` package is not a workspace member there.

use std::fs;
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    dir.pop();
    dir.pop();
    dir
}

#[test]
fn workspace_lists_pilotdeck_agent_loop_crate() {
    let manifest = fs::read_to_string(repo_root().join("Cargo.toml")).expect("root Cargo.toml");
    assert!(
        manifest.contains("\"crates/pilotdeck-agent-loop\""),
        "root workspace must list crates/pilotdeck-agent-loop (S0 crate skeleton)"
    );
    assert!(
        manifest.contains("crates/pilotdeck-agent-loop-hello"),
        "hello crate membership must stay (Desktop smoke)"
    );
    assert!(
        repo_root()
            .join("crates/pilotdeck-agent-loop/src/lib.rs")
            .is_file(),
        "new crate lib.rs must exist"
    );
}

#[test]
fn crate_exports_validate_module_message_and_stdio_bin() {
    assert!(
        pilotdeck_agent_loop::validate_module_message(&serde_json::json!({
            "kind": "request",
            "messageId": "hello-lock",
            "method": "hello",
            "payload": {}
        }))
        .is_ok()
    );
    let bin = env!("CARGO_BIN_EXE_pilotdeck-agent-loop");
    assert!(
        std::path::Path::new(bin).is_file(),
        "workspace must build bin pilotdeck-agent-loop: {bin}"
    );
}

#[test]
fn execute_is_in_scope_unlike_hello_crate() {
    // On base 1da663a2 only hello exists and rejects execute with METHOD_UNSUPPORTED.
    // This crate must accept a valid execute request at the validator and advertise it.
    let request = serde_json::json!({
        "kind": "request",
        "messageId": "lock-execute",
        "method": "execute",
        "runId": "run-lock",
        "operationId": "op-lock",
        "requestId": "req-lock",
        "payload": { "scenario": "pure_text" }
    });
    assert!(pilotdeck_agent_loop::validate_module_message(&request).is_ok());
    assert_eq!(pilotdeck_agent_loop::MODULE_ID, "pilotdeck-agent-loop");
}
