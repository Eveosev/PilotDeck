//! TCP JSONL listener (`--listen 127.0.0.1:0`). One execution server per connection.
//!
//! Binding is blocking. This module does not poll with the probe's 10ms
//! `recv_timeout`. Auth state is process-wide: P5 state C opens a new socket
//! for `capabilities` after a successful hello (`send_line` closes each socket).
//! A failed hello does not flip the flag, and stdio never constructs this gate.

use std::io::{self, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use crate::server::ExecutionServer;

/// Production TCP hello secret. Trimmed empty means the open loopback path.
/// Call this only from the `--listen` entry point. Stdio must not.
pub fn tcp_auth_token_from_env() -> Option<String> {
    std::env::var("PILOTDECK_AGENT_LOOP_TCP_TOKEN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Byte-wise compare that still walks the longer input when lengths differ.
pub fn constant_time_eq(expected: &str, provided: &str) -> bool {
    let expected = expected.as_bytes();
    let provided = provided.as_bytes();
    let mut diff = expected.len() ^ provided.len();
    let len = expected.len().max(provided.len());
    for index in 0..len {
        let left = expected.get(index).copied().unwrap_or(0);
        let right = provided.get(index).copied().unwrap_or(0);
        diff |= usize::from(left ^ right);
    }
    diff == 0
}

/// Shared hello gate. Cloning shares the authenticated flag across connections.
#[derive(Clone)]
pub struct TcpHelloAuth {
    expected: String,
    authenticated: Arc<AtomicBool>,
}

impl TcpHelloAuth {
    pub fn from_token(token: String) -> Self {
        Self {
            expected: token,
            authenticated: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn is_open(&self) -> bool {
        self.authenticated.load(Ordering::SeqCst)
    }

    /// `true` when this hello token matches, or a previous hello already did.
    /// The provided token is compared and then discarded by the caller.
    pub fn accept_hello(&self, provided: &str) -> bool {
        if self.is_open() {
            return true;
        }
        if constant_time_eq(&self.expected, provided) {
            self.authenticated.store(true, Ordering::SeqCst);
            true
        } else {
            false
        }
    }
}

pub fn parse_listen_addr(value: &str) -> Result<SocketAddr, String> {
    let addr: SocketAddr = value
        .parse()
        .map_err(|error| format!("invalid --listen {value}: {error}"))?;
    if !addr.ip().is_loopback() {
        return Err("--listen must bind a loopback address".to_string());
    }
    Ok(addr)
}

/// Listen on loopback and serve Module Protocol JSONL on each connection.
///
/// Prints `listening HOST:PORT` to stderr for `wait_for_tcp` / P5 `wait_addr`.
pub fn serve_tcp(
    addr: SocketAddr,
    mut make_server: impl FnMut() -> Arc<ExecutionServer>,
) -> io::Result<()> {
    let listener = TcpListener::bind(addr)?;
    let local = listener.local_addr()?;
    eprintln!("listening {local}");
    let _ = io::stderr().flush();
    for incoming in listener.incoming() {
        let stream = match incoming {
            Ok(stream) => stream,
            Err(error) => {
                eprintln!("tcp accept failed: {error}");
                continue;
            }
        };
        let server = make_server();
        thread::spawn(move || {
            if let Err(error) = serve_tcp_stream(server, stream) {
                eprintln!("tcp connection failed: {error}");
            }
        });
    }
    Ok(())
}

fn serve_tcp_stream(server: Arc<ExecutionServer>, stream: TcpStream) -> io::Result<()> {
    stream.set_nodelay(true)?;
    let writer = stream.try_clone()?;
    let reader = BufReader::new(stream);
    let report = server.serve(reader, writer, Duration::from_secs(5));
    if !report.complete() {
        eprintln!(
            "Sidecar shutdown incomplete: reader_joined={} writer_joined={} worker_joined={}",
            report.reader_joined, report.writer_joined, report.worker_joined
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    #[test]
    fn parse_listen_addr_allows_loopback_only() {
        let v4 = parse_listen_addr("127.0.0.1:0").unwrap();
        assert_eq!(v4.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
        assert_eq!(v4.port(), 0);
        let v6 = parse_listen_addr("[::1]:9").unwrap();
        assert_eq!(v6.ip(), IpAddr::V6(Ipv6Addr::LOCALHOST));
        assert_eq!(v6.port(), 9);
        let wildcard = parse_listen_addr("0.0.0.0:0").unwrap_err();
        assert!(wildcard.contains("loopback"), "{wildcard}");
        assert!(
            parse_listen_addr("192.168.1.1:1")
                .unwrap_err()
                .contains("loopback")
        );
        assert!(parse_listen_addr("not-an-addr").is_err());
        assert!(parse_listen_addr("").is_err());
    }

    #[test]
    fn constant_time_eq_covers_equal_and_unequal_lengths() {
        assert!(constant_time_eq("production-token", "production-token"));
        assert!(!constant_time_eq("production-token", "nope"));
        assert!(!constant_time_eq("production-token", ""));
        assert!(!constant_time_eq(
            "production-token",
            "production-token-extra"
        ));
        assert!(!constant_time_eq("", "x"));
        assert!(constant_time_eq("", ""));
        assert!(!constant_time_eq("aa", "ab"));
    }

    #[test]
    fn hello_auth_stays_closed_until_one_connection_matches() {
        let auth = TcpHelloAuth::from_token("production-token".to_string());
        let other = auth.clone();
        assert!(!auth.is_open());
        assert!(!auth.accept_hello(""));
        assert!(!auth.accept_hello("nope"));
        assert!(!other.is_open());
        assert!(auth.accept_hello("production-token"));
        assert!(auth.is_open());
        assert!(other.is_open());
        assert!(other.accept_hello(""));
    }
}
