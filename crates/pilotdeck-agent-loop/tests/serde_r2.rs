//! S3 / B3: R2-2 seven serde risk cases from T-P0a-01 / T-P1-03-FU-A.
//!
//! Expectation = TS `JSON.parse` + `validateModuleMessage`.
//! Each case records TS vs Rust; divergences are listed and decided
//! explicitly (never silent). B3(a) `preserve_order` is covered by
//! `sidecar::model_tool_schema_keeps_input_schema_key_order` and must
//! not regress.

mod common;

use common::repo_root;
use pilotdeck_agent_loop::protocol::parse_json_line;
use pilotdeck_agent_loop::validate_module_message;
use serde_json::{json, Value};
use std::fs;
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
    // Derive-heavy execute payload (agent / messages / tools / hostModules).
    // Raw input is parse_json_line → Value first; never a derive Deserialize.
    let raw = r#"{"kind":"request","messageId":"m","method":"execute","runId":"run-1","operationId":"op-1","sessionId":"sess-1","turnId":"turn-1","requestId":"first","payload":{"prompt":"A","agent":{"id":"first-agent"},"tools":[]},"requestId":"second","payload":{"prompt":"B","scenario":"pure_text","agent":{"id":"pilotdeck-stub","provider":"pilotdeck-stub","model":"pilotdeck-stub"},"messages":[{"role":"user","content":[{"type":"text","text":"B"}]}],"tools":[{"name":"lookup","description":"Look up","inputSchema":{"type":"object","properties":{"q":{"type":"string"}}}}],"hostModules":{"model":true,"capability":true}}}"#;
    let ts = ts_oracle(raw);
    let rust = rust_parse(raw).expect("duplicate keys must parse as Value");
    assert_eq!(ts["parseOk"], true);
    assert_eq!(ts["tsOk"], true);
    assert_eq!(ts["schemaOk"], true);
    assert_eq!(rust["requestId"], "second");
    assert_eq!(rust["payload"]["prompt"], "B");
    assert_eq!(rust["payload"]["agent"]["id"], "pilotdeck-stub");
    assert_eq!(rust["payload"]["tools"][0]["name"], "lookup");
    assert_eq!(ts["jsAfterJSONParse"]["requestId"], "second");
    assert_eq!(ts["jsAfterJSONParse"]["payload"]["prompt"], "B");
    assert_eq!(ts["jsAfterJSONParse"]["payload"]["agent"]["id"], "pilotdeck-stub");
    assert!(validate_module_message(&rust).is_ok());
}

