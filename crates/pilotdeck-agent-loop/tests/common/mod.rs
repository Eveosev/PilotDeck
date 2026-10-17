#![allow(dead_code)]

pub mod suite;

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpStream};
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
        host_trace: Vec::new(),
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

pub fn wait_listen_addr(stderr: impl Read + Send + 'static) -> std::net::SocketAddr {
    wait_for_listen_addr(stderr)
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
    pub host_trace: Vec<Value>,
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
                Ok(message) => {
                    if let Some(reply) = mock_backend_reply(&message) {
                        record_host_trace(&mut self.host_trace, &message, &reply);
                        self.captured.push(message);
                        self.send_json(&reply);
                    } else {
                        self.captured.push(message);
                    }
                }
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

/// Real-client execute payload (`agentLoopSidecarClient.ts:741-775`).
/// `tools` is the host manifest and is always non-empty; the mock backend
/// decides text vs tool from the conversation, not from this list.
pub fn client_execute_payload(user_text: &str) -> Value {
    json!({
        "agent": {
            "id": "pilotdeck-stub",
            "provider": "pilotdeck-stub",
            "model": "pilotdeck-stub"
        },
        "messages": [{
            "role": "user",
            "content": [{ "type": "text", "text": user_text }]
        }],
        "tools": [{
            "name": "lookup",
            "description": "Look up a value",
            "inputSchema": { "type": "object", "properties": { "q": { "type": "string" } } }
        }],
        "permissionContext": { "mode": "auto" },
        "hostModules": { "model": true, "capability": true },
        "interactionCapabilities": { "elicitationAvailable": false }
    })
}

fn last_user_text(messages: Option<&Value>) -> String {
    let Some(messages) = messages.and_then(Value::as_array) else {
        return "What is the status?".to_string();
    };
    for message in messages.iter().rev() {
        if message.get("role").and_then(Value::as_str) != Some("user") {
            continue;
        }
        if let Some(blocks) = message.get("content").and_then(Value::as_array) {
            for block in blocks.iter().rev() {
                if block.get("type").and_then(Value::as_str) == Some("text") {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        if !text.is_empty() {
                            return text.to_string();
                        }
                    }
                }
            }
        }
    }
    "What is the status?".to_string()
}

fn conversation_has_tool_result(messages: Option<&Value>) -> bool {
    messages.and_then(Value::as_array).is_some_and(|messages| {
        messages.iter().any(|message| {
            message
                .get("content")
                .and_then(Value::as_array)
                .is_some_and(|blocks| {
                    blocks.iter().any(|block| {
                        block.get("type").and_then(Value::as_str) == Some("tool_result")
                    })
                })
        })
    })
}

/// Host-side mock: `Look up` / `lookup` on the last user text with no tool
/// result → tool_calls; otherwise text. The crate never inspects this.
pub fn mock_backend_reply(message: &Value) -> Option<Value> {
    if message.get("kind").and_then(Value::as_str) != Some("request")
        || message.get("method").and_then(Value::as_str) != Some("module_call")
    {
        return None;
    }
    let message_id = message
        .get("messageId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let request_id = message
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let payload = match message.get("module").and_then(Value::as_str) {
        Some("model") => match message
            .pointer("/payload/operation")
            .and_then(Value::as_str)
        {
            Some("prepare") => {
                let request = message
                    .pointer("/payload/request")
                    .cloned()
                    .unwrap_or(json!({}));
                json!({
                    "prepared": {
                        "request": request,
                        "provider": request.get("provider").and_then(Value::as_str).unwrap_or("pilotdeck-stub"),
                        "model": request.get("model").and_then(Value::as_str).unwrap_or("pilotdeck-stub"),
                    }
                })
            }
            Some("stream") | Some("stream_next") => {
                let messages = message.pointer("/payload/request/messages");
                let prompt = last_user_text(messages);
                let lowered = prompt.to_ascii_lowercase();
                let wants_tool = !conversation_has_tool_result(messages)
                    && (lowered.contains("lookup") || lowered.contains("look up"));
                let events = if wants_tool {
                    json!([
                        { "type": "request_started", "provider": "pilotdeck-stub", "model": "pilotdeck-stub" },
                        { "type": "message_start", "role": "assistant" },
                        {
                            "type": "tool_call_end",
                            "toolCall": {
                                "id": "host-tool-1",
                                "name": "lookup",
                                "input": { "q": prompt }
                            }
                        },
                        { "type": "message_end", "finishReason": "tool_call" }
                    ])
                } else {
                    json!([
                        { "type": "request_started", "provider": "pilotdeck-stub", "model": "pilotdeck-stub" },
                        { "type": "message_start", "role": "assistant" },
                        { "type": "text_delta", "text": format!("HOST[{prompt}]") },
                        { "type": "message_end", "finishReason": "stop" }
                    ])
                };
                json!({ "events": events, "done": true })
            }
            Some("close_stream") => json!({ "closed": true }),
            _ => json!({}),
        },
        Some("budget") => json!({
            "snapshot": {
                "tokens": 10,
                "maxContextTokens": 128000,
                "warningRatio": 0.8,
                "blockingRatio": 0.9,
                "state": "ok",
                "ratio": 0.0
            }
        }),
        Some("context") => {
            let input = message
                .pointer("/payload/input")
                .cloned()
                .unwrap_or(json!({}));
            json!({
                "result": {
                    "messages": input.get("messages").cloned().unwrap_or(json!([])),
                    "systemPrompt": input
                        .get("customSystemPrompt")
                        .cloned()
                        .unwrap_or(Value::Null),
                    "systemPromptParts": [],
                    "tools": input.get("tools").cloned().unwrap_or(json!([])),
                    "diagnostics": [],
                    "boundaries": []
                }
            })
        }
        Some("capability") => {
            let name = message
                .pointer("/payload/name")
                .and_then(Value::as_str)
                .unwrap_or("lookup");
            let prompt = message
                .pointer("/payload/arguments/q")
                .and_then(Value::as_str)
                .unwrap_or("");
            json!({
                "type": "success",
                "toolCallId": message.pointer("/payload/toolCallId"),
                "toolName": name,
                "content": [{ "type": "text", "text": format!("HOST_RESULT[{name}]: {prompt}") }],
            })
        }
        _ => json!({}),
    };
    Some(json!({
        "kind": "response",
        "messageId": format!("host-{message_id}"),
        "inReplyTo": message_id,
        "requestId": request_id,
        "ok": true,
        "payload": payload,
    }))
}

fn record_host_trace(trace: &mut Vec<Value>, call: &Value, reply: &Value) {
    match call.get("module").and_then(Value::as_str) {
        Some("model") => {
            trace.push(json!({
                "channel": "model.request",
                "operation": call.pointer("/payload/operation"),
                "messages": call.pointer("/payload/request/messages"),
            }));
            trace.push(json!({
                "channel": "model.response",
                "operation": call.pointer("/payload/operation"),
                "prepared": reply.pointer("/payload/prepared"),
                "events": reply.pointer("/payload/events"),
                "closed": reply.pointer("/payload/closed"),
            }));
        }
        Some("capability") => {
            trace.push(json!({
                "channel": "tool.call",
                "name": call.pointer("/payload/name"),
                "arguments": call.pointer("/payload/arguments"),
                "toolCallId": call.pointer("/payload/toolCallId"),
            }));
            trace.push(json!({
                "channel": "tool.result",
                "result": reply.get("payload"),
            }));
        }
        other => {
            trace.push(json!({ "channel": other.unwrap_or("unknown"), "module": other }));
        }
    }
}
