//! G5 / G-MC: real-client-shaped execute over `--listen`, with a non-empty
//! tool manifest. The host mock backend — not the crate — picks pure_text vs
//! single_tool. Sidecar must originate `module_call`; host trace records
//! `model.*` and `tool.*` channels.
//!
//! The same scenario also runs over stdio (`sidecar_stdio`).

mod common;

use common::{spawn_sidecar_tcp, suite};

#[test]
fn g5_tcp_listen_real_client_payload_reaches_pure_text_and_single_tool() {
    let mut sidecar = spawn_sidecar_tcp();
    assert_eq!(sidecar.transport, "tcp");
    suite::g5_real_client_payload(&mut sidecar);
    let _ = sidecar.close();
}
