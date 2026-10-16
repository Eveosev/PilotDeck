//! Native sidecar entry point. stdout contains only Module2.0 NDJSON on stdio.
//! `--listen HOST:PORT` serves the same protocol on a loopback TCP socket.
use pilotdeck_protocol::admission::SidecarBinding;
use pilotdeck_transport::default_factory::OriginalAgentFactory;
use pilotdeck_transport::server::ExecutionServer;
use pilotdeck_transport::stdio::ConnectionOwner;
use pilotdeck_transport::system_clock::SystemExecutionClock;
use pilotdeck_transport::tcp::{self, TcpHelloAuth};
use std::io::{self, BufReader};
use std::net::SocketAddr;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

fn main() -> ExitCode {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    if arguments == ["--version"] {
        println!(
            "pilotdeck-agent-loop-sidecar {} implementation=rust wire=2.0 source={}",
            env!("CARGO_PKG_VERSION"),
            env!("PILOTDECK_SOURCE_COMMIT")
        );
        return ExitCode::SUCCESS;
    }
    let mode = match classify_launch(&arguments) {
        Ok(mode) => mode,
        Err(LaunchError::Usage) => {
            eprintln!(
                "Usage: pilotdeck-agent-loop-sidecar [--stdio | --listen HOST:PORT | --version | <sidecar-path>]"
            );
            return ExitCode::from(2);
        }
        Err(LaunchError::Message(message)) => {
            eprintln!("{message}");
            return ExitCode::from(2);
        }
    };
    if std::env::var_os("PILOTDECK_AGENT_LOOP_FACTORY").is_some_and(|value| !value.is_empty()) {
        eprintln!(
            "Rust candidate does not yet support the PILOTDECK_AGENT_LOOP_FACTORY deployment profile."
        );
        return ExitCode::from(2);
    }
    let process_cwd = match std::env::current_dir().and_then(|path| {
        path.into_os_string().into_string().map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidData, "Process cwd is not valid UTF8.")
        })
    }) {
        Ok(cwd) => cwd.into(),
        Err(error) => {
            eprintln!("Sidecar initialization failed: {error}");
            return ExitCode::from(2);
        }
    };
    let clock = Arc::new(SystemExecutionClock);
    let factory = Arc::new(OriginalAgentFactory {
        clock: clock.clone(),
        process_cwd,
    });
    match mode {
        Launch::Stdio => serve_stdio(factory, clock),
        Launch::Listen(addr) => serve_listen(addr, factory, clock),
    }
}

fn serve_stdio(factory: Arc<OriginalAgentFactory>, clock: Arc<SystemExecutionClock>) -> ExitCode {
    // Stdio does not read PILOTDECK_AGENT_LOOP_TCP_TOKEN.
    let server = ExecutionServer::new(new_binding_owner(), factory, clock, 32);
    let report = server.serve(
        BufReader::new(io::stdin()),
        io::stdout(),
        Duration::from_secs(5),
    );
    shutdown_code(report)
}

