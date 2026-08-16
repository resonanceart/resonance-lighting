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
import os
import re
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOCK = threading.Lock()
STATE = {
    "ports": {},      # dev path -> {present, first_seen, last_change, excluded}
    "results": {},    # dev path -> latest commission row summary
    "history": [],    # flashed-then-unplugged sessions (internal)
    "roster": {},     # fixture_id -> durable flashed-light ledger (persisted)
}
CFG = {"jsonl": None, "expect": 12, "dev_glob": "/dev/cu.usbmodem*", "hold_s": 90,
       "roster": None}
_jsonl_offset = 0


def load_roster():
    try:
        with open(CFG["roster"], "r", encoding="utf-8") as f:
            STATE["roster"] = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        STATE["roster"] = {}


def save_roster():
    os.makedirs(os.path.dirname(CFG["roster"]), exist_ok=True)
    tmp = CFG["roster"] + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(STATE["roster"], f, indent=1, sort_keys=True)
    os.replace(tmp, CFG["roster"])


def roster_update(dev, summ):
    """Durable ledger of every flashed light — MAC, fixture id, verdict, fw.

    Survives restarts (Elliot: 'keep track of which lights you flashed, the
    MAC addresses'). PASS is sticky: a later FAIL row for the same fixture
    does not erase a recorded PASS, it flags last_verdict instead.
    """
    if summ["verdict"] not in ("PASS", "FAIL"):
        return
    key = summ.get("fixture_id") or summ.get("mac")
    if not key:
        return
    e = STATE["roster"].get(key, {})
    first_pass = e.get("first_pass_at")
    if summ["verdict"] == "PASS" and not first_pass:
        first_pass = summ.get("row_at") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    STATE["roster"][key] = {
        "fixture_id": summ.get("fixture_id"), "mac": summ.get("mac"),
        "fw": summ.get("fw"), "last_verdict": summ["verdict"],
        "flashed": bool(first_pass), "first_pass_at": first_pass,
        "last_port": dev, "last_row_at": summ.get("row_at"),
    }
    save_roster()


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
                # History is the FLASH record, not a plug/unplug diary (Elliot,
                # 08-16): an unflashed light that leaves the bench just vanishes.
                if STATE["results"].get(dev) is not None:
                    STATE["history"].insert(0, {
                        "dev": dev, "at": now,
                        "result": STATE["results"].get(dev),
                        "usb": p.get("usb"),
                    })


def usb_snapshot():
    """List real USB devices via system_profiler — the honest instrument.

    A /dev/cu.* node can outlive its hardware (macOS stale-port trap, 08-15:
    five ports showed, one real chip). This is the cross-check. Returns
    [{loc, serial, name, mfr}]; loc is the locationID hex with trailing zeros
    stripped, which macOS uses as the usbmodem name prefix.
    """
    try:
        out = subprocess.run(
            ["system_profiler", "SPUSBDataType", "-json"],
            capture_output=True, text=True, timeout=15).stdout
        data = json.loads(out)
    except Exception:
        return None  # instrument unavailable — report unknown, not absent
    found = []

    def walk(items):
        for it in items or []:
            loc = it.get("location_id", "")
            if loc:
                # 0x03110000 -> "311": port names drop leading AND trailing zeros
                hexpart = loc.split("/")[0].strip().lower().replace("0x", "").strip("0") or "0"
                found.append({"loc": hexpart, "serial": it.get("serial_num"),
                              "name": it.get("_name"), "mfr": it.get("manufacturer")})
            walk(it.get("_items"))
    for bus in data.get("SPUSBDataType", []):
        walk(bus.get("_items"))
    return found


