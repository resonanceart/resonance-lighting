#!/usr/bin/env python3
"""Mirror state-contract checker — the acceptance gate for 26-MIRROR-STATE-CONTRACT.md.

Elliot's protocol (08-17): test everything BEFORE building on it. No Mirror
store/type ships against Ben's /api/state without a green run of this checker.
Pinned to net_bench_dashboard.py @ upstream codex/deep-recovery-canary 1f1edfd —
if Ben's dashboard moves, re-pin the doc and update the field tables here.

  python3 tools/mirror-contract-check.py                 # validate live :8765
  python3 tools/mirror-contract-check.py --url http://host:8766/api/state
  python3 tools/mirror-contract-check.py --selftest      # prove it can FAIL

Verdicts: exit 0 = shape matches the pinned contract (warnings allowed —
unknown keys mean Ben added fields, time to re-pin). exit 1 = violation or
feed unreachable. Deliberately stdlib-only and simple (Elliot: keep code
simple); Mirror may vendor this file verbatim.
"""

import argparse
import json
import sys
import urllib.request

NUM = (int, float)
# name -> (types, nullable)
CORE = {
    "id": (str, False), "seq": (int, False), "rx": (int, False),
    "gaps": (int, False), "pdr": (NUM, False), "rssi_dbm": (int, False),
    "battery_v": (NUM, False), "battery_ma": (int, False), "battery_w": (NUM, False),
    "soc_pct": (int, False), "reset_reason": (str, False), "ca_state": (int, False),
    "peer_mode": (int, False), "dl_pdr": (NUM, False), "dl_rssi_dbm": (int, False),
    "uptime_ms": (int, False), "age_ms": (int, False), "ts_utc": (str, False),
    "supply_v": (NUM, True), "supply_ma": (int, True), "supply_good": (bool, True),
    "supply_w": (NUM, True), "lux": (NUM, True), "light_sat": (bool, True),
    "light_ch0": (int, True), "light_ch1": (int, True), "panel_temp_c": (NUM, True),
    "panel_rh_pct": (int, True), "batt_temp_c": (NUM, True),
    "ina_panel_mv": (NUM, True), "ina_panel_ma": (NUM, True), "ina_panel_w": (NUM, True),
    "ina_batt_mv": (NUM, True), "ina_batt_ma": (NUM, True),
    "config_capacity_mah": (int, True), "config_charge_ma": (int, True),
    "drawdown_mah": (NUM, True), "drawdown_budget_mah": (int, True),
    "drawdown_active": (bool, True), "firmware_rev": (str, True),
    "firmware_rev_age_ms": (int, True),  # NEW @ 049cc10 — ms since fw identity last CARRIED in a hb
    "maint_status": (int, True), "field_phase": (int, True), "field_reason": (int, True),
    "field_cycle": (int, True), "field_elapsed_s": (int, True),
    "field_charge_mah": (int, True), "field_discharge_mah": (int, True),
    "field_min_mv": (int, True), "field_max_mv": (int, True),
    "profile": (int, True), "life_state": (int, True), "power_tier": (int, True),
    "active_program": (int, True), "night_min": (int, True),
    "fixture_class": (int, True), "led_rail_on": (bool, True),
    "led_r": (int, True), "led_g": (int, True), "led_b": (int, True),
    "led_w": (int, True), "led_lit_pixels": (int, True), "sensor_bits": (int, True),
    "class_mismatch": (bool, True), "recovery_state": (int, True),
    "recovery_detect_mv": (int, True), "load_w": (NUM, True),
}
BLOCKS = {
    "bq": ["bq_vindpm_mv", "bq_ichg_ma", "bq_vreg_mv", "bq_reg16", "bq_reg18",
           "bq_stat0", "bq_stat1", "bq_fault0", "bq_flag0", "bq_flag1",
           "bq_fault_flag0", "bq_part", "bq_chg_en", "bq_en_hiz",
           "bq_batfet_ctrl", "bq_vbus_stat", "bq_chg_stat"],
    "field_energy": ["field_charge_wh", "field_discharge_wh", "field_peak_panel_w",
                     "field_peak_charge_w", "field_peak_draw_w", "field_low_s",
                     "field_charge_min", "field_wait_min", "field_draw_min",
                     "field_protect_min"],
    "mppt": ["mppt_status", "mppt_reason", "mppt_runs", "mppt_active_v",
             "mppt_best_v", "mppt_last_v", "mppt_p46_w", "mppt_p48_w", "mppt_p50_w"],
    "load_guard": ["field_load_dimmed", "field_protect_latched"],
}
KNOWN = set(CORE) | {f for fs in BLOCKS.values() for f in fs}
TOP = {"ts_utc", "serial", "master", "peers", "scans", "raw", "last_command"}


