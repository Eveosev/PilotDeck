//! T-P2-01: one stdio turn through the production host model runtime.
//! Keys are stripped so CI stays on the in-process fetch fixture.
//! A live provider is the same script with `PILOTDECK_REAL_MODEL` set; see
//! `scripts/real-model-e2e.mjs`.

mod common;

use serde_json::Value;
use std::process::Command;

#[test]
fn real_model_stdio_fixture_returns_completed() {
    let script = common::repo_root().join("crates/pilotdeck-agent-loop/scripts/real-model-e2e.mjs");
    let bin = env!("CARGO_BIN_EXE_pilotdeck-agent-loop");
    let output = Command::new("node")
        .arg(&script)
        .arg("--bin")
        .arg(bin)
        .current_dir(common::repo_root())
        .env_remove("OPENAI_API_KEY")
        .env_remove("ANTHROPIC_API_KEY")
        .env_remove("GEMINI_API_KEY")
        .env_remove("GOOGLE_API_KEY")
        .env_remove("OPENROUTER_API_KEY")
        .env_remove("PILOTDECK_REAL_MODEL")
        .env_remove("PILOTDECK_REAL_MODEL_PROVIDER")
        .env_remove("PILOTDECK_REAL_MODEL_BASE_URL")
        .env_remove("PILOTDECK_MODEL")
        .env_remove("PILOTDECK_PROVIDER")
        .output()
        .expect("node real-model-e2e");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "real-model fixture path failed\nstatus={}\nstdout={stdout}\nstderr={stderr}",
        output.status
    );
    let report: Value = serde_json::from_str(stdout.trim()).unwrap_or_else(|error| {
        panic!("real-model report JSON: {error}\n{stdout}\n{stderr}");
    });
    assert_eq!(report["ok"], true, "{report}");
    assert_eq!(report["task"], "T-P2-01");
    assert_eq!(report["transport"], "stdio");
    assert_eq!(report["outcome"], "completed");
    assert_eq!(report["mockModelMs"], false);
    assert_eq!(report["credential"], "absent");
    assert_eq!(report["provider"], "openai");
    assert_eq!(report["model"], "p2-fixture");
    assert_eq!(report["protocol"], "openai");
    assert_eq!(report["assistantText"], "pong");
    assert!(report["prepareCount"].as_u64().unwrap_or(0) >= 1);
    assert!(report["streamNextCount"].as_u64().unwrap_or(0) >= 1);
}
