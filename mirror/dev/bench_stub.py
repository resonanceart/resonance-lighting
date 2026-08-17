#!/usr/bin/env python3
"""
bench_stub.py — DEV HARNESS ONLY. Never ship, never point production at this.

REPLAYS a captured real /api/state snapshot (state-capture-*.json in this dir,
newest wins) on 127.0.0.1:8766 with net_bench_dashboard.py's exact wire shape
(GET /api/state + GET /events SSE 'snapshot' every 1.0 s, full-state re-push,
no CORS needed behind the vite /bench proxy).

Port 8765 is Ben's canonical dashboard port — this stub must NEVER bind it
(2026-08-17: an earlier invented-peer version on :8765 shadowed the real
dashboard on localhost; lighting-architect killed it). Truth rule: the stub
replays real captured peers, it never invents them. No capture file = hard
exit, not fake data. Capture a fresh snapshot while the real feed is up:
  curl -s http://localhost:8765/api/state -o mirror/dev/state-capture-$(date +%F).json

Two scripted behaviors ride ON TOP of the replayed peers (applied to the two
strongest-RSSI captured MACs) so the Mirror's dropout handling can be tested
deliberately — the real dashboard never prunes peers and real radios drop out:
  - DROPPER (1st): heard 20 s, silent 75 s (age_ms must exceed the Mirror's
    60 s listen window or the dropout never registers), then returns —
    reproduces seated-but-unheard.
  - GHOST (2nd): permanently stale (age_ms = 1 h) — reproduces the
    dashboard's accumulate-forever behavior.

Usage:
  python3 mirror/dev/bench_stub.py       # serves on 127.0.0.1:8766
  BENCH_PORT=8766 npm run dev            # points the vite /bench proxy at it
"""
import glob
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8766  # NEVER 8765 — that is Ben's real dashboard.

HERE = os.path.dirname(os.path.abspath(__file__))
captures = sorted(glob.glob(os.path.join(HERE, "state-capture-*.json")))
if not captures:
    sys.exit(
        "bench_stub: no state-capture-*.json in mirror/dev/ — capture one from "
        "the real dashboard first (see docstring). Refusing to invent peers."
    )
CAPTURE_PATH = captures[-1]
with open(CAPTURE_PATH) as f:
    BASE = json.load(f)

# The two strongest-RSSI captured peers carry the scripted behaviors.
_by_rssi = sorted(
    BASE.get("peers", {}), key=lambda p: BASE["peers"][p].get("rssi_dbm") or -999, reverse=True
)
DROPPER = _by_rssi[0] if _by_rssi else None
GHOST = _by_rssi[1] if len(_by_rssi) > 1 else None

T0 = time.time()


def state() -> dict:
    t = time.time() - T0
    out = dict(BASE)
    out["ts_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    peers = {pid: dict(row) for pid, row in BASE.get("peers", {}).items()}
    if DROPPER:
        phase = t % 95.0
        peers[DROPPER]["age_ms"] = 400 if phase < 20.0 else int((phase - 20.0) * 1000) + 400
    if GHOST:
        peers[GHOST]["age_ms"] = 3_600_000
    out["peers"] = peers
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def do_GET(self):
        if self.path == "/api/state":
            body = json.dumps(state()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                while True:
                    payload = json.dumps(state())
                    self.wfile.write(f"event: snapshot\ndata: {payload}\n\n".encode())
                    self.wfile.flush()
                    time.sleep(1.0)
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    print(
        f"bench_stub on 127.0.0.1:{PORT} — DEV ONLY · replaying "
        f"{os.path.basename(CAPTURE_PATH)} ({len(BASE.get('peers', {}))} real peers) · "
        f"dropper={DROPPER} ghost={GHOST}"
    )
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
