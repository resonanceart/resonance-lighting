#!/usr/bin/env python3
"""Flash Station — live bench dashboard for USB fixture commissioning.

Companion to Ben's docs/howto/FIXTURE_USB_RESCUE_HANDOFF.md. Watches two things
and interferes with neither:

  1. USB serial enumeration (/dev/cu.usbmodem*) — plug in a light, its card
     appears; unplug it, the card greys out into history.
  2. The append-only JSONL evidence file that fleet_usb_bringup.py writes —
     when a board's commission row lands, the card flips to PASS/FAIL with its
     fixture_id, MAC, and per-check flags.

It never opens a serial port and never runs esptool — port presence only — so
it cannot reset a chip mid-flash. (That also means a macOS *stale* port entry
looks present; trust the JSONL verdicts, not port count alone.)

Usage (from repo root, in a second terminal next to the batch tool):

  python3 tools/flash-station.py \
      --jsonl ops/bench/data/usb/2026-08-16-elliot-downlight-rescue-01.jsonl \
      --expect 12

Then open http://127.0.0.1:8940 . The JSONL file may not exist yet; it is
picked up the moment the batch tool creates it.

Per the handoff: a tool PASS is NOT proof an installed-battery PROTECT latch
released — each PASS card runs a 90 s "keep USB attached" hold timer and then
tells you to check for steady red. The bridge shares the Espressif VID/PID with
fixtures: tap a card's "bridge" toggle to exclude it from the counts.
"""

import argparse
import glob
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOCK = threading.Lock()
STATE = {
    "ports": {},      # dev path -> {present, first_seen, last_change, excluded}
    "results": {},    # dev path -> latest commission row summary
    "history": [],    # unplugged ports, most recent first
}
CFG = {"jsonl": None, "expect": 12, "dev_glob": "/dev/cu.usbmodem*", "hold_s": 90}
_jsonl_offset = 0


def poll_ports():
    now = time.time()
    seen = set(glob.glob(CFG["dev_glob"]))
    with LOCK:
        for dev in seen:
            p = STATE["ports"].get(dev)
            if p is None:
                STATE["ports"][dev] = {
                    "present": True, "first_seen": now, "last_change": now,
                    "excluded": False,
                }
            elif not p["present"]:
                p["present"] = True
                p["last_change"] = now
        for dev, p in STATE["ports"].items():
            if p["present"] and dev not in seen:
                p["present"] = False
                p["last_change"] = now
                STATE["history"].insert(0, {
                    "dev": dev, "at": now,
                    "result": STATE["results"].get(dev),
                })


def summarize_row(row):
    checks = {
        "preflight": row.get("preflight_ok"),
        "upload": row.get("upload_ok"),
        "serial_verify": row.get("serial_verify_ok"),
        "wifi_verify": row.get("wifi_verify_ok"),
    }
    hard = [checks["preflight"], checks["upload"], checks["serial_verify"]]
    if any(c is False for c in checks.values()):
        verdict = "FAIL"
    elif all(c for c in hard):
        verdict = "PASS"
    else:
        verdict = "PARTIAL"
    fw = row.get("firmware_rev") or ""
    tele = row.get("telemetry") or {}
    return {
        "verdict": verdict,
        "checks": checks,
        "mac": row.get("mac"),
        "fixture_id": row.get("fixture_id"),
        "event": row.get("event"),
        "fw": fw or tele.get("fw"),
        "guard_stage": tele.get("guard_stage"),
        "battery_v": tele.get("battery_v"),
        "row_at": row.get("timestamp_complete_utc") or row.get("timestamp_utc"),
        "seen_at": time.time(),
    }


def poll_jsonl():
    global _jsonl_offset
    path = CFG["jsonl"]
    if not path:
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            f.seek(_jsonl_offset)
            chunk = f.read()
            _jsonl_offset = f.tell()
    except FileNotFoundError:
        return
    for line in chunk.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        dev = row.get("port")
        if not dev:
            continue
        with LOCK:
            STATE["results"][dev] = summarize_row(row)
            # a result proves the port was real even if enumeration missed it
            if dev not in STATE["ports"]:
                now = time.time()
                STATE["ports"][dev] = {
                    "present": False, "first_seen": now, "last_change": now,
                    "excluded": False,
                }


def watcher():
    while True:
        poll_ports()
        poll_jsonl()
        time.sleep(1.0)


