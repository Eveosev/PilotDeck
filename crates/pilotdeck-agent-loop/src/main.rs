use std::process;

fn main() {
    if let Err(error) = pilotdeck_agent_loop::serve_stdio() {
        eprintln!("stdio sidecar failed: {error}");
        process::exit(1);
    }
}
