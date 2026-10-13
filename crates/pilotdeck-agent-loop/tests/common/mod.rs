#![allow(dead_code)]

pub mod suite;

use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Shutdown, Write};
use std::net::TcpStream;
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
    spawn_sidecar_mode(SidecarMode::Stdio)
}

pub fn spawn_sidecar_tcp() -> SidecarProcess {
    spawn_sidecar_mode(SidecarMode::Tcp)
}

enum SidecarMode {
    Stdio,
    Tcp,
}

enum Input {
    Stdin(ChildStdin),
    Tcp(TcpStream),
}

impl Input {
    fn write_all(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        match self {
            Self::Stdin(stdin) => stdin.write_all(bytes),
            Self::Tcp(stream) => stream.write_all(bytes),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Self::Stdin(stdin) => stdin.flush(),
            Self::Tcp(stream) => stream.flush(),
        }
    }
}

fn spawn_sidecar_mode(mode: SidecarMode) -> SidecarProcess {
    let bin = env!("CARGO_BIN_EXE_pilotdeck-agent-loop");
    let mut command = Command::new(bin);
    match mode {
        SidecarMode::Stdio => {}
        SidecarMode::Tcp => {
            command.arg("--listen").arg("127.0.0.1:0");
        }
    }
    let mut child = command
        .stdin(match mode {
            SidecarMode::Stdio => Stdio::piped(),
            SidecarMode::Tcp => Stdio::null(),
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn pilotdeck-agent-loop");

    let (tx, rx) = mpsc::channel();
    let input = match mode {
        SidecarMode::Stdio => {
            let stdin = child.stdin.take().expect("stdin");
            let stdout = child.stdout.take().expect("stdout");
            let stderr = child.stderr.take().expect("stderr");
            thread::spawn(move || {
                let mut buf = String::new();
                let _ = BufReader::new(stderr).read_to_string(&mut buf);
            });
            spawn_line_reader(stdout, tx);
            Input::Stdin(stdin)
        }
        SidecarMode::Tcp => {
            let stderr = child.stderr.take().expect("stderr");
            let stdout = child.stdout.take();
            let addr = wait_for_listen_addr(stderr);
            if let Some(stdout) = stdout {
                thread::spawn(move || {
                    let mut buf = String::new();
                    let _ = BufReader::new(stdout).read_to_string(&mut buf);
                });
            }
            let stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2))
                .unwrap_or_else(|error| panic!("connect {addr}: {error}"));
            stream.set_nodelay(true).expect("tcp nodelay");
            let reader = stream.try_clone().expect("clone tcp stream");
            spawn_line_reader(reader, tx);
            Input::Tcp(stream)
        }
    };

    SidecarProcess {
        child,
        input,
        rx,
        captured: Vec::new(),
        transport: match mode {
            SidecarMode::Stdio => "stdio",
            SidecarMode::Tcp => "tcp",
        },
    }
}

fn spawn_line_reader<R: Read + Send + 'static>(reader: R, tx: mpsc::Sender<Value>) {
    thread::spawn(move || {
        let reader = BufReader::new(reader);
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
}

fn wait_for_listen_addr(stderr: impl Read + Send + 'static) -> std::net::SocketAddr {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(remaining) {
            Ok(line) => {
                if let Some(rest) = line.strip_prefix("listening ") {
                    return rest
                        .trim()
                        .parse()
                        .unwrap_or_else(|error| panic!("parse listen addr `{rest}`: {error}"));
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => break,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    panic!("sidecar did not print `listening HOST:PORT` on stderr")
}

pub struct SidecarProcess {
    child: Child,
    input: Input,
    rx: Receiver<Value>,
    pub captured: Vec<Value>,
    pub transport: &'static str,
}

impl SidecarProcess {
    pub fn send_bytes(&mut self, bytes: &[u8]) {
        self.input.write_all(bytes).expect("write sidecar");
        self.input.flush().expect("flush sidecar");
    }

    pub fn send_line(&mut self, line: &str) {
        self.send_bytes(format!("{line}\n").as_bytes());
    }

    pub fn is_running(&mut self) -> bool {
        self.child.try_wait().ok().flatten().is_none()
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
        match self.input {
            Input::Stdin(mut stdin) => {
                let _ = stdin.flush();
                drop(stdin);
            }
            Input::Tcp(stream) => {
                let _ = stream.shutdown(Shutdown::Write);
                drop(stream);
            }
        }
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
        let _ = self.child.kill();
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