fn serve_listen(
    addr: SocketAddr,
    factory: Arc<OriginalAgentFactory>,
    clock: Arc<SystemExecutionClock>,
) -> ExitCode {
    let auth = tcp::tcp_auth_token_from_env().map(TcpHelloAuth::from_token);
    let result = tcp::serve_tcp(addr, move || {
        ExecutionServer::with_tcp_hello(
            new_binding_owner(),
            factory.clone(),
            clock.clone(),
            32,
            auth.clone(),
        )
    });
    if let Err(error) = result {
        eprintln!("sidecar failed: {error}");
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

fn new_binding_owner() -> ConnectionOwner {
    let module_instance = format!("pilotdeck-agent-loop-instance-{}", uuid::Uuid::new_v4());
    let binding = SidecarBinding {
        module_id: "pilotdeck-agent-loop".into(),
        module_instance_id: module_instance.clone().into(),
        connection_generation: format!("{module_instance}-{}", uuid::Uuid::new_v4()).into(),
        capabilities_version: "1".into(),
    };
    ConnectionOwner::new(binding, 64)
}

fn shutdown_code(report: pilotdeck_transport::server::ShutdownReport) -> ExitCode {
    if report.complete() {
        ExitCode::SUCCESS
    } else {
        // The OS process is the final supervisor for a stuck input/output/host
        // worker. Do not report graceful thread cleanup which did not happen.
        eprintln!(
            "Sidecar shutdown incomplete: reader_joined={} writer_joined={} worker_joined={}",
            report.reader_joined, report.writer_joined, report.worker_joined
        );
        ExitCode::from(3)
    }
}

#[derive(Debug)]
enum Launch {
    Stdio,
    Listen(SocketAddr),
}

#[derive(Debug)]
enum LaunchError {
    Usage,
    Message(String),
}

fn classify_launch(arguments: &[String]) -> Result<Launch, LaunchError> {
    if arguments
        .iter()
        .any(|arg| arg == "--listen" || arg.starts_with("--listen="))
    {
        return parse_listen_launch(arguments).map(Launch::Listen);
    }
    if accepts_launch_arguments(arguments) {
        Ok(Launch::Stdio)
    } else {
        Err(LaunchError::Usage)
    }
}

fn parse_listen_launch(arguments: &[String]) -> Result<SocketAddr, LaunchError> {
    let mut listen = None;
    let mut index = 0;
    while index < arguments.len() {
        let arg = &arguments[index];
        if let Some(value) = arg.strip_prefix("--listen=") {
            listen = Some(tcp::parse_listen_addr(value).map_err(LaunchError::Message)?);
        } else if arg == "--listen" {
            index += 1;
            let value = arguments
                .get(index)
                .ok_or_else(|| LaunchError::Message("--listen requires HOST:PORT".to_string()))?;
            listen = Some(tcp::parse_listen_addr(value).map_err(LaunchError::Message)?);
        } else {
            return Err(LaunchError::Message(format!("unknown argument: {arg}")));
        }
        index += 1;
    }
    listen.ok_or_else(|| LaunchError::Message("--listen requires HOST:PORT".to_string()))
}

// A single nonempty path is only a launch placeholder for the TS gateway;
// it is ignored, and every accepted invocation without --listen uses stdio.
fn accepts_launch_arguments(arguments: &[String]) -> bool {
    arguments.is_empty()
        || (arguments.len() == 1
            && !arguments[0].is_empty()
            && (arguments[0] == "--stdio" || !arguments[0].starts_with("--")))
}

#[cfg(test)]
mod tests {
    use super::{Launch, LaunchError, accepts_launch_arguments, classify_launch};
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn stdio_accepts_one_ignored_path_and_rejects_invalid_arguments() {
        for arguments in [
            vec![],
            vec!["--stdio"],
            vec!["/tmp/PilotDeck/dist/agent-loop-sidecar.js"],
            vec!["relative-sidecar.js"],
            vec!["-sidecar.js"],
        ] {
            let arguments = arguments.into_iter().map(String::from).collect::<Vec<_>>();
            assert!(accepts_launch_arguments(&arguments), "{arguments:?}");
            assert!(matches!(
                classify_launch(&arguments).unwrap(),
                Launch::Stdio
            ));
        }
        for arguments in [
            vec![""],
            vec!["--unknown"],
            vec!["--stdio", "sidecar.js"],
            vec!["sidecar.js", "another.js"],
            vec!["--version", "sidecar.js"],
        ] {
            let arguments = arguments.into_iter().map(String::from).collect::<Vec<_>>();
            assert!(!accepts_launch_arguments(&arguments), "{arguments:?}");
            assert!(matches!(
                classify_launch(&arguments).unwrap_err(),
                LaunchError::Usage
            ));
        }
    }

    #[test]
    fn listen_accepts_both_forms_and_rejects_non_loopback() {
        for arguments in [
            vec!["--listen", "127.0.0.1:0"],
            vec!["--listen=127.0.0.1:9"],
            vec!["--listen", "[::1]:0"],
        ] {
            let arguments = arguments.into_iter().map(String::from).collect::<Vec<_>>();
            let Launch::Listen(addr) = classify_launch(&arguments).unwrap() else {
                panic!("expected listen: {arguments:?}");
            };
            assert!(addr.ip().is_loopback(), "{addr}");
        }
        match classify_launch(&["--listen".into(), "127.0.0.1:0".into()]).unwrap() {
            Launch::Listen(addr) => {
                assert_eq!(addr.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
                assert_eq!(addr.port(), 0);
            }
            Launch::Stdio => panic!("expected listen"),
        }
        for arguments in [
            vec!["--listen"],
            vec!["--listen", "0.0.0.0:0"],
            vec!["--listen=0.0.0.0:1"],
            vec!["--listen", "127.0.0.1:0", "extra"],
        ] {
            let arguments = arguments.into_iter().map(String::from).collect::<Vec<_>>();
            let LaunchError::Message(message) = classify_launch(&arguments).unwrap_err() else {
                panic!("expected message: {arguments:?}");
            };
            if arguments.iter().any(|arg| arg.contains("0.0.0.0")) {
                assert!(message.contains("loopback"), "{message}");
            }
        }
    }
}
