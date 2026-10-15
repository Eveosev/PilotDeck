//! TS `buildToolErrorRecovery` subset used by `createMissingToolResult`
//! (`src/agent/loop/ensureToolResultPairing.ts` + `src/tool/execution/errorRecovery.ts`).
//!
//! Only the `tool_execution_failed` path is ported: sidecar fail/timeout fill
//! always uses that code. Content text and `metadata.recovery` must match TS
//! so a downstream model sees the same recovery advice.

use serde_json::{json, Value};

const ORIGINAL_ERROR_MAX_CHARS: usize = 2_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolErrorRecoveryAdvice {
    pub summary: String,
    pub failure_class: String,
    pub next_actions: Vec<String>,
    pub avoid_retry_reason: Option<String>,
    pub salient_evidence: Vec<String>,
    pub original_error: Option<String>,
}

impl ToolErrorRecoveryAdvice {
    pub fn to_json(&self) -> Value {
        let mut advice = json!({
            "summary": self.summary,
            "failureClass": self.failure_class,
            "nextActions": self.next_actions,
            "salientEvidence": self.salient_evidence,
        });
        if let Some(reason) = &self.avoid_retry_reason {
            advice["avoidRetryReason"] = json!(reason);
        }
        if let Some(original) = &self.original_error {
            advice["originalError"] = json!(original);
        }
        advice
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolErrorRecoveryResult {
    pub message: String,
    pub advice: ToolErrorRecoveryAdvice,
}

/// TS `buildToolErrorRecovery` for sidecar-synthesized missing results.
pub fn build_tool_error_recovery(
    code: &str,
    tool_name: &str,
    message: &str,
    cwd: &str,
    permission_mode: &str,
) -> ToolErrorRecoveryResult {
    let evidence = extract_salient_evidence(message);
    let advice = ToolErrorRecoveryAdvice {
        summary: summarize_error(code, tool_name, message, &evidence),
        failure_class: classify_error(code, tool_name, message).to_string(),
        next_actions: next_actions_for(code, cwd, permission_mode),
        avoid_retry_reason: None,
        salient_evidence: evidence,
        original_error: format_original_error(message),
    };
    ToolErrorRecoveryResult {
        message: format_recovery_message(code, tool_name, &advice),
        advice,
    }
}

fn format_recovery_message(code: &str, tool_name: &str, advice: &ToolErrorRecoveryAdvice) -> String {
    let mut lines = vec![
        format!(
            "TOOL_ERROR[{code}][{tool_name}][{}]",
            advice.failure_class
        ),
        format!("Summary: {}", advice.summary),
    ];
    if !advice.salient_evidence.is_empty() {
        lines.push("Evidence:".to_string());
        for item in &advice.salient_evidence {
            lines.push(format!("- {item}"));
        }
    }
    if let Some(reason) = &advice.avoid_retry_reason {
        lines.push(format!("Do not retry unchanged: {reason}"));
    }
    if let Some(original) = &advice.original_error {
        lines.push("Original error:".to_string());
        lines.push(original.clone());
    }
    if !advice.next_actions.is_empty() {
        lines.push("Next actions:".to_string());
        for (index, action) in advice.next_actions.iter().enumerate() {
            lines.push(format!("{}. {action}", index + 1));
        }
    }
    lines.join("\n")
}

fn next_actions_for(code: &str, cwd: &str, permission_mode: &str) -> Vec<String> {
    if code == "path_not_allowed" {
        return vec![
            format!("Use a path inside the workspace root: {cwd}."),
            "If the outside path is essential, explain why and ask the user for access.".to_string(),
        ];
    }
    vec![format!(
        "Inspect the evidence, change the approach, then retry only with corrected inputs. Current permission mode: {permission_mode}."
    )]
}

fn summarize_error(code: &str, tool_name: &str, raw_message: &str, evidence: &[String]) -> String {
    if let Some(first) = evidence.first() {
        return first.clone();
    }
    let fallback = first_meaningful_line(raw_message);
    if !fallback.is_empty() {
        return trim_sentence(&fallback);
    }
    trim_sentence(&format!("{tool_name} failed with {code}."))
}

fn classify_error(code: &str, tool_name: &str, raw_message: &str) -> &'static str {
    if tool_name != "bash" && code != "tool_execution_failed" {
        return "environment_issue";
    }
    let hay = raw_message.to_ascii_lowercase();
    if contains_any(&hay, &["permission denied", "eacces", "eperm"]) {
        return "ask_user";
    }
    if contains_any(
        &hay,
        &[
            "no such file or directory",
            "enoent",
            "nameerror",
            "referenceerror",
            "syntaxerror",
            "typeerror",
            "modulenotfounderror",
            "cannot find module",
        ],
    ) {
        return "fix_input";
    }
    if hay.contains("etimedout") || hay.contains("esockettimedout") || matches_timed_out(&hay) {
        return "retry_later";
    }
    if hay.contains("eaddrinuse")
        || hay.contains("address already in use")
        || port_already_in_use(&hay)
    {
        return "environment_issue";
    }
    if contains_any(
        &hay,
        &[
            "command not found",
            "econnrefused",
            "connection refused",
            "no space left on device",
            "disk quota",
        ],
    ) {
        return "environment_issue";
    }
    "environment_issue"
}

fn extract_salient_evidence(raw_message: &str) -> Vec<String> {
    let lines: Vec<String> = raw_message
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !starts_with_ignore_ascii_case(line, "TOOL_ERROR["))
        .take(2)
        .map(trim_sentence)
        .collect();
    unique_strings(lines)
}

