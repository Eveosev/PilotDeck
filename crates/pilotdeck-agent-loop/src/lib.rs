//! PilotDeck AgentLoop sidecar (T-P1-01 S0–S4): Module Protocol over stdio or TCP JSONL.
//!
//! Incoming frames are parsed as [`serde_json::Value`] first (duplicate keys:
//! last wins, matching `JSON.parse`). Validation is a hand-written port of
//! `validateModuleMessage` in `src/agent/modules/protocol.ts`.

pub mod protocol;
pub mod sidecar;
pub mod stdio;
pub mod tcp;
mod time;

pub use protocol::{validate_module_message, Validation};
pub use sidecar::Sidecar;
pub use stdio::serve_stdio;
pub use tcp::serve_tcp;

use std::net::SocketAddr;

/// How the binary should expose the sidecar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServeMode {
    Stdio,
    Listen(SocketAddr),
}

/// Parse CLI args after `argv[0]`. `--listen 127.0.0.1:0` (or `=`) selects TCP.
pub fn parse_serve_mode<I, S>(args: I) -> Result<ServeMode, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let args: Vec<String> = args.into_iter().map(|s| s.as_ref().to_string()).collect();
    if args.is_empty() {
        return Ok(ServeMode::Stdio);
    }
    let mut listen = None;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if let Some(value) = arg.strip_prefix("--listen=") {
            listen = Some(parse_listen_addr(value)?);
        } else if arg == "--listen" {
            index += 1;
            let value = args
                .get(index)
                .ok_or_else(|| "--listen requires HOST:PORT".to_string())?;
            listen = Some(parse_listen_addr(value)?);
        } else {
            return Err(format!("unknown argument: {arg}"));
        }
        index += 1;
    }
    Ok(listen.map(ServeMode::Listen).unwrap_or(ServeMode::Stdio))
}

fn parse_listen_addr(value: &str) -> Result<SocketAddr, String> {
    let addr: SocketAddr = value
        .parse()
        .map_err(|error| format!("invalid --listen {value}: {error}"))?;
    if !addr.ip().is_loopback() {
        return Err("--listen must bind a loopback address".to_string());
    }
    Ok(addr)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn parse_serve_mode_stdio_default_and_listen_ephemeral() {
        assert_eq!(
            parse_serve_mode(std::iter::empty::<&str>()).unwrap(),
            ServeMode::Stdio
        );
        match parse_serve_mode(["--listen", "127.0.0.1:0"]).unwrap() {
            ServeMode::Listen(addr) => {
                assert_eq!(addr.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
                assert_eq!(addr.port(), 0);
            }
            ServeMode::Stdio => panic!("expected listen mode"),
        }
        match parse_serve_mode(["--listen=127.0.0.1:0"]).unwrap() {
            ServeMode::Listen(addr) => assert_eq!(addr.port(), 0),
            ServeMode::Stdio => panic!("expected listen mode"),
        }
        assert!(parse_serve_mode(["--listen", "0.0.0.0:0"]).is_err());
        assert!(parse_serve_mode(["--listen"]).is_err());
        assert!(parse_serve_mode(["--unknown"]).is_err());
    }
}

/// Same value as `MODULE_PROTOCOL_VERSION` in `src/agent/modules/protocol.ts`.
pub const PROTOCOL_VERSION: &str = "2.0";
pub const MODULE_ID: &str = "pilotdeck-agent-loop";
pub const CAPABILITIES_VERSION: &str = "1";
