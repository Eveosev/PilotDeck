//! Lock tests for T-P1-01. These fail on base `1da663a2` because the
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

#[test]
fn crate_rust_version_matches_hello_msrv() {
    let crate_manifest =
        fs::read_to_string(repo_root().join("crates/pilotdeck-agent-loop/Cargo.toml"))
            .expect("pilotdeck-agent-loop Cargo.toml");
    let hello_manifest =
        fs::read_to_string(repo_root().join("crates/pilotdeck-agent-loop-hello/Cargo.toml"))
            .expect("hello Cargo.toml");
    assert!(
        crate_manifest.contains("rust-version = \"1.83\""),
        "pilotdeck-agent-loop must declare rust-version 1.83 to match hello/MSRV"
    );
    assert!(
        hello_manifest.contains("rust-version = \"1.83\""),
        "hello crate rust-version is the MSRV baseline"
    );
}

#[test]
fn invalid_message_fixture_covers_each_protocol_type() {
    let path = repo_root().join("crates/pilotdeck-agent-loop/fixtures/invalid-messages.json");
    let parsed: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).expect("invalid fixture")).unwrap();
    let samples = parsed["samples"].as_array().expect("samples");
    let types: std::collections::BTreeSet<_> = samples
        .iter()
        .filter_map(|sample| sample["messageType"].as_str())
        .collect();
    for required in [
        "request/hello",
        "request/capabilities",
        "request/execute",
        "request/cancel",
        "request/status",
        "event",
        "response",
        "error",
        "invalid/kind",
    ] {
        assert!(types.contains(required), "missing {required} in {types:?}");
    }
}

#[test]
fn pr_b_tcp_cli_and_mask_f3_live_under_tests() {
    assert!(
        repo_root()
            .join("crates/pilotdeck-agent-loop/src/tcp.rs")
            .is_file(),
        "S4 TCP listen must exist"
    );
    assert!(
        repo_root()
            .join("crates/pilotdeck-agent-loop/tests/mask_f3.sh")
            .is_file(),
        "mask_f3.sh must live under crates/pilotdeck-agent-loop/tests/"
    );
    assert!(
        !repo_root()
            .join("review/2026-10-12-T-P1-01-rust-agent-loop/mask_f3.sh")
            .exists(),
        "review/ mask_f3.sh must be moved, not copied"
    );
    assert!(
        repo_root()
            .join("crates/pilotdeck-agent-loop/tests/serde_r2.rs")
            .is_file(),
        "S3 seven serde cases must exist"
    );
    assert!(
        repo_root()
            .join("crates/pilotdeck-agent-loop/tests/sidecar_tcp.rs")
            .is_file(),
        "S4 TCP B1/B4 suite must exist"
    );
}