fn format_original_error(raw_message: &str) -> Option<String> {
    let cleaned = raw_message
        .lines()
        .map(|line| line.trim_end())
        .filter(|line| !starts_with_ignore_ascii_case(line.trim(), "TOOL_ERROR["))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    if cleaned.is_empty() {
        return None;
    }
    if char_len(&cleaned) <= ORIGINAL_ERROR_MAX_CHARS {
        return Some(cleaned);
    }
    Some(format!(
        "{}\n... [original error truncated; {} chars total]",
        truncate_chars(&cleaned, ORIGINAL_ERROR_MAX_CHARS).trim_end(),
        char_len(&cleaned)
    ))
}

fn first_meaningful_line(value: &str) -> String {
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("")
        .to_string()
}

fn trim_sentence(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if char_len(&compact) <= 220 {
        return compact;
    }
    format!("{}...", truncate_chars(&compact, 217).trim_end())
}

fn unique_strings(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for value in values {
        if seen.insert(value.clone()) {
            out.push(value);
        }
    }
    out
}

fn contains_any(hay: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| hay.contains(needle))
}

fn starts_with_ignore_ascii_case(value: &str, prefix: &str) -> bool {
    let value_bytes = value.as_bytes();
    let prefix_bytes = prefix.as_bytes();
    value_bytes.len() >= prefix_bytes.len()
        && value_bytes[..prefix_bytes.len()].eq_ignore_ascii_case(prefix_bytes)
}

fn char_len(value: &str) -> usize {
    value.chars().count()
}

/// Truncate to `max_chars` Unicode scalars. Never splits a UTF-8 character.
fn truncate_chars(value: &str, max_chars: usize) -> &str {
    match value.char_indices().nth(max_chars) {
        None => value,
        Some((idx, _)) => &value[..idx],
    }
}

/// TS `/timed? ?out/i` — `time` + optional `d` + optional space + `out`.
fn matches_timed_out(hay: &str) -> bool {
    let bytes = hay.as_bytes();
    let mut i = 0;
    while i + 7 <= bytes.len() {
        if bytes[i..].starts_with(b"time") {
            let mut j = i + 4;
            if bytes.get(j) == Some(&b'd') {
                j += 1;
            }
            if bytes.get(j) == Some(&b' ') {
                j += 1;
            }
            if bytes[j..].starts_with(b"out") {
                return true;
            }
        }
        i += 1;
    }
    false
}

