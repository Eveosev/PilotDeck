# AUTH_MATRIX · T-P2-05 · P5

命令即 TASK_DEF「P5 Auth 三态 · 可复制命令」。仓根执行，产物为 `rust-core/target/release/pilotdeck-agent-loop-sidecar`。完整 stdout 在 `raw/p5.txt`（exit 0）。下面是三态命令与当次输出。

```bash
SIDECAR="$PWD/rust-core/target/release/pilotdeck-agent-loop-sidecar"
TOKEN="production-token"
wait_addr() { # $1=stderr file
  for _ in $(seq 1 50); do
    line=$(grep -m1 '^listening ' "$1" 2>/dev/null || true)
    [ -n "$line" ] && { echo "${line#listening }"; return 0; }
    sleep 0.1
  done
  echo "FAIL: no listening line in $1" >&2; return 1
}
send_line() { # $1=HOST:PORT  $2=json-line
  python3 - "$1" "$2" <<'PY'
import socket, sys
host, port = sys.argv[1].rsplit(":", 1)
msg = sys.argv[2]
if not msg.endswith("\n"):
    msg += "\n"
s = socket.create_connection((host, int(port)), 2)
s.sendall(msg.encode())
buf = b""
while b"\n" not in buf:
    chunk = s.recv(4096)
    if not chunk:
        break
    buf += chunk
s.close()
sys.stdout.write(buf.decode(errors="replace"))
PY
}
```

## 态 A · 无 token

```bash
unset PILOTDECK_AGENT_LOOP_TCP_TOKEN
rm -f /tmp/p5-none.err
"$SIDECAR" --listen 127.0.0.1:0 >/dev/null 2>/tmp/p5-none.err &
PID=$!
ADDR=$(wait_addr /tmp/p5-none.err) || { kill $PID 2>/dev/null; exit 1; }
RESP=$(send_line "$ADDR" '{"kind":"request","messageId":"hello-1","method":"hello","payload":{}}')
echo "$RESP"
python3 -c 'import json,sys; r=json.loads(sys.argv[1]); assert r.get("ok") is True and r.get("inReplyTo")=="hello-1", r' "$RESP"
kill $PID 2>/dev/null; wait $PID 2>/dev/null || true
```

```text
ADDR=127.0.0.1:45915
{"kind":"response","messageId":"response-pilotdeck-agent-loop-instance-6c707847-03fb-4820-9cdc-e866eed7ad1e-9bb10e8a-8f05-485b-8c41-6b1e35eb5e18-1","inReplyTo":"hello-1","ok":true,"protocolVersion":"2.0","moduleId":"pilotdeck-agent-loop","moduleInstanceId":"pilotdeck-agent-loop-instance-6c707847-03fb-4820-9cdc-e866eed7ad1e","connectionGeneration":"pilotdeck-agent-loop-instance-6c707847-03fb-4820-9cdc-e866eed7ad1e-9bb10e8a-8f05-485b-8c41-6b1e35eb5e18","capabilitiesVersion":"1","payload":{}}
A OK
```

## 态 B · 错 token / 缺 token

```bash
export PILOTDECK_AGENT_LOOP_TCP_TOKEN="$TOKEN"
rm -f /tmp/p5-bad.err
"$SIDECAR" --listen 127.0.0.1:0 >/dev/null 2>/tmp/p5-bad.err &
PID=$!
ADDR=$(wait_addr /tmp/p5-bad.err) || { kill $PID 2>/dev/null; exit 1; }
RESP1=$(send_line "$ADDR" '{"kind":"request","messageId":"hello-bad","method":"hello","payload":{}}')
echo "$RESP1"
python3 -c 'import json,sys
r=json.loads(sys.argv[1]); tok=sys.argv[2]
assert r.get("ok") is False and r.get("code")=="UNAUTHENTICATED", r
assert tok not in sys.argv[1], "token plaintext leaked in response JSON"
print("B1 OK")' "$RESP1" "$TOKEN"
RESP2=$(send_line "$ADDR" '{"kind":"request","messageId":"hello-wrong","method":"hello","payload":{"token":"nope"}}')
echo "$RESP2"
python3 -c 'import json,sys
r=json.loads(sys.argv[1]); tok=sys.argv[2]
assert r.get("ok") is False and r.get("code")=="UNAUTHENTICATED", r
assert tok not in sys.argv[1], "token plaintext leaked in response JSON"
print("B2 OK")' "$RESP2" "$TOKEN"
RESP3=$(send_line "$ADDR" '{"kind":"request","messageId":"caps-early","method":"capabilities","payload":{}}')
echo "$RESP3"
python3 -c 'import json,sys; r=json.loads(sys.argv[1]); assert r.get("code")=="UNAUTHENTICATED", r; print("B3 OK")' "$RESP3"
kill $PID 2>/dev/null; wait $PID 2>/dev/null || true
```