PAGE = """<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flash Station</title>
<style>
:root{--paper:#F6F8F7;--card:#FFF;--ink:#1A211F;--muted:#5B6863;--line:#DCE3E0;
--accent:#2E6E62;--blue:#2B5A9E;--blue-bg:#E3ECF8;--green:#2F6B3A;--green-bg:#E3F1E5;
--red:#A33A2E;--red-bg:#F9E4E1;--amber:#8A6116;--amber-bg:#F8EEDA;--grey:#7A8781;}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
--paper:#121715;--card:#191F1C;--ink:#E8EDEA;--muted:#93A09A;--line:#26302C;
--accent:#6FBFAE;--blue:#8FB4E8;--blue-bg:#1D2A3C;--green:#8FD19A;--green-bg:#1D2F21;
--red:#EE9184;--red-bg:#3A1F1B;--amber:#E0B45C;--amber-bg:#33290F;--grey:#6E7B75;}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.5}
.wrap{max-width:900px;margin:0 auto;padding:20px 16px 60px}
h1{font-family:"Seravek","Gill Sans","Avenir Next",system-ui;font-size:1.4rem;margin:0}
.eyebrow{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.66rem;
letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:0 0 4px}
.mono{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:.85em}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 18px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;
padding:8px 14px;min-width:96px}
.stat b{display:block;font-size:1.4rem;font-variant-numeric:tabular-nums}
.stat span{color:var(--muted);font-size:.72rem}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.cardp{background:var(--card);border:1px solid var(--line);border-radius:12px;
padding:12px 14px;border-left:5px solid var(--grey)}
.cardp.connected{border-left-color:var(--blue)}
.cardp.pass{border-left-color:var(--green)}
.cardp.fail{border-left-color:var(--red)}
.cardp.partial{border-left-color:var(--amber)}
.cardp.gone{opacity:.55}
.cardp h3{margin:0 0 2px;font-size:.92rem;font-family:ui-monospace,"SF Mono",Menlo,monospace}
.chip{display:inline-block;font-family:ui-monospace,"SF Mono",Menlo,monospace;
font-size:.62rem;letter-spacing:.08em;font-weight:600;border-radius:999px;padding:2px 9px}
.chip.connected{background:var(--blue-bg);color:var(--blue)}
.chip.pass{background:var(--green-bg);color:var(--green)}
.chip.fail{background:var(--red-bg);color:var(--red)}
.chip.partial{background:var(--amber-bg);color:var(--amber)}
.chip.gone{background:transparent;color:var(--grey);border:1px dashed var(--grey)}
.kv{color:var(--muted);font-size:.78rem;margin:6px 0 0}
.kv b{color:var(--ink);font-weight:600}
.hold{margin-top:6px;font-size:.78rem;color:var(--amber)}
.hold.ok{color:var(--green)}
.ex{float:right;font-size:.66rem;color:var(--muted);border:1px solid var(--line);
border-radius:999px;padding:2px 8px;cursor:pointer;background:none;font-family:inherit}
.ex[aria-pressed="true"]{background:var(--amber-bg);color:var(--amber);border-color:var(--amber)}
.note{color:var(--muted);font-size:.78rem;max-width:70ch;margin-top:20px}
h2{font-size:.95rem;margin:26px 0 8px;color:var(--muted);font-weight:600}
.empty{color:var(--muted);border:1px dashed var(--line);border-radius:12px;
padding:26px;text-align:center}
</style></head><body><div class="wrap">
<p class="eyebrow">Resonance · USB rescue bench · fx-260816-prtrel1-b</p>
<h1>Flash Station <span class="mono" style="color:var(--muted);font-weight:400" id="src"></span></h1>
<div class="stats">
 <div class="stat"><b id="n-conn">0</b><span>plugged in now</span></div>
 <div class="stat"><b id="n-pass">0</b><span id="lbl-pass">flashed PASS / 12</span></div>
 <div class="stat"><b id="n-fail">0</b><span>failed</span></div>
 <div class="stat"><b id="n-gone">0</b><span>unplugged</span></div>
</div>
<div class="cards" id="cards"></div>
<div id="none" class="empty" style="display:none">No fixtures on USB. Plug one in — it appears here within a second.</div>
<h2>Unplugged history</h2>
<div class="cards" id="hist"></div>
<p class="note">Port presence only — this page never opens a serial port, so it cannot reset a chip mid-flash. PASS comes from the batch tool's evidence JSONL. Per Ben's handoff: a PASS is <b>not</b> proof the PROTECT latch released — each PASS card counts down a 90&nbsp;s USB hold, then check for <b>steady red</b> (shut down any bridge first). The CoreS3 bridge shares the fixture's USB identity: mark it with the <b>bridge?</b> toggle so it doesn't count toward the 12.</p>
<script>
const HOLD = %%HOLD%%;
let excluded = {};
function fmtAge(s){ if(s<60) return Math.floor(s)+"s"; if(s<3600) return Math.floor(s/60)+"m"; return Math.floor(s/3600)+"h"; }
function card(dev,p,r,gone){
  const cls = gone? "gone" : r? r.verdict.toLowerCase() : "connected";
  const chip = gone? "UNPLUGGED" : r? r.verdict : "CONNECTED";
  let kv = "";
  if(r){
    kv += `<div class="kv">fixture <b class="mono">${r.fixture_id||"?"}</b> · mac <span class="mono">${r.mac||"?"}</span></div>`;
    kv += `<div class="kv">fw <b class="mono">${r.fw||"?"}</b></div>`;
    const c = r.checks||{};
    const f = k => c[k]===true? "✓" : c[k]===false? "✗" : "–";
    kv += `<div class="kv mono">preflight ${f("preflight")} · upload ${f("upload")} · serial ${f("serial_verify")} · wifi ${f("wifi_verify")}</div>`;
    if(!gone && r.verdict==="PASS"){
      const left = Math.max(0, HOLD - (Date.now()/1000 - r.seen_at));
      kv += left>0
        ? `<div class="hold">⏳ keep USB attached — ${Math.ceil(left)}s hold remaining, then check steady red</div>`
        : `<div class="hold ok">✓ hold elapsed — verify steady red (no bridge running), then unplug</div>`;
    }
  } else if(!gone){
    kv = `<div class="kv">waiting for the batch tool's evidence row…</div>`;
  }
  const age = fmtAge(Date.now()/1000 - (gone? p.at : p.last_change||p.first_seen));
  const ex = excluded[dev] ? "true":"false";
  const exbtn = gone? "" : `<button class="ex" aria-pressed="${ex}" onclick="tog('${dev}')">bridge?</button>`;
  return `<div class="cardp ${cls}">${exbtn}<h3>${dev.split("/").pop().replace(/^cu\\./,"")}</h3>
    <span class="chip ${cls}">${chip}</span> <span class="kv" style="display:inline">${gone?"removed":"for"} ${age}${gone?" ago":""}</span>${kv}</div>`;
}
function tog(dev){ excluded[dev]=!excluded[dev]; tick(); }
async function tick(){
  try{
    const s = await (await fetch("/state")).json();
    document.getElementById("src").textContent = s.jsonl ? " · " + s.jsonl.split("/").pop() : "";
    document.getElementById("lbl-pass").textContent = "flashed PASS / " + s.expect;
    let conn=0, pass=0, fail=0, html="";
    for(const [dev,p] of Object.entries(s.ports)){
      if(!p.present) continue;
      const r = s.results[dev];
      if(!excluded[dev]){ conn++; if(r&&r.verdict==="PASS") pass++; if(r&&r.verdict==="FAIL") fail++; }
      html += card(dev,p,r,false);
    }
    // count passes from history too (flashed then unplugged = done)
    let hh="";
    for(const h of s.history.slice(0,24)){
      if(h.result && h.result.verdict==="PASS" && !excluded[h.dev]) pass++;
      hh += card(h.dev,h,h.result,true);
    }
    document.getElementById("n-conn").textContent = conn;
    document.getElementById("n-pass").textContent = pass;
    document.getElementById("n-fail").textContent = fail;
    document.getElementById("n-gone").textContent = s.history.length;
    document.getElementById("cards").innerHTML = html;
    document.getElementById("none").style.display = html? "none":"block";
    document.getElementById("hist").innerHTML = hh || '<div class="empty" style="grid-column:1/-1">nothing unplugged yet</div>';
  }catch(e){ /* server briefly away; keep last render */ }
}
setInterval(tick, 1000); tick();
</script></div></body></html>
"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, body, ctype):
        data = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/state"):
            with LOCK:
                payload = {
                    "ports": STATE["ports"],
                    "results": STATE["results"],
                    "history": STATE["history"][:50],
                    "expect": CFG["expect"],
                    "jsonl": CFG["jsonl"],
                }
            self._send(json.dumps(payload), "application/json")
        else:
            self._send(PAGE.replace("%%HOLD%%", str(CFG["hold_s"])), "text/html; charset=utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--jsonl", help="evidence file fleet_usb_bringup.py is writing (may not exist yet)")
    ap.add_argument("--expect", type=int, default=12, help="batch size target (default 12)")
    ap.add_argument("--http-port", type=int, default=8940)
    ap.add_argument("--dev-glob", default="/dev/cu.usbmodem*",
                    help="port pattern to watch (override for testing)")
    ap.add_argument("--hold-s", type=int, default=90,
                    help="post-PASS keep-USB-attached hold, seconds (handoff says 90)")
    args = ap.parse_args()
    CFG.update(jsonl=args.jsonl, expect=args.expect, dev_glob=args.dev_glob, hold_s=args.hold_s)

    threading.Thread(target=watcher, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", args.http_port), Handler)
    print(f"Flash Station: http://127.0.0.1:{args.http_port}  "
          f"(watching {CFG['dev_glob']}"
          + (f" + {CFG['jsonl']}" if CFG["jsonl"] else ", no JSONL yet") + ")")
    srv.serve_forever()


if __name__ == "__main__":
    main()
