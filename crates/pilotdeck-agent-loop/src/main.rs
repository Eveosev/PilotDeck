use std::process;

use pilotdeck_agent_loop::{parse_serve_mode, serve_stdio, serve_tcp, ServeMode};

fn main() {
    let mode = match parse_serve_mode(std::env::args().skip(1)) {
        Ok(mode) => mode,
        Err(message) => {
            eprintln!("{message}");
            process::exit(2);
        }
    };
    let result = match mode {
        ServeMode::Stdio => serve_stdio(),
        ServeMode::Listen(addr) => serve_tcp(addr),
    };
    if let Err(error) = result {
        eprintln!("sidecar failed: {error}");
        process::exit(1);
    }
}
