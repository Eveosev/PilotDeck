//! G-P2-D7: loopback `--listen`, TCP_PORT no longer exits 2, hello token gate.
use pilotdeck_protocol::{JsValue, parse_json};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_pilotdeck-agent-loop-sidecar")
}

fn clear_deployment(command: &mut Command) {
    command
        .env_remove("PILOTDECK_AGENT_LOOP_FACTORY")
        .env_remove("PILOTDECK_AGENT_LOOP_TCP_HOST")
        .env_remove("PILOTDECK_AGENT_LOOP_TCP_PORT")
        .env_remove("PILOTDECK_AGENT_LOOP_TCP_TOKEN");
}

#[test]
fn listen_rejects_non_loopback_on_stderr() {
    let mut command = Command::new(bin());
    clear_deployment(&mut command);
    let output = command
        .args(["--listen", "0.0.0.0:0"])
        .output()
        .expect("spawn");
    assert_ne!(output.status.code(), Some(0));
    assert!(output.stdout.is_empty());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("--listen must bind a loopback address"),
        "{stderr}"
    );
}

#[test]
fn factory_profile_still_exits_2() {
    let mut command = Command::new(bin());
    clear_deployment(&mut command);
    let output = command
        .env("PILOTDECK_AGENT_LOOP_FACTORY", "/tmp/x")
        .output()
        .expect("spawn");
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("PILOTDECK_AGENT_LOOP_FACTORY"), "{stderr}");
}

#[test]
fn tcp_port_env_does_not_exit_and_listen_stays_up() {
    let mut command = Command::new(bin());
    clear_deployment(&mut command);
    let mut child = command
        .args(["--listen", "127.0.0.1:0"])
        .env("PILOTDECK_AGENT_LOOP_TCP_PORT", "9")
        .env("PILOTDECK_AGENT_LOOP_TCP_HOST", "127.0.0.1")
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn");
    let addr = read_listening(child.stderr.take().expect("stderr"));
    assert!(addr.starts_with("127.0.0.1:"), "{addr}");
    assert_ne!(addr, "127.0.0.1:0");
    assert!(child.try_wait().unwrap().is_none(), "listener exited");
    stop(&mut child);
}

#[test]
fn listen_equals_form_prints_listening_line() {
    let mut command = Command::new(bin());
    clear_deployment(&mut command);
    let mut child = command
        .arg("--listen=127.0.0.1:0")
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn");
    let addr = read_listening(child.stderr.take().expect("stderr"));
    assert!(addr.starts_with("127.0.0.1:"), "{addr}");
    stop(&mut child);
}

#[test]
fn auth_three_states_match_p5() {
    let open = spawn_listen(None);
    let hello = request(
        &open.1,
        r#"{"kind":"request","messageId":"hello-1","method":"hello","payload":{}}"#,
    );
    assert_eq!(field(&hello, "ok"), &JsValue::Bool(true));
    assert_eq!(field(&hello, "inReplyTo"), &JsValue::from("hello-1"));
    drop_listen(open);

    let bad = spawn_listen(Some("production-token"));
    let missing = request(
        &bad.1,
        r#"{"kind":"request","messageId":"hello-bad","method":"hello","payload":{}}"#,
    );
    assert_unauthenticated(&missing, "production-token");
    assert_eq!(field(&missing, "ok"), &JsValue::Bool(false));
    assert_eq!(field(&missing, "inReplyTo"), &JsValue::from("hello-bad"));
    let wrong = request(
        &bad.1,
        r#"{"kind":"request","messageId":"hello-wrong","method":"hello","payload":{"token":"nope"}}"#,
    );
    assert_unauthenticated(&wrong, "production-token");
    assert_eq!(field(&wrong, "inReplyTo"), &JsValue::from("hello-wrong"));
    let early = request(
        &bad.1,
        r#"{"kind":"request","messageId":"caps-early","method":"capabilities","payload":{}}"#,
    );
    assert_eq!(field(&early, "code"), &JsValue::from("UNAUTHENTICATED"));
    assert!(!json_text(&early).contains("production-token"));
    drop_listen(bad);

    let good = spawn_listen(Some("production-token"));
    let accepted = request(
        &good.1,
        r#"{"kind":"request","messageId":"hello-ok","method":"hello","payload":{"token":"production-token"}}"#,
    );
    assert_eq!(field(&accepted, "ok"), &JsValue::Bool(true));
    assert_eq!(field(&accepted, "inReplyTo"), &JsValue::from("hello-ok"));
    let payload = field(&accepted, "payload");
    assert!(payload.get("token").is_none(), "{payload:?}");
    let caps = request(
        &good.1,
        r#"{"kind":"request","messageId":"caps-ok","method":"capabilities","payload":{}}"#,
    );
    assert_eq!(field(&caps, "ok"), &JsValue::Bool(true), "{caps:?}");
    drop_listen(good);
}

