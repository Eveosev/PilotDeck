//! stdio JSONL transport. TCP listen is [`crate::serve_tcp`].

use std::io::{self, BufRead, Write};
use std::sync::{Arc, Mutex};

use crate::Sidecar;

/// Serve Module Protocol on stdin/stdout until stdin closes.
///
/// Active execute workers are joined before return so a final event is flushed.
pub fn serve_stdio() -> io::Result<()> {
    let stdout = Arc::new(Mutex::new(io::stdout()));
    let sidecar = Sidecar::with_transport(
        Arc::new({
            let stdout = Arc::clone(&stdout);
            move |message| {
                let mut out = stdout.lock().expect("stdout lock");
                if writeln!(out, "{message}").is_err() {
                    return;
                }
                let _ = out.flush();
            }
        }),
        "stdio",
    );

    let mut stdin = io::stdin().lock();
    let mut buf = Vec::new();
    loop {
        buf.clear();
        let n = stdin.read_until(b'\n', &mut buf)?;
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
        if let Ok(mut out) = stdout.lock() {
            let _ = out.flush();
        }
    }
    sidecar.join();
    if let Ok(mut out) = stdout.lock() {
        out.flush()?;
    }
    Ok(())
}
