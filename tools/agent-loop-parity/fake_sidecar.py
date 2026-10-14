#!/usr/bin/env python3
"""Reuse-mode injection: bind 127.0.0.1:0 and speak a malformed sidecar shape.

Used by T-P1-03-FU-A G3 ``g3-reuse-fake-sidecar``. The host is connect-only;
this process occupies the listen port and answers with a non-protocol frame so
the run must BLOCKED. Prints ``listening HOST:PORT`` on stdout (same shape as
the Rust sidecar) so a collector can reuse the port.
"""
from __future__ import annotations

import socket
import sys


def main() -> int:
    host = "127.0.0.1"
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((host, 0))
    sock.listen(8)
    bound_host, port = sock.getsockname()[:2]
    print(f"listening {bound_host}:{port}", flush=True)
    while True:
        try:
            conn, _ = sock.accept()
        except OSError:
            return 1
        try:
            # Not a Module Protocol hello/capabilities frame.
            conn.sendall(b'{"kind":"not-a-sidecar","malformed":true,"shape":"single_tool"}\n')
        except OSError:
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
