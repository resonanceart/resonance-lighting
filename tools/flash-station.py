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
SERVER_BOOT = str(time.time())
STATE = {
    "ports": {},      # dev path -> {present, first_seen, last_change, excluded}
    "results": {},    # dev path -> latest commission row summary
    "history": [],    # flashed-then-unplugged sessions (internal)
    "roster": {},     # fixture_id -> durable flashed-light ledger (persisted)
    "mesh": {},       # fixture_id -> live heartbeat overlay (via bridge, if plugged)
    "bridge": {"port": None, "mode": None, "last_rx": 0},
}
CFG = {"jsonl": None, "expect": 12, "dev_glob": "/dev/cu.usbmodem*", "hold_s": 90,
       "roster": None, "rescue_dir": None, "shim": None}
_jsonl_offset = 0

# Auto-flash: OFF until the operator arms it from the page with a battery size.
# Never flashes a known bridge or a fixture already recorded as flashed.
KNOWN_BRIDGES = {"E39F1C", "4D5DB0"}  # CoreS3 bridges share the fixture VID/PID
AUTO = {"armed_mah": 0, "batch": None, "last_note": "disarmed"}


def autoflash_tick():
    """MANUAL-TRIGGER flasher (Elliot 08-16: 'only when I click a button on
    the flash station'). Collects ports whose card button was clicked and runs
    ONE batch commission over them. armed_mah is only the battery-size
    setting; nothing fires without a per-light click."""
    if not CFG["rescue_dir"]:
        return
    b = AUTO["batch"]
    if b and b["proc"].poll() is None:
        return  # a batch is running; new plugs join the next one
    if b and b["proc"].poll() is not None:
        AUTO["last_note"] = f"batch of {len(b['ports'])} finished (exit {b['proc'].poll()})"
        AUTO["batch"] = None
    now = time.time()
    with LOCK:
        ready = []
        for dev, p in STATE["ports"].items():
            if not p["present"] or p.get("flashing"):
                continue
            if not p.get("flash_requested"):
                continue  # THE GATE: only Elliot's button click sets this
            usb = p.get("usb")
            if not usb or not usb.get("fixture_hint"):
                continue  # wait until the hardware cross-check identifies it
            if usb["fixture_hint"] in KNOWN_BRIDGES:
                continue
            ready.append(dev)
        if not ready:
            return
        for dev in ready:
            STATE["ports"][dev]["flash_requested"] = False
    mah = AUTO["armed_mah"] or 15000
    cmd = ["python3", CFG["shim"], "commission",
           "--out", CFG["jsonl"], "--append",
           "--build-path", "firmware/fixture/build/fx-260816-prtrel1-b",
           "--sketch-dir", "fixture",
           "--expect-fw", "fx-260816-prtrel1-b",
           "--expect-count", str(len(ready)),
           "--ports", *ready,
           "--max-parallel", str(len(ready)),
           "--wifi-check", "--wifi-parallel", "1",
           "--battery-chemistry", "Generic_LFP",
           "--capacity-mah", str(mah), "--charge-ma", "2000",
           "--maintain-v", "4.6", "--ota-profile", "Party In The Woods",
           "--allow-battery-present"]
    proc = subprocess.Popen(cmd, cwd=CFG["rescue_dir"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    AUTO["batch"] = {"proc": proc, "ports": ready, "started": now}
    AUTO["last_note"] = f"flashing {len(ready)}: " + ", ".join(
        d.split("/")[-1] for d in ready)


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
    # MERGE over the existing entry — operator-added fields (name, counted,
    # note, …) must survive re-flashes AND the restart re-ingest of the JSONL.
    STATE["roster"][key] = {**e, **{
        "fixture_id": summ.get("fixture_id"), "mac": summ.get("mac"),
        "fw": summ.get("fw"), "last_verdict": summ["verdict"],
        "flashed": bool(first_pass), "first_pass_at": first_pass,
        "last_port": dev, "last_row_at": summ.get("row_at"),
    }}
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
                # a re-appearing port may be a DIFFERENT physical light on the
                # same jack — the old verdict/identity must not carry over
                STATE["results"].pop(dev, None)
                p.pop("usb", None)
                p.pop("auto_attempted", None)
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


def _crc16_ccitt(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def _cobs_decode(chunk):
    out = bytearray()
    i = 0
    while i < len(chunk):
        code = chunk[i]
        if code == 0:
            return None
        block = chunk[i + 1:i + code]
        if len(block) != code - 1 or 0 in block:
            return None
        out += block
        i += code
        if code != 0xFF and i < len(chunk):
            out.append(0)
    return bytes(out)


def _ingest_hb(fid, fw, batt_mv, soc, rssi):
    STATE["mesh"][fid] = {
        "heard_at": time.time(), "fw": fw or None,
        "batt_mv": batt_mv, "soc": None if soc in (None, 255) else soc,
        "rssi": rssi,
    }


_NB_PEER = re.compile(
    r"nb-peer id=([0-9A-Fa-f]{6}).*?rssi=(-?\d+).*?bv=([\d.]+).*?soc=(-?\d+)")
_NB_FW = re.compile(r"\bfw=(\S+)")


def _parse_text_line(line):
    m = _NB_PEER.search(line)
    if not m:
        return
    fid = m.group(1).upper()
    fwm = _NB_FW.search(line)
    _ingest_hb(fid, fwm.group(1) if fwm else None,
               int(float(m.group(3)) * 1000), int(m.group(4)), int(m.group(2)))


def _parse_cambium_frame(body):
    # body = ftype + payload + crc16(LE); RADIO_RX(0x02) = mac[6] rssi raw...
    if len(body) < 3 or _crc16_ccitt(body[:-2]) != body[-2] | (body[-1] << 8):
        return
    ftype, payload = body[0], body[1:-2]
    if ftype != 0x02 or len(payload) < 7 + 24:
        return
    raw, rssi = payload[7:], int.from_bytes(payload[6:7], "little", signed=True)
    if len(raw) < 24 or raw[0] != 1 or raw[1] != 1:  # proto ver 1, NB_HEARTBEAT
        return
    fid = raw[2:5].hex().upper()
    batt_mv = int.from_bytes(raw[13:15], "little", signed=True)
    soc = raw[17]
    fw = None
    if len(raw) >= 83:  # fw_rev[24] tail at offset 59
        fw = raw[59:83].split(b"\0")[0].decode("ascii", "replace") or None
    _ingest_hb(fid, fw, batt_mv, soc, rssi)


def bridge_reader(dev):
    """Listen-only serial reader for the CoreS3 bridge — auto-detects Ben's
    text mode (nb-* ASCII lines) vs cambium binary mode (COBS+CRC frames).
    Never writes a byte to the port."""
    try:
        import serial
        s = serial.Serial(dev, 115200, timeout=2)
    except Exception as e:
        STATE["bridge"] = {"port": None, "mode": f"open failed: {e!r}", "last_rx": 0}
        return
    STATE["bridge"] = {"port": dev, "mode": "sniffing", "last_rx": 0}
    buf = bytearray()
    mode = None
    while STATE["ports"].get(dev, {}).get("present"):
        try:
            data = s.read(4096)
        except Exception:
            break
        if not data:
            continue
        STATE["bridge"]["last_rx"] = time.time()
        buf += data
        if mode is None and len(buf) > 64:
            mode = "cambium" if 0 in buf[:256] and any(b > 127 for b in buf[:256]) else "text"
            STATE["bridge"]["mode"] = mode
        if mode == "text" or mode is None:
            while b"\n" in buf:
                line, _, rest = bytes(buf).partition(b"\n")
                buf = bytearray(rest)
                try:
                    _parse_text_line(line.decode("utf-8", "replace"))
                except Exception:
                    pass
        elif mode == "cambium":
            while b"\0" in buf:
                chunk, _, rest = bytes(buf).partition(b"\0")
                buf = bytearray(rest)
                if chunk:
                    decoded = _cobs_decode(chunk)
                    if decoded:
                        try:
                            _parse_cambium_frame(decoded)
                        except Exception:
                            pass
        if len(buf) > 65536:
            buf = bytearray()
    try:
        s.close()
    except Exception:
        pass
    STATE["bridge"] = {"port": None, "mode": "disconnected", "last_rx": 0}


def maybe_start_bridge():
    if STATE["bridge"]["port"]:
        return
    with LOCK:
        for dev, p in STATE["ports"].items():
            if not p["present"]:
                continue
            usb = p.get("usb") or {}
            if usb.get("fixture_hint") in KNOWN_BRIDGES:
                STATE["bridge"] = {"port": dev, "mode": "starting", "last_rx": 0}
                threading.Thread(target=bridge_reader, args=(dev,), daemon=True).start()
                return


def run_checkup(dev):
    """Component health check over the fixture's USB serial `t` verb.
    Read-only (telemetry request). Stores structured verdicts per fixture."""
    import serial as pyserial
    try:
        s = pyserial.Serial(dev, 115200, timeout=3)
        time.sleep(0.4)
        s.reset_input_buffer()
        s.write(b"t")
        time.sleep(1.5)
        raw = s.read(32768).decode("utf-8", "replace")
        s.close()
    except Exception as e:
        return {"error": f"serial: {e!r}"}
    line = next((l for l in raw.splitlines() if l.strip().startswith("{")), None)
    if not line:
        return {"error": "no telemetry reply (board asleep or mid-boot?)"}
    try:
        t = json.loads(line)
    except json.JSONDecodeError:
        return {"error": "garbled telemetry"}

    def item(label, ok, detail):
        return {"label": label, "ok": ok, "detail": detail}
    bv = float(t.get("battery_v") or 0)
    ma = float(t.get("battery_ma") or 0)
    checks = [
        item("firmware", bool(t.get("fw")), f"{t.get('fw')} · ota {t.get('ota_state','?')}"),
        item("battery", bool(t.get("battery_present")),
             (f"{bv:.3f} V @ {ma:+.0f} mA · "
              + ("charging" if ma > 20 else "discharging" if ma < -20 else "idle")
              + (f" · SoC {t['soc_pct']}%" if t.get("soc_pct") not in (None, 255) else " · gauge n/a"))
             if t.get("battery_present") else "NOT DETECTED (lead unseated or BMS lockout)"),
        item("charger (BQ25628E)", bool(t.get("supply_good")) and not t.get("bq_fault0"),
             f"supply {t.get('supply_v')} V / {t.get('supply_ma')} mA · fault0 {t.get('bq_fault0')} · charging_enabled {t.get('charging_enabled')}"),
        item("LED rail", t.get("led_rail_on") is not None,
             f"rail {'ON' if t.get('led_rail_on') else 'off'} · guard_stage {t.get('guard_stage')} (color check = human eyes)"),
        item("radio (ESP-NOW)", bool(t.get("espnow_up")),
             f"channel {t.get('channel')} · profile {t.get('profile')} · class {t.get('fixture_class')}"),
        item("motion (MSA311)", None if not t.get("msa311_present") else bool(t.get("msa_read_ok")),
             f"tilt {t.get('tilt_deg')}° · sway {t.get('sway_env_g')} g" if t.get("msa311_present") else "not fitted on this class"),
        item("ToF depth (TMF8820)", None if not t.get("tmf8820_present") else bool(t.get("tmf_read_ok")),
             f"depth {t.get('tof_depth_mm')} mm · conf {t.get('tof_confidence')} · errors {t.get('tmf_errors')}" if t.get("tmf8820_present") else "not fitted on this class"),
        item("ToF zones (VL53L5CX)", None if not t.get("vl53l5cx_present") else bool(t.get("vl_read_ok")),
             f"closest {t.get('vl_closest_mm')} mm · zones {t.get('vl_zones')}" if t.get("vl53l5cx_present") else "not fitted on this class"),
        item("pressure/temp (BMP581)", None if not t.get("bmp581_present") else bool(t.get("bmp_read_ok")),
             f"{t.get('bmp_temp_c')} °C · {t.get('bmp_pressure_hpa')} hPa" if t.get("bmp581_present") else "not fitted on this class"),
        item("solenoid gate", None if not t.get("solenoid_enabled") else True,
             f"strikes {t.get('solenoid_strikes')} · blocked {t.get('solenoid_blocked')} · failsafes {t.get('solenoid_failsafes')}" if t.get("solenoid_enabled") else "disabled/not fitted"),
        item("memory/flash", (t.get("flash_bytes") or 0) >= 8 * 1024**2,
             f"flash {round((t.get('flash_bytes') or 0)/1024**2)} MB · psram {round((t.get('psram_bytes') or 0)/1024**2)} MB · heap {t.get('heap_free')}"),
        item("laser", None, "none fitted — no fixture carries a laser (ToF sensors use internal Class-1 VCSELs)"),
    ]
    return {"fixture_id": t.get("fixture_id"), "at": time.time(), "checks": checks,
            "reset_reason": t.get("reset_reason")}


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
        for step in (poll_ports, poll_jsonl, detect_flashing, autoflash_tick,
                     maybe_start_bridge):
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
.flashbtn{background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 14px;
font-weight:700;font-size:.85rem;cursor:pointer;font-family:inherit}
.flashbtn:hover{filter:brightness(1.15)}
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
 <div class="stat" style="min-width:220px"><b id="auto-state" style="font-size:.95rem">MANUAL FLASH</b>
  <span id="auto-note">flash fires only from a card's ⚡ button</span>
  <div style="margin-top:6px;display:flex;gap:6px">
   <button class="ex" onclick="arm(15000)">battery: 15 Ah</button>
   <button class="ex" onclick="arm(6000)">battery: 6 Ah</button>
  </div>
 </div>
</div>
<h2>Plugged in now</h2>
<div class="cards" id="cards"></div>
<div id="none" class="empty" style="display:none">Nothing on USB. Plug a light in — it appears here within a second.</div>
<h2>Successfully flashed</h2>
<div class="cards" id="hist"></div>
<p class="note"><b>Flash-from-any-state protocol</b> (Ben's failure ladder): ① plug in — an awake board appears here in ~2 s → click its ⚡ button · ② nothing appears = chip asleep/parked: <b>hold BOOT, tap RESET, release BOOT</b> — bootloader can't sleep, board appears and stays · ③ still nothing: swap to a known-good data cable, then a direct Mac port · ④ still nothing: set the board aside — that's a hardware fault, not a flashing problem. After PASS: dark is normal for a parked board — it needs battery ≥3.10 V + 60 s healthy charge, then it reboots itself to <b>steady red</b>. Red = done, unplug.</p>
<p class="note">PASS comes from the batch tool's evidence JSONL and the light's own report-back (serial + WiFi). The CoreS3 bridge is auto-protected (never flashed) — plug it in anytime for live mesh badges. 🩺 CHECKUP tests each component the board carries: battery, charger, LED rail, radio, motion, ToF, pressure/temp, solenoid. (No fixture carries a laser.)</p>
<script>
const HOLD = %%HOLD%%;
const MY_BOOT = "%%BOOT%%";   // page auto-reloads when the server restarts,
let reloading = false;        // so UI updates always reach the operator
let excluded = {};
function fmtAge(s){ if(s<60) return Math.floor(s)+"s"; if(s<3600) return Math.floor(s/60)+"m"; return Math.floor(s/3600)+"h"; }
let s_roster = {};
let s_checkups = {};
async function doflash(dev){ await fetch("/flash",{method:"POST",body:JSON.stringify({dev})}); tick(); }
async function docheck(dev){ await fetch("/checkup",{method:"POST",body:JSON.stringify({dev})}); tick(); }
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
      kv += `<div class="hold ok">✓ flashed — when the light shows STEADY RED, unplug it</div>`;
    }
  } else if(flashing){
    kv += `<div class="hold">⚡ upload in progress — do not unplug</div>`;
  } else if(p.flash_requested){
    kv += `<div class="hold">⚡ queued — starting…</div>`;
  } else if(!r && p.usb && p.usb.fixture_hint){
    kv += `<div class="kv">identified — your move</div>`;
  }
  if(!flashing && !p.flash_requested && p.usb && p.usb.fixture_hint){
    const done = (s_roster[p.usb.fixture_hint]||{}).flashed;
    kv += `<div style="margin-top:8px;display:flex;gap:8px"><button class="flashbtn" onclick="doflash('${dev}')">${done? "⚡ RE-FLASH" : "⚡ FLASH THIS LIGHT"}</button><button class="flashbtn" style="background:var(--card);color:var(--accent);border:1px solid var(--accent)" onclick="docheck('${dev}')">🩺 CHECKUP</button></div>`;
    const cu = (s_checkups||{})[p.usb.fixture_hint];
    if(cu && cu.checks){
      kv += `<div class="kv" style="margin-top:8px"><b>components</b> (checked ${fmtAge(Date.now()/1000-cu.at)} ago):</div>`;
      for(const c of cu.checks){
        const mark = c.ok===true? "✅" : c.ok===false? "❌" : "▫️";
        kv += `<div class="kv mono">${mark} ${c.label}: ${c.detail}</div>`;
      }
    }
  }
  const age = fmtAge(Date.now()/1000 - (p.last_change||p.first_seen));
  const ex = excluded[dev] ? "true":"false";
  return `<div class="cardp ${cls}"><button class="ex" aria-pressed="${ex}" onclick="tog('${dev}')">bridge?</button><h3>${dev.split("/").pop().replace(/^cu\\./,"")}</h3>
    <span class="chip ${cls}">${chip}</span> <span class="kv" style="display:inline">for ${age}</span>${kv}</div>`;
}
function tog(dev){ excluded[dev]=!excluded[dev]; tick(); }
async function arm(mah){ await fetch("/arm",{method:"POST",body:String(mah)}); tick(); }
async function rename(fid, cur){
  const name = prompt("Nickname for "+fid+":", cur||"");
  if(name===null) return;
  await fetch("/name",{method:"POST",body:JSON.stringify({fid,name})}); tick();
}
async function tick(){
  try{
    const s = await (await fetch("/state")).json();
    if(s.server_boot && s.server_boot !== MY_BOOT && !reloading){ reloading = true; location.reload(); return; }
    document.getElementById("src").textContent = s.jsonl ? " · " + s.jsonl.split("/").pop() : "";
    document.getElementById("lbl-pass").textContent = "flashed ✓ / " + s.expect;
    let conn=0, html="";
    for(const [dev,p] of Object.entries(s.ports)){
      if(!p.present) continue;
      if(!excluded[dev]) conn++;
      html += liveCard(dev,p,s.results[dev]);
    }
    let pass=0, fail=0, fh="";
    // flash order: oldest first, numbered — the sequence the batch happened in
    const entries = Object.entries(s.roster||{}).sort((a,b)=> (a[1].first_pass_at||"9999").localeCompare(b[1].first_pass_at||"9999"));
    let seq = 0;
    for(const [k,e] of entries){
      const excluded = e.counted === false;
      if(e.flashed && !excluded) pass++; else if(!e.flashed) fail++;
      const cls = excluded? "partial" : e.flashed? "pass" : "fail";
      const n = (e.flashed && !excluded)? ++seq : null;
      const when = e.first_pass_at? new Date(e.first_pass_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}) : null;
      const m = (s.mesh||{})[k];
      const fresh = m && (Date.now()/1000 - m.heard_at) < 30;
      let mesh = "";
      if(fresh){
        mesh = `<div class="kv" style="color:var(--green)">🔴 ON MESH · running <b class="mono">${m.fw||"fw n/a (short hb)"}</b> · ${(m.batt_mv/1000).toFixed(2)} V · heard ${Math.round(Date.now()/1000-m.heard_at)}s ago</div>`;
      } else if(m){
        mesh = `<div class="kv">last mesh contact ${fmtAge(Date.now()/1000-m.heard_at)} ago</div>`;
      }
      const title = e.name? `${e.name} <span class="kv mono" style="display:inline">${e.fixture_id||k}</span>` : (e.fixture_id||k);
      fh += `<div class="cardp ${cls}"><button class="ex" onclick="rename('${k}','${(e.name||"").replace(/'/g,"")}')">✎ name</button><h3>${n? "#"+n+" · ":""}${title}</h3><span class="chip ${cls}">${excluded? "SET ASIDE" : e.flashed?"FLASHED ✓":"FAILED"}</span>${when? `<span class="kv" style="display:inline"> at ${when}</span>`:""}${excluded&&e.note? `<div class="kv" style="color:var(--amber)">${e.note}</div>`:""}
        <div class="kv">mac <b class="mono">${e.mac||"?"}</b></div>
        <div class="kv">flashed fw <span class="mono">${e.fw||"?"}</span></div>${mesh}</div>`;
    }
    const br = s.bridge||{};
    if(br.port){
      document.getElementById("auto-note").textContent = (s.auto.note||"") + " · 🌉 bridge listening (" + (br.mode||"?") + ")";
    }
    s_roster = s.roster||{};
    s_checkups = s.checkups||{};
    const a = s.auto||{};
    document.getElementById("auto-state").textContent = "MANUAL · " + ((a.armed_mah||15000)/1000) + " Ah";
    document.getElementById("auto-note").textContent = a.note||"flash fires only from a card's ⚡ button";
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
                    "auto": {"armed_mah": AUTO["armed_mah"], "note": AUTO["last_note"],
                             "auto_available": bool(CFG["rescue_dir"])},
                    "mesh": STATE["mesh"],
                    "bridge": STATE["bridge"],
                    "server_boot": SERVER_BOOT,
                    "checkups": STATE.get("checkups", {}),
                }
            self._send(json.dumps(payload), "application/json")
        else:
            self._send(PAGE.replace("%%HOLD%%", str(CFG["hold_s"]))
                       .replace("%%BOOT%%", SERVER_BOOT), "text/html; charset=utf-8")

    def do_POST(self):
        if self.path.startswith("/arm"):
            try:
                n = int(self.rfile.read(int(self.headers.get("Content-Length", 0))
                                        ).decode() or "0")
            except ValueError:
                n = 0
            AUTO["armed_mah"] = n if n in (6000, 15000) else 0
            AUTO["last_note"] = f"battery size: {(AUTO['armed_mah'] or 15000)} mAh — flash fires only on a card's ⚡ button"
            self._send(json.dumps({"armed_mah": AUTO["armed_mah"]}), "application/json")
        elif self.path.startswith("/checkup"):
            try:
                body = json.loads(self.rfile.read(
                    int(self.headers.get("Content-Length", 0))).decode() or "{}")
                dev = str(body["dev"])
            except (ValueError, KeyError):
                self._send('{"ok":false}', "application/json")
                return
            p = STATE["ports"].get(dev)
            if not p or not p["present"] or p.get("flashing"):
                self._send('{"ok":false,"err":"port not available (absent or flashing)"}',
                           "application/json")
                return
            result = run_checkup(dev)
            fid = result.get("fixture_id") or (p.get("usb") or {}).get("fixture_hint")
            if fid:
                STATE.setdefault("checkups", {})[fid] = result
            self._send(json.dumps({"ok": "error" not in result, **result}), "application/json")
        elif self.path.startswith("/flash"):
            try:
                body = json.loads(self.rfile.read(
                    int(self.headers.get("Content-Length", 0))).decode() or "{}")
                dev = str(body["dev"])
            except (ValueError, KeyError):
                self._send('{"ok":false}', "application/json")
                return
            with LOCK:
                p = STATE["ports"].get(dev)
                ok = bool(p and p["present"]
                          and (p.get("usb") or {}).get("fixture_hint") not in KNOWN_BRIDGES)
                if ok:
                    p["flash_requested"] = True
            self._send(json.dumps({"ok": ok}), "application/json")
        elif self.path.startswith("/name"):
            try:
                body = json.loads(self.rfile.read(
                    int(self.headers.get("Content-Length", 0))).decode() or "{}")
                fid, name = str(body["fid"]).upper(), str(body.get("name", "")).strip()[:40]
            except (ValueError, KeyError):
                self._send('{"ok":false}', "application/json")
                return
            with LOCK:
                if fid in STATE["roster"]:
                    STATE["roster"][fid]["name"] = name or None
                    save_roster()
                    self._send(json.dumps({"ok": True, "fid": fid, "name": name}),
                               "application/json")
                else:
                    self._send('{"ok":false,"err":"fixture not in roster"}',
                               "application/json")
        else:
            self._send("{}", "application/json")


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
    ap.add_argument("--rescue-dir", default=os.path.expanduser("~/code/resonance-usb-rescue"),
                    help="Ben's rescue worktree (build + batch tool); auto-flash disabled if absent")
    ap.add_argument("--roster", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "ops", "bench", "data", "usb", "flash-roster-elliot.json"),
        help="durable ledger of flashed lights (MAC, fixture id, verdict); survives restarts")
    args = ap.parse_args()
    rescue = os.path.abspath(os.path.expanduser(args.rescue_dir))
    shim = os.path.join(os.path.dirname(os.path.abspath(__file__)), "usb-bringup-mac.py")
    CFG.update(jsonl=os.path.abspath(os.path.expanduser(args.jsonl)) if args.jsonl else None,
               expect=args.expect, dev_glob=args.dev_glob,
               hold_s=args.hold_s, roster=os.path.abspath(args.roster),
               rescue_dir=rescue if (os.path.isdir(rescue) and os.path.isfile(shim)
                                     and args.jsonl) else None,
               shim=shim)
    load_roster()

    threading.Thread(target=watcher, daemon=True).start()
    srv = ThreadingHTTPServer((args.bind, args.http_port), Handler)
    print(f"Flash Station: http://{args.bind}:{args.http_port}  "
          f"(watching {CFG['dev_glob']}"
          + (f" + {CFG['jsonl']}" if CFG["jsonl"] else ", no JSONL yet") + ")")
    srv.serve_forever()


if __name__ == "__main__":
    main()
