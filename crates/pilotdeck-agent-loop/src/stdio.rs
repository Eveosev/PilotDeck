//! stdio JSONL transport. TCP listen is S4 (later PR).

use std::io::{self, BufRead, Write};
use std::sync::{Arc, Mutex};

use crate::Sidecar;

/// Serve Module Protocol on stdin/stdout until stdin closes.
///
/// Active execute workers are joined before return so a final event is flushed.
pub fn serve_stdio() -> io::Result<()> {
    let stdout = Arc::new(Mutex::new(io::stdout()));
    let sidecar = Sidecar::new(Arc::new({
        let stdout = Arc::clone(&stdout);
        move |message| {
            let mut out = stdout.lock().expect("stdout lock");
            if writeln!(out, "{message}").is_err() {
                return;
            }
            let _ = out.flush();
        }
    }));

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = line?;
        sidecar.handle_line(&line);
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
