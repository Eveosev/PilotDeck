# T-P1-03 PR-B parity evidence (reuse mode)

Provenance: `gitSha=3a26dd9d34adeaad93de1350ee8dea576988dc50`, `gitDirty=false`.
Collected on the clean PR-A merge tip before this evidence commit.
Mode: start Rust sidecar with `--listen`, then `tools/agent-loop-parity/run.py` over TCP. Host is connect-only (`tcpSidecarLog=null`).

```
cargo build -p pilotdeck-agent-loop --release
./target/release/pilotdeck-agent-loop --listen 127.0.0.1:37211
python3 tools/agent-loop-parity/run.py \
  --pilotdeck-root "$PWD" \
  --comparison same-version \
  --surface gateway \
  --sidecar-transport tcp \
  --pilotdeck-tcp-host 127.0.0.1 \
  --pilotdeck-tcp-port 37211 \
  --scenario <pure_text|single_tool> \
  --adapter-timeout-seconds 120 \
  --output /tmp/t-p1-03-pr-b-raw/<scene>/run-NN
```

`review/2026-10-14-T-P1-03-parity/QA-ACCEPTANCE.md` is **not** in the tree at `3a26dd9d` (or any `origin` branch). G3 negatives follow `tools/agent-loop-parity/README.md` Negative control plus reuse-mode connect-only proofs. `tools/agent-loop-parity/**` was not modified.

## Per-scene table

| Scene | Runs | Pass | Exit | Mismatch | Format warnings |
| --- | ---: | ---: | ---: | ---: | --- |
| `pure_text` | 30 | 30 | 0 | 0 | 16–58 (typical 58) |
| `single_tool` | 30 | 30 | 0 | 0 | 90–136 (typical 134) |

Pass criteria for every run: exit 0, 0 semantic diffs, mismatch=0. Format warnings are envelope/serialization only (`invocationId`, `sequence`, `agentScope`, budget estimate fields) and do not change the gate.

## G3 negative cases

| Case | Expected | Exit | Gate | What it proves |
| --- | ---: | ---: | --- | --- |
| `g3-stdio-native-mode` | 2 | 2 | PASS | README stdio `PARITY_MODE=native` is BLOCKED (missing transport/handshake proof) |
| `g3-tcp-native-mode` | 2 | 2 | PASS | README tcp `PARITY_MODE=native` is BLOCKED (listener never comes up) |
| `g3-reuse-no-listener` | 2 | 2 | PASS | Reuse host/port with no listener is BLOCKED (host is connect-only) |
| `g3-reuse-sidecar-command-native` | 2 | 2 | PASS | Injecting native-mode as `--pilotdeck-tcp-sidecar-cmd` cannot PASS |

## Leak

| Window | `pilotdeck-agent-loop --listen` | `pilotdeck_gateway_impl.mjs` |
| --- | ---: | ---: |
| before | 0 | 0 |
| mid (reuse listener up) | 1 | 0 |
| after 60 runs | 1 | 0 |
| after SIGTERM listener | 0 | 0 |

No residual processes. See `leak.json`.

## Files

- `pure_text.json` / `single_tool.json` — 30-run records + representative `summary.json`
- `negatives.json` — G3 commands, exits, blocked reasons
- `provenance.json` — toolchain / listen / whitelist note
- `leak.json` — pgrep counts
