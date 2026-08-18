#!/usr/bin/env python3
"""Fleet events ear — the listening agent's standing awareness of the fleet.

Elliot (2026-08-18): "We are the listening agent, we should always know what is
happening with the fleet." Diffs successive /api/state snapshots from Ben's
dashboard and turns them into EVENTS — the things an operator actually wants to
know the moment they happen:

  FW-CHANGE   fixture now reports a different firmware_rev (OTA landed)
  REBOOT      uptime_ms dropped (with reset_reason — software = OTA/commanded)
  NEW-PEER    id never seen this run
  GONE        was fresh, silent > 120 s (sleep, maint trip, or trouble)
  RETURNED    was GONE, heard again
  MAINT       maint_status transition (OTA window entry/exit)
  SERIAL      bridge ear connected/disconnected (feed-trust boundary)

Read-only GETs only; never touches serial. Events append to a durable JSONL
(default /tmp/fleet-events.jsonl) and print to stdout.

  python3 tools/fleet-events.py --follow          # daemon: log forever
  python3 tools/fleet-events.py --wake            # exit on first event batch
                                                  # (session wire: exit wakes agent)
  python3 tools/fleet-events.py --selftest        # prove change AND no-change paths
"""

import argparse
import json
import sys
import time
import urllib.request

URL = "http://127.0.0.1:8765/api/state"
GONE_S = 120


def snapshot(url=URL):
    with urllib.request.urlopen(url, timeout=5) as r:
        return json.load(r)


def diff(prev, cur, now):
    """(events, next_prev). prev/cur: {id: {fw, up, rr, mt, last_heard}} + _serial."""
    ev = []
    if prev.get("_serial") != cur.get("_serial"):
        ev.append({"event": "SERIAL", "connected": cur.get("_serial")})
    for pid, c in cur.items():
        if pid.startswith("_"):
            continue
        p = prev.get(pid)
        if p is None:
            if prev:  # suppress the flood on first snapshot
                ev.append({"event": "NEW-PEER", "id": pid, "fw": c["fw"]})
            continue
        if p.get("gone") and not c.get("gone"):
            ev.append({"event": "RETURNED", "id": pid, "fw": c["fw"]})
        if not p.get("gone") and c.get("gone"):
            ev.append({"event": "GONE", "id": pid, "fw": c["fw"],
                       "silent_s": int(now - c["last_heard"])})
        if c["fw"] and p["fw"] and c["fw"] != p["fw"]:
            ev.append({"event": "FW-CHANGE", "id": pid, "from": p["fw"], "to": c["fw"]})
        if (c["up"] or 0) + 60000 < (p["up"] or 0):
            ev.append({"event": "REBOOT", "id": pid, "reset_reason": c["rr"],
                       "fw": c["fw"]})
        if c["mt"] != p["mt"] and (c["mt"] or p["mt"]):
            ev.append({"event": "MAINT", "id": pid, "from": p["mt"], "to": c["mt"]})
    return ev


def condense(payload, prev, now):
    cur = {"_serial": bool((payload.get("serial") or {}).get("connected"))}
    for pid, v in (payload.get("peers") or {}).items():
        ts = v.get("ts_utc") or ""
        # freshness by the row's own ts (contract: row replaced per heartbeat);
        # fall back to carrying prev's last_heard when parse fails
        try:
            heard = time.mktime(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S"))
        except (ValueError, TypeError):
            heard = (prev.get(pid) or {}).get("last_heard", now)
        cur[pid] = {"fw": v.get("firmware_rev"), "up": v.get("uptime_ms"),
                    "rr": v.get("reset_reason"), "mt": v.get("maint_status"),
                    "last_heard": heard, "gone": (now - heard) > GONE_S}
    return cur


def selftest():
    now = 1000000.0
    a = {"_serial": True,
         "AAAAAA": {"fw": "fx-1", "up": 500000, "rr": "poweron", "mt": None,
                    "last_heard": now, "gone": False}}
    same = json.loads(json.dumps(a))
    assert diff(a, same, now) == [], "no-change must produce zero events"
    b = json.loads(json.dumps(a))
    b["AAAAAA"].update(fw="fx-2", up=30000, rr="software")
    b["BBBBBB"] = {"fw": "fx-2", "up": 1000, "rr": "poweron", "mt": None,
                   "last_heard": now, "gone": False}
    got = {e["event"] for e in diff(a, b, now)}
    assert got == {"FW-CHANGE", "REBOOT", "NEW-PEER"}, f"change path wrong: {got}"
    c = json.loads(json.dumps(a))
    c["_serial"] = False
    c["AAAAAA"]["gone"] = True
    got2 = {e["event"] for e in diff(a, c, now)}
    assert got2 == {"SERIAL", "GONE"}, f"loss path wrong: {got2}"
    print("selftest OK: no-change silent; fw/reboot/new detected; serial-drop + gone detected")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--url", default=URL)
    ap.add_argument("--log", default="/tmp/fleet-events.jsonl")
    ap.add_argument("--poll", type=float, default=5.0)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--follow", action="store_true")
    mode.add_argument("--wake", action="store_true")
    mode.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        selftest()
        return
    prev = {}
    while True:
        now = time.time()
        try:
            cur = condense(snapshot(args.url), prev, now)
        except Exception as e:
            cur = dict(prev, _serial=False) if prev else {"_serial": False}
            if prev.get("_serial") is not False:
                print(f"feed unreachable: {e!r}", flush=True)
        events = diff(prev, cur, now) if prev else []
        if events:
            stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
            for e in events:
                e["at"] = stamp
                print(json.dumps(e), flush=True)
            # only --follow owns the durable log: a concurrent --wake wire
            # writing the same file produced duplicate rows (seen live 08-18)
            if args.follow:
                with open(args.log, "a", encoding="utf-8") as f:
                    for e in events:
                        f.write(json.dumps(e) + "\n")
            if args.wake:
                return
        prev = cur
        time.sleep(args.poll)


if __name__ == "__main__":
    main()