def detect_flashing():
    """Mark ports whose name appears in a live flasher process's argv.

    Read-only ps scan — arduino-cli / esptool / fleet_usb_bringup keep the
    port path in argv for the whole upload, so this holds FLASHING from
    start of upload until the tool exits.
    """
    try:
        out = subprocess.run(["ps", "-axo", "command"],
                             capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return
    lines = [l for l in out.splitlines()
             if re.search(r"esptool|arduino-cli|fleet_usb_bringup", l)
             and "flash-station" not in l]
    with LOCK:
        for dev, p in STATE["ports"].items():
            base = dev.split("/")[-1]
            p["flashing"] = any(base in l or dev in l for l in lines)


def annotate_usb():
    """Match present ports to real USB devices; derive fixture id from serial."""
    devices = usb_snapshot()
    if devices is None:
        return
    with LOCK:
        for dev, p in STATE["ports"].items():
            if not p["present"] or not dev.startswith("/dev/"):
                continue
            m = re.search(r"usbmodem(\w+)$", dev)
            digits = m.group(1).lower() if m else ""
            cands = [d for d in devices if d["loc"] and digits.startswith(d["loc"])]
            # longest location prefix wins — a parent hub's shorter prefix also matches
            hit = max(cands, key=lambda d: len(d["loc"]), default=None)
            if hit:
                serial = hit.get("serial") or ""
                hexonly = re.sub(r"[^0-9A-Fa-f]", "", serial)
                p["usb"] = {
                    "serial": serial, "name": hit.get("name"), "mfr": hit.get("mfr"),
                    "fixture_hint": hexonly[-6:].upper() if len(hexonly) >= 6 else None,
                }
            else:
                p["usb"] = None  # checked, nothing behind it — stale port


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
        if row.get("event") not in ("commission", "inventory"):
            continue  # operator_confirm / segment rows are context, not verdicts
        dev = row.get("port")
        if not dev:
            continue
        with LOCK:
            summ = summarize_row(row)
            STATE["results"][dev] = summ
            roster_update(dev, summ)
            # a result proves the port was real even if enumeration missed it
            if dev not in STATE["ports"]:
                now = time.time()
                STATE["ports"][dev] = {
                    "present": False, "first_seen": now, "last_change": now,
                    "excluded": False,
                }


def watcher():
    # One exception here froze the whole dashboard at a stale FAIL (2026-08-16,
    # missing roster dir) — the watcher must survive ANY single-step failure.
    n = 0
    while True:
        for step in (poll_ports, poll_jsonl, detect_flashing):
            try:
                step()
            except Exception as e:
                print(f"watcher: {step.__name__} failed: {e!r}", flush=True)
        if n % 5 == 0:
            try:
                annotate_usb()
            except Exception as e:
                print(f"watcher: annotate_usb failed: {e!r}", flush=True)
        n += 1
        time.sleep(1.0)


PAGE = """<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flash Station</title>
<style>
/* Resonance controller night-navy scheme — same tokens as the twin (app/) */
:root{--paper:#07090c;--card:#121a26;--ink:#dce6ff;--muted:#9fb0c7;--line:#2a3a52;
--accent:#5b8cff;--blue:#5b8cff;--blue-bg:#1d2b47;--green:#3ddc97;--green-bg:#12312a;
--red:#ff5b6e;--red-bg:#391c22;--amber:#ffb454;--amber-bg:#38290f;--grey:#7e8ea6;}
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
 <div class="stat"><b id="n-pass">0</b><span id="lbl-pass">flashed ✓ / 12</span></div>
 <div class="stat"><b id="n-fail">0</b><span>failed</span></div>
</div>
<h2>Plugged in now</h2>
<div class="cards" id="cards"></div>
<div id="none" class="empty" style="display:none">Nothing on USB. Plug a light in — it appears here within a second.</div>
<h2>Successfully flashed</h2>
<div class="cards" id="hist"></div>
<p class="note">Port presence only — this page never opens a serial port, so it cannot reset a chip mid-flash. PASS comes from the batch tool's evidence JSONL. Per Ben's handoff: a PASS is <b>not</b> proof the PROTECT latch released — each PASS card counts down a 90&nbsp;s USB hold, then check for <b>steady red</b> (shut down any bridge first). The CoreS3 bridge shares the fixture's USB identity: mark it with the <b>bridge?</b> toggle so it doesn't count toward the 12.</p>
<script>
const HOLD = %%HOLD%%;
let excluded = {};
function fmtAge(s){ if(s<60) return Math.floor(s)+"s"; if(s<3600) return Math.floor(s/60)+"m"; return Math.floor(s/3600)+"h"; }
function liveCard(dev,p,r){
  const flashing = p.flashing && !r;
  const cls = r? r.verdict.toLowerCase() : flashing? "partial" : "connected";
  const chip = r? r.verdict : flashing? "⚡ FLASHING" : "CONNECTED";
  let kv = "";
  if(p.usb){
    kv += `<div class="kv">light <b class="mono">${p.usb.fixture_hint||"?"}</b> · mac <span class="mono">${p.usb.serial||"?"}</span></div>`;
  } else if(p.usb === null){
    kv += `<div class="kv" style="color:var(--amber)">⚠ no USB hardware behind this port — stale entry; replug or ignore</div>`;
  }
  if(r){
    kv += `<div class="kv">fw <b class="mono">${r.fw||"?"}</b></div>`;
    const c = r.checks||{};
    const f = k => c[k]===true? "✓" : c[k]===false? "✗" : "–";
    kv += `<div class="kv mono">preflight ${f("preflight")} · upload ${f("upload")} · serial ${f("serial_verify")} · wifi ${f("wifi_verify")}</div>`;
    if(r.verdict==="PASS"){
      const left = Math.max(0, HOLD - (Date.now()/1000 - r.seen_at));
      kv += left>0
        ? `<div class="hold">⏳ keep USB attached — ${Math.ceil(left)}s hold remaining, then check steady red</div>`
        : `<div class="hold ok">✓ hold elapsed — verify steady red (no bridge running), then unplug</div>`;
    }
  } else if(flashing){
    kv += `<div class="hold">⚡ upload in progress — do not unplug</div>`;
  } else {
    kv += `<div class="kv">waiting for the flash tool…</div>`;
  }
  const age = fmtAge(Date.now()/1000 - (p.last_change||p.first_seen));
  const ex = excluded[dev] ? "true":"false";
  return `<div class="cardp ${cls}"><button class="ex" aria-pressed="${ex}" onclick="tog('${dev}')">bridge?</button><h3>${dev.split("/").pop().replace(/^cu\\./,"")}</h3>
    <span class="chip ${cls}">${chip}</span> <span class="kv" style="display:inline">for ${age}</span>${kv}</div>`;
}
function tog(dev){ excluded[dev]=!excluded[dev]; tick(); }
async function tick(){
  try{
    const s = await (await fetch("/state")).json();
    document.getElementById("src").textContent = s.jsonl ? " · " + s.jsonl.split("/").pop() : "";
    document.getElementById("lbl-pass").textContent = "flashed ✓ / " + s.expect;
    let conn=0, html="";
    for(const [dev,p] of Object.entries(s.ports)){
      if(!p.present) continue;
      if(!excluded[dev]) conn++;
      html += liveCard(dev,p,s.results[dev]);
    }
    let pass=0, fail=0, fh="";
    const entries = Object.entries(s.roster||{}).sort((a,b)=> (b[1].first_pass_at||"").localeCompare(a[1].first_pass_at||""));
    for(const [k,e] of entries){
      if(e.flashed) pass++; else fail++;
      const cls = e.flashed? "pass" : "fail";
      fh += `<div class="cardp ${cls}"><h3>${e.fixture_id||k}</h3><span class="chip ${cls}">${e.flashed?"FLASHED ✓":"FAILED"}</span>
        <div class="kv">mac <b class="mono">${e.mac||"?"}</b></div>
        <div class="kv">fw <span class="mono">${e.fw||"?"}</span>${e.first_pass_at? " · "+e.first_pass_at.slice(11,16)+"Z":""}</div></div>`;
    }
    document.getElementById("n-conn").textContent = conn;
    document.getElementById("n-pass").textContent = pass;
    document.getElementById("n-fail").textContent = fail;
    document.getElementById("cards").innerHTML = html;
    document.getElementById("none").style.display = html? "none":"block";
    document.getElementById("hist").innerHTML = fh || '<div class="empty" style="grid-column:1/-1">no lights flashed yet — every verified flash lands here with its MAC, permanently</div>';
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
                    "roster": STATE["roster"],
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
    ap.add_argument("--bind", default="127.0.0.1",
                    help="bind address; 0.0.0.0 exposes it on the LAN/Tailscale (read-only page)")
    ap.add_argument("--dev-glob", default="/dev/cu.usbmodem*",
                    help="port pattern to watch (override for testing)")
    ap.add_argument("--hold-s", type=int, default=90,
                    help="post-PASS keep-USB-attached hold, seconds (handoff says 90)")
    ap.add_argument("--roster", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "ops", "bench", "data", "usb", "flash-roster-elliot.json"),
        help="durable ledger of flashed lights (MAC, fixture id, verdict); survives restarts")
    args = ap.parse_args()
    CFG.update(jsonl=args.jsonl, expect=args.expect, dev_glob=args.dev_glob,
               hold_s=args.hold_s, roster=os.path.abspath(args.roster))
    load_roster()

    threading.Thread(target=watcher, daemon=True).start()
    srv = ThreadingHTTPServer((args.bind, args.http_port), Handler)
    print(f"Flash Station: http://{args.bind}:{args.http_port}  "
          f"(watching {CFG['dev_glob']}"
          + (f" + {CFG['jsonl']}" if CFG["jsonl"] else ", no JSONL yet") + ")")
    srv.serve_forever()


if __name__ == "__main__":
    main()