```text
ADDR=127.0.0.1:43165
{"kind":"response","messageId":"hello-pilotdeck-agent-loop-instance-52f35cec-89f7-40e5-b22a-cd3de6e5cd2a-4b8ae831-9bea-48ca-bd66-952560858518-1","inReplyTo":"hello-bad","ok":false,"code":"UNAUTHENTICATED"}
B1 OK
{"kind":"response","messageId":"hello-pilotdeck-agent-loop-instance-68f3596f-05ad-4ce0-82fd-f69c2214f2d5-71581aca-e3d4-42c9-a53a-3a51cdd23a41-1","inReplyTo":"hello-wrong","ok":false,"code":"UNAUTHENTICATED"}
B2 OK
{"kind":"error","messageId":"error-pilotdeck-agent-loop-instance-02206323-235d-4843-802a-4d0c00bfe0b5-a3153957-95e1-4047-ba10-caf00d27baaf-1","code":"UNAUTHENTICATED","message":"TCP sidecar requires an authenticated hello.","retryability":"unsafe"}
B3 OK
```

B1/B2/B3 的响应字符串都不含 `production-token`。失败后进程仍在听（随后的 `send_line` 仍得到协议响应，不是 TCP RST）。

## 态 C · 正确 token

```bash
export PILOTDECK_AGENT_LOOP_TCP_TOKEN="$TOKEN"
rm -f /tmp/p5-ok.err
"$SIDECAR" --listen 127.0.0.1:0 >/dev/null 2>/tmp/p5-ok.err &
PID=$!
ADDR=$(wait_addr /tmp/p5-ok.err) || { kill $PID 2>/dev/null; exit 1; }
RESP=$(send_line "$ADDR" "{\"kind\":\"request\",\"messageId\":\"hello-ok\",\"method\":\"hello\",\"payload\":{\"token\":\"$TOKEN\"}}")
echo "$RESP"
python3 -c 'import json,sys
r=json.loads(sys.argv[1])
assert r.get("ok") is True and r.get("inReplyTo")=="hello-ok", r
payload=r.get("payload") or {}
assert "token" not in payload, r
print("C OK")' "$RESP"
RESP2=$(send_line "$ADDR" '{"kind":"request","messageId":"caps-ok","method":"capabilities","payload":{}}')
echo "$RESP2"
python3 -c 'import json,sys; r=json.loads(sys.argv[1]); assert r.get("ok") is True, r; print("C caps OK")' "$RESP2"
kill $PID 2>/dev/null; wait $PID 2>/dev/null || true
unset PILOTDECK_AGENT_LOOP_TCP_TOKEN
```

```text
ADDR=127.0.0.1:44401
{"kind":"response",...,"inReplyTo":"hello-ok","ok":true,...,"payload":{}}
C OK
{"kind":"response",...,"inReplyTo":"caps-ok","ok":true,...,"payload":{"capabilitiesVersion":"1","methods":[...]}}
C caps OK
```

完整一行见 `raw/p5.txt`。hello 的 `payload` 没有 `token` 字段。`capabilities` 是 `send_line` 的另一条 TCP 连接，在 hello 成功之后 `ok: true`。

判定：三态齐全，exit 0。**P5 PASS**。
