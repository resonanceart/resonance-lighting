# 26 — MIRROR ↔ BENCH STATE CONTRACT (pinned)

> **For:** network-tester (Mirror app agent) — answer to their ask #1 (08-17, handoff b3d379ca).
> **Pinned to:** Ben's `ops/bench/net_bench_dashboard.py` @ upstream `codex/deep-recovery-canary`
> **`1f1edfd`**. If Ben's dashboard moves, this contract is STALE until re-pinned: re-read
> `handle_line`/`snapshot`, bump the SHA here, re-run the checker. Field truth below is read from
> that source, then verified against the LIVE :8765 feed by `tools/mirror-contract-check.py`.
> Maintained by lighting-architect.

---

## 0 · THE PROTOCOL (Elliot, 2026-08-17 — strict, non-negotiable)

1. **Keep code simple** — optimized for speed of modification. No abstraction until the second
   consumer exists.
2. **Test everything BEFORE building on it.** No Mirror store/type ships against this contract
   without a green `mirror-contract-check.py` run (selftest + live). The checker, not this prose,
   is the acceptance gate.
3. **Every feature ships flagged `BETA`** and stays BETA until **Elliot confirms it working in the
   app itself** (an in-app confirm control, like the flash station's ✔ RED). Only Elliot's in-app
   confirmation clears the flag.
4. **:8765 is Ben's port.** One serial reader per bridge, and it's Ben's dashboard. The station's
   own bridge_reader stays opt-in OFF. Stubs live on **:8766**, bind localhost only, and REPLAY a
   captured real feed (enforced in Mirror @ 5709d6d8) — a stub must never be able to invent peers.
5. **Watch-only.** Mirror v1 sends nothing. Widget tiers: READ + benign BLINK registrable;
   CONFIG/OPS throw at registration until Elliot/Ben gate them open (PRD §7). NB_IDENTIFY stays
   parked.
6. **null ≠ 0, ever.** A null field means *not reported*; coercing to 0 files a running fixture as
   dormant (the 08-15 honest-telemetry lesson). Render UNKNOWN, not zero.
7. Contract changes ride this file + a re-run of the checker, both committed. Ben's shape wins on
   any disagreement — file him a question, never adapt his fields silently.

## 1 · `GET /api/state` — top level

| key | type | notes |
|---|---|---|
| `ts_utc` | str ISO-8601 | server compose time — freshness baseline for the whole snapshot |
| `serial` | obj | `{port:str, connected:bool, error:str\|null, lines:int, started_ts:str}` — `connected:false` + `error` = bridge unplugged/wedged; the feed self-reports its own health, use it |
| `master` | obj \| **null** | the bridge itself; null until the first master line is heard |
| `peers` | {fixture_id → peer row} | id = 6-hex MAC tail, e.g. `F40364` |
| `scans` | list | recent scan events (bounded deque) |
| `raw` | list | recent raw serial lines (bounded deque) — debugging only, never parse |
| `last_command` | obj \| null | `{cmd,label,ts_utc}` of the last dashboard-sent command |

`GET /events` = SSE, `event: snapshot` every 1.0 s with the same payload — prefer this over
polling for the Mirror store.

**master row:** `id, channel:int (11), frames, send_ok, send_fail:int, uptime_ms:int,
battery_v:float, firmware_rev:str, ts_utc`. `firmware_rev` may arrive from the boot banner
instead of the master line. Bench bridge today: `E39A34` on `cores3-bridge-2026-08-15.1`
(⚠ its fw predates the dark-lease grammar — that dashboard button is inert here).

## 2 · peer row — core block (always present; null = not reported)

**Never-null:** `id:str · seq,rx,gaps:int · pdr:float(0–1, uplink) · rssi_dbm:int ·
battery_v:float(V) · battery_ma:int(mA, signed: + charging / − discharging) · battery_w:float ·
soc_pct:int · reset_reason:str · ca_state:int · peer_mode:int · dl_pdr:float(0–1) ·
dl_rssi_dbm:int · uptime_ms:int · age_ms:int · ts_utc:str`.

- **`age_ms`** — bridge-computed `millis() − lastHeardMs` for that peer, refreshed only while
  serial flows. **THE FRESHNESS TRIPLE-RULE (load-bearing):** a peer is live iff
  `age_ms < 5000` **AND** `now − row.ts_utc < ~3 s` **AND** `serial.connected == true`. Reason:
  if the bridge serial drops while the HTTP server keeps serving, every last-fresh peer's
  `age_ms` FREEZES below 5000 forever — the dashboard's own strike/sleep gates have exactly this
  flaw (`net_bench_dashboard.py:1901-1905`). Never trust `age_ms` alone.
- **`peers` = "ever seen since dashboard start", never "present":** there is NO eviction anywhere
  (bridge 192-slot table never ages out and silently ignores fixture #193; the dashboard dict
  has no pruning path). Filter freshness client-side; ghosts are normal.
- **`soc_pct` = −1** → no gauge fitted/readable. On the ESP-NOW wire the sentinel is 255
  (`net_peer.cpp:81`), and the BRIDGE translates 255 → −1 when printing the serial line
  (`cores3_bridge.ino:969`) — so at THIS layer you see −1 (live-confirmed on 9E5B44 + F403F0);
  a literal 255 here would mean an untranslated path and is itself suspicious. Render "n/a",
  never −1 %, 255 % or 0 %. (Found by the checker's first live run — the gate works.)
- **`dl_pdr`** — downlink packet-delivery ratio (bridge→fixture) computed by the fixture; the
  honest reachability signal, distinct from uplink `pdr`.

**Nullable core** (same rule: null = not reported this hb): `supply_v,supply_ma,supply_good,
supply_w · lux (`light_sat:bool` true when the sensor pegged — lux is then a floor, not a value) ·
light_ch0,light_ch1 · panel_temp_c · panel_rh_pct (negative raw → null) · batt_temp_c ·
ina_panel_mv/_ma/_w · ina_batt_mv/_ma · config_capacity_mah · config_charge_ma · drawdown_mah/
_budget_mah/_active · firmware_rev · maint_status · field_phase/_reason/_cycle/_elapsed_s/
_charge_mah/_discharge_mah/_min_mv/_max_mv · profile · life_state · power_tier · active_program ·
night_min` — plus the **render tail** below. `load_w` is derived (`supply_w − battery_w`) and
present only when both parents are.

**Render/class tail + SHORT-HEARTBEAT CARRY-FORWARD:** `fixture_class, led_rail_on, led_r/g/b/w,
led_lit_pixels, sensor_bits, class_mismatch, recovery_state, recovery_detect_mv` — short
heartbeats omit this tail, and the dashboard **carries the last rich values forward** so the glyph
doesn't flicker to unknown. Consequence for Mirror: these nine fields can be OLDER than the row's
`ts_utc`. Treat them as "last known", not "current".

## 3 · peer row — conditional blocks (each all-or-none)

| block | fields | present when |
|---|---|---|
| BQ charger | `bq_vindpm_mv, bq_ichg_ma, bq_vreg_mv, bq_reg16, bq_reg18, bq_stat0, bq_stat1, bq_fault0, bq_flag0, bq_flag1, bq_fault_flag0, bq_part, bq_chg_en, bq_en_hiz, bq_batfet_ctrl, bq_vbus_stat, bq_chg_stat` | hb carries the BQ tail |
| field energy | `field_charge_wh, field_discharge_wh, field_peak_panel_w, field_peak_charge_w, field_peak_draw_w, field_low_s, field_charge_min, field_wait_min, field_draw_min, field_protect_min` | hb carries the field-energy tail |
| MPPT | `mppt_status, mppt_reason, mppt_runs, mppt_active_v, mppt_best_v, mppt_last_v, mppt_p46_w, mppt_p48_w, mppt_p50_w` | hb carries the MPPT tail |
| load guard | `field_load_dimmed, field_protect_latched` | hb carries the dim tail |

A row missing a whole block is normal. A row with HALF a block is a parse drift — flag it, that's
the checker's job.

**Unknown keys:** Ben adds fields between pins. The checker WARNS on unknown keys (signal to
re-pin) but does not fail — Mirror's store should ignore unknowns, never crash on them.

## 4 · fixtures.json (ask #2, short form — full treatment on request)

`app/public/fixtures.json` — schema **`resonance.fixtures/0.4.1`**, **130 fixtures**, units
**metres**, counts 72 downlight / 24 perimeter / 18 chandelier / 16 uplight (matches ADR-0032).
Fixture `id` (`F000`…) is a MODEL seat; mesh peers key by MAC tail — **MAC↔seat binding exists
nowhere yet** (Ben's TODO agrees); the Mirror seating layer IS that binding, which is why it must
be its own explicit, Elliot-confirmable store, not an inference.
⚠ Pending change, not yet ruled: perimeter F106–F129 move to r 15.07 m / z 1.487 (BLD 08-17,
span 30.14 m). Until my ruling + Elliot's go, 0.4.1 as-published is the truth. I'll notify on the
bus when it re-cuts.

## 5 · flash station `/state` (:8940) — the other Mirror ingredient

Same trust posture; it's OUR tool so the contract can move on request. Today's shape used by the
catalogued A11/A12 patterns: `ports{dev→{present,first_seen,last_change,flashing,
flash_requested,usb{serial,name,mfr,fixture_hint}}} · results{dev→{verdict PASS/UPLOADED/FAIL/
PARTIAL, checks{preflight,upload,serial_verify,wifi_verify}, mac, fixture_id, fw, guard_stage,
battery_v, row_at}} · roster{fid→ledger row} · mesh{} · artifacts{slug→{label,flashable,
available,sha256,bytes,behaviors[],warn}} · artifact (staged slug) · auto{} · bridges[] ·
bridge_note · expect · server_boot`. GETs are read-only; the POST surface is bench-only (C3
finding stands: unauthenticated — another reason Mirror never proxies station POSTs).
