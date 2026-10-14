//! TCP JSONL transport (`--listen 127.0.0.1:0`). One sidecar instance per connection.

use std::io::{self, BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

use crate::Sidecar;

/// Listen on a loopback address and serve Module Protocol JSONL per connection.
///
/// Binding `127.0.0.1:0` uses an ephemeral port. The bound address is printed
/// to stderr as `listening HOST:PORT` so tests / T-P1-02 can connect.
pub fn serve_tcp(addr: SocketAddr) -> io::Result<()> {
    let listener = TcpListener::bind(addr)?;
    let local = listener.local_addr()?;
    eprintln!("listening {local}");
    for incoming in listener.incoming() {
        let stream = incoming?;
        thread::spawn(move || {
            if let Err(error) = serve_tcp_stream(stream) {
                eprintln!("tcp connection failed: {error}");
            }
        });
    }
    Ok(())
}

fn serve_tcp_stream(stream: TcpStream) -> io::Result<()> {
    stream.set_nodelay(true)?;
    let writer_stream = stream.try_clone()?;
    let writer = Arc::new(Mutex::new(writer_stream));
    let sidecar = Sidecar::with_transport(
        Arc::new({
            let writer = Arc::clone(&writer);
            move |message| {
                let mut out = writer.lock().expect("tcp write lock");
                if writeln!(out, "{message}").is_err() {
                    return;
                }
                let _ = out.flush();
            }
        }),
        "tcp",
    );

    let mut reader = BufReader::new(stream);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        let n = reader.read_until(b'\n', &mut buf)?;
        if n == 0 {
            break;
        }
        while matches!(buf.last(), Some(b'\n' | b'\r')) {
            buf.pop();
        }
        if buf.is_empty() {
            continue;
        }
        match std::str::from_utf8(&buf) {
            Ok(line) => sidecar.handle_line(line),
            Err(_) => sidecar.handle_line("\u{FFFD}"),
        }
        if let Ok(mut out) = writer.lock() {
            let _ = out.flush();
        }
    }
    sidecar.join();
    if let Ok(mut out) = writer.lock() {
        out.flush()?;
    }
    Ok(())
}
