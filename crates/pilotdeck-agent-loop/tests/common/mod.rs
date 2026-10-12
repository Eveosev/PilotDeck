#![allow(dead_code)]

use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

pub fn repo_root() -> std::path::PathBuf {
    let mut dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    dir.pop();
    dir.pop();
    dir
}

pub fn spawn_sidecar() -> SidecarProcess {
    let bin = env!("CARGO_BIN_EXE_pilotdeck-agent-loop");
    let mut child = Command::new(bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn pilotdeck-agent-loop");
    let stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let stderr = child.stderr.take().expect("stderr");
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) if !line.trim().is_empty() => {
                    let value: Value = serde_json::from_str(&line).unwrap_or_else(|error| {
                        panic!("sidecar emitted non-JSON `{line}`: {error}");
                    });
                    if tx.send(value).is_err() {
                        break;
                    }
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
    });
    thread::spawn(move || {
        let mut buf = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut buf);
    });
    SidecarProcess {
        child,
        stdin,
        rx,
        captured: Vec::new(),
    }
}

pub struct SidecarProcess {
    child: Child,
    stdin: ChildStdin,
    rx: Receiver<Value>,
    pub captured: Vec<Value>,
}

impl SidecarProcess {
    pub fn send_line(&mut self, line: &str) {
        writeln!(self.stdin, "{line}").expect("write stdin");
        self.stdin.flush().expect("flush stdin");
    }

    pub fn send_json(&mut self, value: &Value) {
        self.send_line(&value.to_string());
    }

    pub fn wait_for(&mut self, pred: impl Fn(&[Value]) -> bool, timeout: Duration) -> Vec<Value> {
        let deadline = Instant::now() + timeout;
        while !pred(&self.captured) {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                panic!(
                    "timed out waiting for sidecar JSONL, have: {:?}",
                    self.captured
                );
            }
            match self.rx.recv_timeout(remaining) {
                Ok(message) => self.captured.push(message),
                Err(_) => panic!(
                    "sidecar closed stdout before match, have: {:?}",
                    self.captured
                ),
            }
        }
        self.captured.clone()
    }

    pub fn close(mut self) -> Vec<Value> {
        let _ = self.stdin.flush();
        drop(self.stdin);
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            match self.rx.recv_timeout(Duration::from_millis(20)) {
                Ok(message) => self.captured.push(message),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if self.child.try_wait().ok().flatten().is_some() {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        let _ = self.child.wait();
        self.captured
    }
}

pub fn find_reply<'a>(lines: &'a [Value], in_reply_to: &str) -> &'a Value {
    lines
        .iter()
        .find(|message| message.get("inReplyTo").and_then(Value::as_str) == Some(in_reply_to))
        .unwrap_or_else(|| panic!("missing inReplyTo={in_reply_to} in {lines:?}"))
}