fn port_already_in_use(hay: &str) -> bool {
    let Some(port) = hay.find("port") else {
        return false;
    };
    hay[port..].contains("already in use")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_execution_failed_matches_ts_recovery_text() {
        let recovered = build_tool_error_recovery(
            "tool_execution_failed",
            "lookup",
            "host rejected module_call",
            ".",
            "default",
        );
        assert_eq!(
            recovered.message,
            "TOOL_ERROR[tool_execution_failed][lookup][environment_issue]\n\
             Summary: host rejected module_call\n\
             Evidence:\n\
             - host rejected module_call\n\
             Original error:\n\
             host rejected module_call\n\
             Next actions:\n\
             1. Inspect the evidence, change the approach, then retry only with corrected inputs. Current permission mode: default."
        );
        assert_eq!(recovered.advice.failure_class, "environment_issue");
        assert_eq!(recovered.advice.to_json()["failureClass"], "environment_issue");
        assert_eq!(recovered.advice.to_json()["originalError"], "host rejected module_call");
    }

    #[test]
    fn tool_execution_failed_timeout_is_retry_later() {
        let recovered = build_tool_error_recovery(
            "tool_execution_failed",
            "lookup",
            "Host module_call timed out.",
            ".",
            "default",
        );
        assert!(recovered.message.starts_with(
            "TOOL_ERROR[tool_execution_failed][lookup][retry_later]"
        ));
        assert_eq!(recovered.advice.failure_class, "retry_later");
        assert_eq!(
            recovered.advice.summary,
            "Host module_call timed out."
        );
    }

    #[test]
    fn cjk_prefix_uses_byte_compare_and_does_not_panic() {
        // Each CJK scalar is 3 bytes. A UTF-8 prefix of `TOOL_ERROR[` (11 bytes)
        // would land mid-character and panic on `&str` slicing.
        let cjk = "你好世界测试文字更多内容";
        assert!(cjk.len() > "TOOL_ERROR[".len());
        assert!(!cjk.is_char_boundary("TOOL_ERROR[".len()));
        assert!(!starts_with_ignore_ascii_case(cjk, "TOOL_ERROR["));
        assert!(starts_with_ignore_ascii_case(
            "TOOL_ERROR[tool_execution_failed] 中文",
            "TOOL_ERROR[",
        ));
        let recovered = build_tool_error_recovery(
            "tool_execution_failed",
            "lookup",
            cjk,
            ".",
            "default",
        );
        assert!(recovered.message.contains("你好世界"));
        assert_eq!(recovered.advice.original_error.as_deref(), Some(cjk));
    }

    #[test]
    fn overlong_cjk_truncates_on_char_boundary() {
        let long: String = std::iter::repeat('字').take(230).collect();
        let trimmed = trim_sentence(&long);
        assert!(trimmed.ends_with("..."));
        assert!(trimmed.is_char_boundary(trimmed.len()));
        assert_eq!(char_len(&trimmed), 220);
        assert_eq!(truncate_chars(&long, 217).chars().count(), 217);

        let original: String = std::iter::repeat('误').take(2_010).collect();
        let formatted = format_original_error(&original).expect("original");
        assert!(formatted.contains("original error truncated; 2010 chars total"));
        let head = formatted
            .split("\n... [original error truncated")
            .next()
            .expect("head");
        assert!(head.is_char_boundary(head.len()));
        assert_eq!(char_len(head), ORIGINAL_ERROR_MAX_CHARS);

        let recovered = build_tool_error_recovery(
            "tool_execution_failed",
            "lookup",
            &original,
            ".",
            "bypassPermissions",
        );
        assert!(recovered
            .message
            .contains("Current permission mode: bypassPermissions."));
        assert!(recovered.message.contains("original error truncated"));
    }

    #[test]
    fn path_not_allowed_mentions_real_cwd() {
        let recovered = build_tool_error_recovery(
            "path_not_allowed",
            "read_file",
            "path not allowed",
            "/tmp/test-home",
            "bypassPermissions",
        );
        assert!(recovered
            .message
            .contains("Use a path inside the workspace root: /tmp/test-home."));
        assert_eq!(
            recovered.advice.next_actions[0],
            "Use a path inside the workspace root: /tmp/test-home."
        );
    }
}
