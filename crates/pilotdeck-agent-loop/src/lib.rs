//! PilotDeck AgentLoop sidecar (T-P1-01 S0–S2): Module Protocol over stdio JSONL.
//!
//! Incoming frames are parsed as [`serde_json::Value`] first (duplicate keys:
//! last wins, matching `JSON.parse`). Validation is a hand-written port of
//! `validateModuleMessage` in `src/agent/modules/protocol.ts`.

pub mod protocol;
pub mod sidecar;
pub mod stdio;
mod time;

pub use protocol::{validate_module_message, Validation};
pub use sidecar::Sidecar;
pub use stdio::serve_stdio;

/// Same value as `MODULE_PROTOCOL_VERSION` in `src/agent/modules/protocol.ts`.
pub const PROTOCOL_VERSION: &str = "2.0";
pub const MODULE_ID: &str = "pilotdeck-agent-loop";
pub const CAPABILITIES_VERSION: &str = "1";