#[test]
fn failed_hello_keeps_the_connection_for_a_later_token() {
    let child = spawn_listen(Some("production-token"));
    let mut stream = TcpStream::connect(child.1.as_str()).expect("connect");
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    writeln!(
        stream,
        r#"{{"kind":"request","messageId":"hello-bad","method":"hello","payload":{{"token":"nope"}}}}"#
    )
    .unwrap();
    stream.flush().unwrap();
    let rejected = read_message(&mut reader);
    assert_eq!(field(&rejected, "code"), &JsValue::from("UNAUTHENTICATED"));
    writeln!(
        stream,
        r#"{{"kind":"request","messageId":"hello-ok","method":"hello","payload":{{"token":"production-token"}}}}"#
    )
    .unwrap();
    stream.flush().unwrap();
    let accepted = read_message(&mut reader);
    assert_eq!(field(&accepted, "ok"), &JsValue::Bool(true));
    writeln!(
        stream,
        r#"{{"kind":"request","messageId":"caps-ok","method":"capabilities","payload":{{}}}}"#
    )
    .unwrap();
    stream.flush().unwrap();
    let caps = read_message(&mut reader);
    assert_eq!(field(&caps, "ok"), &JsValue::Bool(true));
    drop(stream);
    drop_listen(child);
}

#[test]
fn stdio_ignores_tcp_token_env() {
    let mut command = Command::new(bin());
    clear_deployment(&mut command);
    let mut child = command
        .env("PILOTDECK_AGENT_LOOP_TCP_TOKEN", "production-token")
        .env("PILOTDECK_AGENT_LOOP_TCP_PORT", "9")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn");
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    writeln!(
        stdin,
        r#"{{"kind":"request","messageId":"hello-1","method":"hello","payload":{{}}}}"#
    )
    .unwrap();
    stdin.flush().unwrap();
    let message = read_message(&mut stdout);
    assert_eq!(field(&message, "ok"), &JsValue::Bool(true));
    assert_eq!(field(&message, "inReplyTo"), &JsValue::from("hello-1"));
    assert!(!json_text(&message).contains("production-token"));
    drop(stdin);
    let status = child.wait().expect("wait");
    assert!(status.success(), "{status}");
}

fn spawn_listen(token: Option<&str>) -> (Child, String) {
    let mut command = Command::new(bin());
    clear_deployment(&mut command);
    if let Some(token) = token {
        command.env("PILOTDECK_AGENT_LOOP_TCP_TOKEN", token);
    }
    let mut child = command
        .args(["--listen", "127.0.0.1:0"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn");
    let addr = read_listening(child.stderr.take().expect("stderr"));
    (child, addr)
}

fn drop_listen(mut child: (Child, String)) {
    stop(&mut child.0);
}

fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn read_listening(stderr: impl std::io::Read) -> String {
    let mut reader = BufReader::new(stderr);
    let mut line = String::new();
    let mut all = String::new();
    loop {
        line.clear();
        let n = reader.read_line(&mut line).expect("stderr");
        if n == 0 {
            panic!("exited before listening: {all}");
        }
        all.push_str(&line);
        if let Some(addr) = line.strip_prefix("listening ") {
            return addr.trim().to_string();
        }
    }
}

fn request(addr: &str, line: &str) -> JsValue {
    let mut stream =
        TcpStream::connect(addr).unwrap_or_else(|error| panic!("connect {addr}: {error}"));
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    writeln!(stream, "{line}").unwrap();
    stream.flush().unwrap();
    read_message(&mut reader)
}

fn read_message(reader: &mut impl BufRead) -> JsValue {
    let mut line = String::new();
    reader.read_line(&mut line).expect("response");
    parse_json(line.trim()).unwrap_or_else(|error| panic!("json {error}: {line}"))
}

fn field<'a>(value: &'a JsValue, name: &str) -> &'a JsValue {
    value
        .get(name)
        .unwrap_or_else(|| panic!("missing {name} in {value:?}"))
}

fn assert_unauthenticated(value: &JsValue, token: &str) {
    assert_eq!(field(value, "code"), &JsValue::from("UNAUTHENTICATED"));
    assert!(!json_text(value).contains(token), "{value:?}");
}

fn json_text(value: &JsValue) -> String {
    pilotdeck_protocol::stringify_json(value)
        .unwrap()
        .unwrap_or_default()
}
