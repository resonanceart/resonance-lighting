#!/usr/bin/env python3
"""Bridge waiter — launches Ben's fleet dashboard the moment a bridge lands on USB.

The bench doctrine (Elliot, 08-16): BEN'S net_bench_dashboard is THE fleet view;
the flash station never grows its own. This waiter closes the gap between "plug
the bridge in" and "dashboard is up" without a human terminal step:

  1. Polls system_profiler for a USB device whose serial ends in a known CoreS3
     bridge MAC (E39A34 bench / E39F1C / 4D5DB0). NEVER opens a serial port and
     NEVER runs esptool while looking — identity comes from USB descriptors
     only, so a sleeping fixture can't be reset by the search.
  2. Maps the device to its /dev/cu.usbmodem* node (locationID prefix match,
     longest prefix wins — same trap-hardened logic as the flash station).
  3. Launches Ben's ops/bench/net_bench_dashboard.py from the deep-recovery-
     canary checkout as the SINGLE serial reader (the station's own
     bridge_reader stays opt-in OFF: two readers on one serial = byte-split
     garbage, learned 08-16) and verifies :8765 answers before reporting up.

Usage:
  python3 tools/bridge-dashboard-waiter.py                # wait, then launch
  python3 tools/bridge-dashboard-waiter.py --timeout 900  # give up after 15 min
  python3 tools/bridge-dashboard-waiter.py --selftest     # prove detection on
                                                          # canned payloads (no hardware)

Known-inert: the 1f1edfd dashboard's dark-lease button needs bridge fw
2026-08-17.1; bench bridge E39A34 runs 08-15.1 — reflash is Ben's call.
"""

import argparse
import glob
import json
import os
import subprocess
import sys
import time
import urllib.request

BRIDGES = {"E39A34", "E39F1C", "4D5DB0"}  # CoreS3 bridge MAC tails
DASH_DIR = os.path.expanduser("~/code/resonance-fleet-dash")
DASH = os.path.join(DASH_DIR, "ops", "bench", "net_bench_dashboard.py")
LOG = "/tmp/net-bench-dashboard.log"
HTTP = "http://127.0.0.1:8765"


def usb_devices(payload=None):
    """[{loc, serial}] from system_profiler JSON (or an injected test payload)."""
    if payload is None:
        try:
            out = subprocess.run(
                ["system_profiler", "SPUSBDataType", "-json"],
                capture_output=True, text=True, timeout=15).stdout
            payload = json.loads(out)
        except Exception:
            return []
    found = []

    def walk(items):
        for it in items or []:
            loc = it.get("location_id", "")
            if loc:
                # 0x03110000 -> "311": port names drop leading AND trailing zeros
                hexpart = (loc.split("/")[0].strip().lower()
                           .replace("0x", "").strip("0") or "0")
                found.append({"loc": hexpart, "serial": it.get("serial_num") or ""})
            walk(it.get("_items"))
    for bus in payload.get("SPUSBDataType", []):
        walk(bus.get("_items"))
    return found


def find_bridge(devices, ports):
    """(port, mac_tail) for the first known bridge among devices, else None.

    ports: candidate /dev/cu.usbmodem* nodes. Longest locationID prefix wins —
    a parent hub's shorter prefix also matches (flash-station trap, 08-16).
    """
    import re
    for d in devices:
        hexonly = re.sub(r"[^0-9A-Fa-f]", "", d["serial"])
        tail = hexonly[-6:].upper() if len(hexonly) >= 6 else ""
        if tail not in BRIDGES:
            continue
        best, best_len = None, -1
        for port in ports:
            m = re.search(r"usbmodem(\w+)$", port)
            digits = m.group(1).lower() if m else ""
            if digits.startswith(d["loc"]) and len(d["loc"]) > best_len:
                best, best_len = port, len(d["loc"])
        if best:
            return best, tail
    return None


def selftest():
    fake = {"SPUSBDataType": [{"_items": [
        {"location_id": "0x03110000 / 1", "serial_num": "44:1B:F6:E3:9A:34",
         "_name": "CoreS3"},
        {"location_id": "0x03120000 / 2", "serial_num": "68:EE:8F:F4:03:84",
         "_name": "PowerFeather"},  # a fixture — must NOT match
    ]}]}
    devs = usb_devices(fake)
    # positive: bridge present → its port (and only its port) is chosen
    hit = find_bridge(devs, ["/dev/cu.usbmodem311", "/dev/cu.usbmodem312"])
    assert hit == ("/dev/cu.usbmodem311", "E39A34"), f"positive failed: {hit}"
    # negative: no bridge on the bus → no launch
    no_bridge = {"SPUSBDataType": [{"_items": [
        {"location_id": "0x03120000 / 2", "serial_num": "68:EE:8F:F4:03:84"}]}]}
    assert find_bridge(usb_devices(no_bridge), ["/dev/cu.usbmodem312"]) is None, \
        "negative failed: matched a fixture as a bridge"
    # negative: bridge on the bus but its port not enumerated yet → keep waiting
    assert find_bridge(devs, ["/dev/cu.usbmodem999"]) is None, \
        "negative failed: matched a port the bridge is not behind"
    print("selftest OK: bridge matched to its own port; fixture and "
          "missing-port cases both refused")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--timeout", type=int, default=0,
                    help="seconds to wait for a bridge (0 = forever)")
    ap.add_argument("--poll", type=float, default=3.0)
    ap.add_argument("--bind", default="0.0.0.0",
                    help="dashboard bind (0.0.0.0 = LAN/phone, Ben's recipe)")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        selftest()
        return
    if not os.path.isfile(DASH):
        sys.exit(f"Ben's dashboard not found: {DASH} — is the "
                 f"resonance-fleet-dash worktree at deep-recovery-canary?")
    print(f"waiting for a CoreS3 bridge ({'/'.join(sorted(BRIDGES))}) on USB…",
          flush=True)
    start = time.time()
    while True:
        hit = find_bridge(usb_devices(), glob.glob("/dev/cu.usbmodem*"))
        if hit:
            break
        if args.timeout and time.time() - start > args.timeout:
            sys.exit("no bridge appeared — timed out")
        time.sleep(args.poll)
    port, tail = hit
    print(f"bridge {tail} on {port} — launching Ben's dashboard", flush=True)
    with open(LOG, "ab") as log:
        subprocess.Popen(
            [sys.executable, DASH, "--port", port, "--bind", args.bind],
            cwd=DASH_DIR, stdout=log, stderr=log)
    for _ in range(20):
        time.sleep(1)
        try:
            urllib.request.urlopen(HTTP + "/", timeout=2)
            print(f"UP: {HTTP} (log: {LOG}) — dark-lease button is inert "
                  f"through {tail}" if tail == "E39A34" else f"UP: {HTTP}")
            return
        except Exception:
            continue
    sys.exit(f"dashboard did not answer on :8765 within 20 s — see {LOG}")


if __name__ == "__main__":
    main()
