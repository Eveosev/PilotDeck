//! S3 / B3: R2-2 seven serde risk cases from T-P0a-01.
//!
//! Expectation = TS `JSON.parse` + `validateModuleMessage`.
//! Each case records TS vs Rust; divergences are asserted and documented.

mod common;

use common::repo_root;
use pilotdeck_agent_loop::protocol::parse_json_line;
use pilotdeck_agent_loop::validate_module_message;
use serde_json::Value;
use std::process::Command;

const EVENT_SEQ: &str = r#"{"kind":"event","eventType":"model.delta","streamId":"stream-1","sequence":TOKEN,"runId":"run-1","operationId":"operation-1","requestId":"request-1","final":false,"payload":{}}"#;

fn event(token: &str) -> String {
    EVENT_SEQ.replace("TOKEN", token)
}

fn ts_oracle(raw: &str) -> Value {
    let script = repo_root().join("crates/pilotdeck-agent-loop/scripts/serde-ts-oracle.mjs");
    let output = Command::new("node")
        .arg(&script)
        .arg("--raw")
        .arg(raw)
        .current_dir(repo_root())
        .output()
        .expect("node serde-ts-oracle");
    assert!(
        output.status.success(),
        "ts oracle failed\nstdout={}\nstderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_str(String::from_utf8_lossy(&output.stdout).trim()).expect("oracle JSON")
}

fn rust_parse(raw: &str) -> Result<Value, String> {
    parse_json_line(raw).map_err(|error| error.to_string())
}

fn rust_ok(raw: &str) -> Option<bool> {
    rust_parse(raw)
        .ok()
        .map(|value| validate_module_message(&value).is_ok())
}

#[test]
fn s3_sequence_1_0_accepts_like_ts() {
    let raw = event("1.0");
    let ts = ts_oracle(&raw);
    let rust = rust_parse(&raw).expect("serde_json must parse 1.0");
    assert_eq!(ts["parseOk"], true);
    assert_eq!(ts["tsOk"], true);
    assert_eq!(ts["schemaOk"], true);
    assert_eq!(ts["jsAfterNumberParse"], 1);
    assert!(validate_module_message(&rust).is_ok());
    assert_eq!(
        rust["sequence"]
            .as_u64()
            .or_else(|| rust["sequence"].as_f64().map(|f| f as u64)),
        Some(1)
    );
}

#[test]
fn s3_sequence_negative_zero_accepts_like_ts() {
    let raw = event("-0");
    let ts = ts_oracle(&raw);
    let rust = rust_parse(&raw).expect("serde_json must parse -0");
    assert_eq!(ts["parseOk"], true);
    assert_eq!(ts["tsOk"], true);
    assert_eq!(ts["objectIsNegativeZero"], true);
    assert_eq!(ts["isInteger"], true);
    assert!(validate_module_message(&rust).is_ok());
    let number = rust["sequence"]
        .as_i64()
        .or_else(|| rust["sequence"].as_f64().map(|f| f as i64));
    assert_eq!(number, Some(0));
}

#[test]
fn s3_sequence_exponents_accept_like_ts() {
    for (token, expected) in [("1e2", 100u64), ("1E0", 1), ("100e-2", 1)] {
        let raw = event(token);
        let ts = ts_oracle(&raw);
        let rust = rust_parse(&raw).unwrap_or_else(|error| panic!("{token}: {error}"));
        assert_eq!(ts["tsOk"], true, "{token} ts={ts}");
        assert_eq!(ts["schemaOk"], true, "{token}");
        assert_eq!(ts["jsAfterNumberParse"], expected, "{token}");
        assert!(
            validate_module_message(&rust).is_ok(),
            "{token} rust={rust}"
        );
        let got = rust["sequence"]
            .as_u64()
            .or_else(|| rust["sequence"].as_f64().map(|f| f as u64));
        assert_eq!(got, Some(expected), "{token}");
    }
}

#[test]
fn s3_sequence_above_2_pow_53_accepts_with_documented_precision_split() {
    let raw = event("9007199254740993");
    let ts = ts_oracle(&raw);
    let rust = rust_parse(&raw).expect(">2^53 must parse");
    assert_eq!(ts["parseOk"], true);
    assert_eq!(ts["tsOk"], true);
    assert_eq!(ts["schemaOk"], true);
    // JSON.parse loses the low bit; serde_json keeps the exact integer.
    assert_eq!(ts["jsAfterNumberParse"], 9_007_199_254_740_992u64);
    let rust_int = rust["sequence"]
        .as_u64()
        .or_else(|| rust["sequence"].as_i64().map(|n| n as u64))
        .expect("rust keeps an integer");
    assert_eq!(rust_int, 9_007_199_254_740_993);
    assert!(validate_module_message(&rust).is_ok());
    assert_ne!(
        ts["jsAfterNumberParse"].as_u64(),
        Some(rust_int),
        "divergence must stay visible: JS rounded, Rust exact"
    );
}

#[test]
fn s3_sequence_1e400_both_reject_via_different_paths() {
    let raw = event("1e400");
    let ts = ts_oracle(&raw);
    let rust = rust_parse(&raw);
    assert_eq!(
        ts["parseOk"], true,
        "JSON.parse('1e400') is Infinity, not a throw"
    );
    assert_eq!(ts["jsAfterNumberParse"], "Infinity");
    assert_eq!(ts["tsOk"], false);
    assert_eq!(ts["schemaOk"], false);
    assert!(
        rust.is_err(),
        "serde_json must error on 1e400 instead of becoming Infinity; got {rust:?}"
    );
    // Accept/reject aligned (both reject). Path differs: TS validate vs Rust parse.
    assert_eq!(rust_ok(&raw), None);
}

#[test]
fn s3_duplicate_keys_last_wins_like_json_parse() {
    let raw = r#"{"kind":"request","messageId":"m","method":"execute","runId":"run-1","operationId":"op-1","requestId":"first","payload":{"prompt":"A"},"requestId":"second","payload":{"prompt":"B","scenario":"pure_text"}}"#;
    let ts = ts_oracle(raw);
    let rust = rust_parse(raw).expect("duplicate keys must parse as Value");
    assert_eq!(ts["parseOk"], true);
    assert_eq!(ts["tsOk"], true);
    assert_eq!(ts["schemaOk"], true);
    assert_eq!(rust["requestId"], "second");
    assert_eq!(rust["payload"]["prompt"], "B");
    assert_eq!(ts["jsAfterJSONParse"]["requestId"], "second");
    assert_eq!(ts["jsAfterJSONParse"]["payload"]["prompt"], "B");
    assert!(validate_module_message(&rust).is_ok());
}

#[test]
fn s3_ajv_strict_agrees_with_ts_and_rust() {
    let accept = event("1.0");
    let reject = r#"{"kind":"event","eventType":"model.delta","streamId":"stream-1","sequence":1e400,"runId":"run-1","operationId":"operation-1","requestId":"request-1","final":false,"payload":{}}"#;
    let accept_ts = ts_oracle(&accept);
    let reject_ts = ts_oracle(reject);
    assert_eq!(accept_ts["ajvStrict"], true);
    assert_eq!(accept_ts["schemaOk"], true);
    assert_eq!(accept_ts["tsOk"], true);
    assert!(validate_module_message(&rust_parse(&accept).unwrap()).is_ok());
    assert_eq!(reject_ts["ajvStrict"], true);
    assert_eq!(reject_ts["schemaOk"], false);
    assert_eq!(reject_ts["tsOk"], false);
    assert!(rust_parse(reject).is_err());

    let script = repo_root().join("crates/pilotdeck-agent-loop/scripts/roundtrip-validate.mjs");
    let fixture = repo_root().join("evidence/schema/fixtures/edge-samples.json");
    let output = Command::new("node")
        .arg(&script)
        .arg("--messages")
        .arg(&fixture)
        .current_dir(repo_root())
        .output()
        .expect("node roundtrip-validate edge-samples");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "ajv/TS edge-samples failed\n{stdout}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_str(stdout.trim()).unwrap();
    assert_eq!(report["ajvStrict"], true);
    assert_eq!(report["mismatch"], 0, "{report}");
}