#[test]
fn s3_wire_input_is_value_first_not_derive() {
    let protocol = include_str!("../src/protocol.rs");
    assert!(
        protocol.contains("serde_json::from_str::<Value>"),
        "wire parse must go through serde_json::Value"
    );
    let crate_root = repo_root().join("crates/pilotdeck-agent-loop/src");
    for name in ["protocol.rs", "sidecar.rs", "stdio.rs", "tcp.rs", "lib.rs"] {
        let text = fs::read_to_string(crate_root.join(name)).expect(name);
        assert!(
            !text.contains("Deserialize"),
            "{name} must not derive-deserialize wire frames"
        );
    }
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

/// Explicit TS vs Rust decisions for the seven B3 cases. Never silent.
#[test]
fn s3_seven_cases_record_explicit_decisions() {
    let cases = b3_comparison_table();
    assert_eq!(cases.as_array().map(Vec::len), Some(7), "{cases}");
    for case in cases.as_array().unwrap() {
        assert!(case["id"].as_str().is_some(), "{case}");
        assert!(case["decision"].as_str().is_some(), "{case}");
        assert!(case.get("ts").is_some(), "{case}");
        assert!(case.get("rust").is_some(), "{case}");
        assert!(
            case["decision"] == "aligned"
                || case["decision"] == "documented-divergence",
            "silent divergence is not allowed: {case}"
        );
        if case["decision"] == "documented-divergence" {
            assert!(
                case["divergence"]
                    .as_str()
                    .is_some_and(|text| !text.is_empty()),
                "{case}"
            );
        }
    }
    if let Ok(path) = std::env::var("T_P1_FU_B3_OUT") {
        if !path.is_empty() {
            fs::write(&path, serde_json::to_string_pretty(&cases).unwrap() + "\n")
                .unwrap_or_else(|error| panic!("write {path}: {error}"));
        }
    }
}

fn b3_comparison_table() -> Value {
    let one = event("1.0");
    let neg = event("-0");
    let exp = [
        ("1e2", event("1e2"), 100u64),
        ("1E0", event("1E0"), 1),
        ("100e-2", event("100e-2"), 1),
    ];
    let big = event("9007199254740993");
    let overflow = event("1e400");
    let dup = r#"{"kind":"request","messageId":"m","method":"execute","runId":"run-1","operationId":"op-1","sessionId":"sess-1","turnId":"turn-1","requestId":"first","payload":{"prompt":"A"},"requestId":"second","payload":{"prompt":"B","scenario":"pure_text","agent":{"id":"pilotdeck-stub"},"tools":[{"name":"lookup"}]}}"#;

    let one_ts = ts_oracle(&one);
    let one_rust = rust_parse(&one).expect("1.0");
    let neg_ts = ts_oracle(&neg);
    let neg_rust = rust_parse(&neg).expect("-0");
    let big_ts = ts_oracle(&big);
    let big_rust = rust_parse(&big).expect(">2^53");
    let overflow_ts = ts_oracle(&overflow);
    let overflow_rust = rust_parse(&overflow);
    let dup_ts = ts_oracle(dup);
    let dup_rust = rust_parse(dup).expect("dup");

    json!([
        {
            "id": "1.0",
            "ts": { "parseOk": one_ts["parseOk"], "tsOk": one_ts["tsOk"], "js": one_ts["jsAfterNumberParse"] },
            "rust": { "parseOk": true, "ok": validate_module_message(&one_rust).is_ok(), "value": 1 },
            "decision": "aligned",
            "divergence": ""
        },
        {
            "id": "-0",
            "ts": { "parseOk": true, "tsOk": neg_ts["tsOk"], "objectIsNegativeZero": neg_ts["objectIsNegativeZero"] },
            "rust": { "parseOk": true, "ok": validate_module_message(&neg_rust).is_ok(), "i64": 0 },
            "decision": "documented-divergence",
            "divergence": "TS Object.is(-0,-0); Rust i64 0. Accept/reject aligned; sign not a distinct Number."
        },
        {
            "id": "scientific",
            "tokens": ["1e2", "1E0", "100e-2"],
            "ts": exp.iter().map(|(token, raw, expected)| {
                let ts = ts_oracle(raw);
                json!({ "token": token, "tsOk": ts["tsOk"], "js": ts["jsAfterNumberParse"], "expected": expected })
            }).collect::<Vec<_>>(),
            "rust": exp.iter().map(|(token, raw, expected)| {
                let rust = rust_parse(raw).unwrap();
                json!({ "token": token, "ok": validate_module_message(&rust).is_ok(), "value": expected })
            }).collect::<Vec<_>>(),
            "decision": "aligned",
            "divergence": ""
        },
        {
            "id": ">2^53",
            "ts": { "parseOk": true, "tsOk": big_ts["tsOk"], "js": big_ts["jsAfterNumberParse"] },
            "rust": { "parseOk": true, "ok": validate_module_message(&big_rust).is_ok(), "u64": 9_007_199_254_740_993u64 },
            "decision": "documented-divergence",
            "divergence": "JSON.parse rounds 9007199254740993 to 9007199254740992; serde_json keeps the exact integer. Accept/reject aligned."
        },
        {
            "id": "1e400",
            "ts": { "parseOk": overflow_ts["parseOk"], "js": overflow_ts["jsAfterNumberParse"], "tsOk": overflow_ts["tsOk"] },
            "rust": { "parseOk": overflow_rust.is_ok(), "parseError": overflow_rust.is_err(), "ok": false },
            "decision": "documented-divergence",
            "divergence": "TS JSON.parse → Infinity then validate reject; Rust serde_json parse error (no Infinity). Both reject; path differs."
        },
        {
            "id": "duplicate-key-last-wins",
            "ts": { "parseOk": true, "tsOk": dup_ts["tsOk"], "requestId": dup_ts["jsAfterJSONParse"]["requestId"], "prompt": dup_ts["jsAfterJSONParse"]["payload"]["prompt"] },
            "rust": { "parseOk": true, "ok": validate_module_message(&dup_rust).is_ok(), "requestId": dup_rust["requestId"], "prompt": dup_rust["payload"]["prompt"] },
            "decision": "aligned",
            "divergence": ""
        },
        {
            "id": "ajv-strict",
            "ts": { "ajvStrict": true, "accept": true, "reject1e400": true },
            "rust": { "accept": true, "reject1e400": true },
            "decision": "aligned",
            "divergence": ""
        }
    ])
}