def check_type(v, types):
    if isinstance(v, bool) and types is not bool and bool not in (
            types if isinstance(types, tuple) else (types,)):
        return False  # bool is an int subclass — reject where int/num expected
    return isinstance(v, types)


def validate(payload):
    errors, warnings = [], []
    missing_top = TOP - set(payload)
    if missing_top:
        errors.append(f"top-level keys missing: {sorted(missing_top)}")
        return errors, warnings, 0
    serial = payload["serial"]
    for k in ("port", "connected"):
        if k not in serial:
            errors.append(f"serial block missing '{k}'")
    if serial.get("connected") is False:
        warnings.append(f"serial.connected=false (error={serial.get('error')}) — "
                        f"feed is up but the bridge ear is not")
    peers = payload["peers"]
    if not isinstance(peers, dict):
        errors.append("peers is not a dict")
        return errors, warnings, 0
    unknown = set()
    for pid, row in peers.items():
        for name, (types, nullable) in CORE.items():
            if name not in row:
                errors.append(f"{pid}: core field '{name}' MISSING")
            elif row[name] is None:
                if not nullable:
                    errors.append(f"{pid}: never-null field '{name}' is null")
            elif not check_type(row[name], types):
                errors.append(f"{pid}: '{name}' wrong type {type(row[name]).__name__}")
        for bname, fields in BLOCKS.items():
            got = [f for f in fields if f in row]
            if got and len(got) != len(fields):
                errors.append(f"{pid}: block '{bname}' is PARTIAL "
                              f"({len(got)}/{len(fields)}) — parse drift")
        soc = row.get("soc_pct")
        # -1 = no-gauge sentinel AT THIS LAYER (bridge translates wire-255 -> -1,
        # cores3_bridge.ino:969); a literal 255 here means an untranslated path
        if isinstance(soc, int) and soc != -1 and not 0 <= soc <= 100:
            warnings.append(f"{pid}: soc_pct={soc} outside 0-100 and not the -1 sentinel")
        unknown |= set(row) - KNOWN
    if unknown:
        warnings.append(f"unknown peer fields (Ben moved — re-pin the contract): "
                        f"{sorted(unknown)}")
    return errors, warnings, len(peers)


def good_row(pid="F40364"):
    row = {n: ({str: "x", int: 1, bool: True}.get(t if not isinstance(t, tuple) else NUM, 1.0)
               if not nullable else None)
           for n, (t, nullable) in CORE.items()}
    row.update(id=pid, ts_utc="2026-08-17T23:00:00Z", reset_reason="poweron",
               firmware_rev="fx-260817-ec7f28d-b", soc_pct=87)
    row.update({f: 1 for f in BLOCKS["bq"]})  # one FULL block must pass
    return row


def selftest():
    base = {"ts_utc": "t", "serial": {"port": "p", "connected": True},
            "master": None, "peers": {}, "scans": [], "raw": [], "last_command": None}
    ok = dict(base, peers={"F40364": good_row()})
    e, w, n = validate(ok)
    assert not e, f"good payload must pass, got: {e}"
    bad1 = dict(base, peers={"X": {k: v for k, v in good_row().items() if k != "battery_v"}})
    assert any("battery_v" in x for x in validate(bad1)[0]), "missing core field not caught"
    half = good_row(); [half.pop(f) for f in BLOCKS["bq"][:9]]
    assert any("PARTIAL" in x for x in validate(dict(base, peers={"X": half}))[0]), \
        "partial block not caught"
    wrong = good_row(); wrong["soc_pct"] = "87"
    assert any("wrong type" in x for x in validate(dict(base, peers={"X": wrong}))[0]), \
        "wrong type not caught"
    extra = good_row(); extra["bens_new_field"] = 1
    assert any("re-pin" in x for x in validate(dict(base, peers={"X": extra}))[1]), \
        "unknown field must WARN"
    print("selftest OK: good payload passes; missing-core, partial-block and "
          "wrong-type FAIL; unknown fields WARN")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--url", default="http://127.0.0.1:8765/api/state")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        selftest()
        return
    try:
        with urllib.request.urlopen(args.url, timeout=5) as r:
            payload = json.load(r)
    except Exception as e:
        sys.exit(f"FAIL: feed unreachable at {args.url}: {e!r}")
    errors, warnings, n = validate(payload)
    for w in warnings:
        print(f"WARN: {w}")
    for e in errors:
        print(f"ERROR: {e}")
    print(f"{'PASS' if not errors else 'FAIL'}: {n} peers checked, "
          f"{len(errors)} errors, {len(warnings)} warnings ({args.url})")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
