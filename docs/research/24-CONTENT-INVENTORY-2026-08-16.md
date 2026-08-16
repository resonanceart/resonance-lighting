# 24 — Content Inventory: everything testable, commandable, and dashboardable in this repo

> 2026-08-16 · lighting-architect · compiled from a three-agent deep dive @ `b18938e`
> Purpose: the master parts list for the **Resonance Mirror** (see `PRD-resonance-mirror.md`).
> Mission framing per Elliot: *build dashboards and visualizers for the work Ben has already tested — rather than create new code.* Every row below is something Ben's lane already produces; the Mirror's job is to present it.
> Scene scope per Elliot: the visualizer covers **the entire Tree area plus the perimeter ring** (24 perimeter fixtures at R≈6.5 m, 1.70 m spacing). Geometry stays blender-architect's lane.

**One truth up front: there are no lasers.** No laser class, hardware, or command exists anywhere in the repo (verified 08-15). The expectation traces to doc similes ("tight beamAngle = lasers" god-ray comparison; the ToF sensors' Class-1 VCSELs). Fixture classes are exactly four: downlight (72) · perimeter (24) · chandelier (18) · uplight/trunk (16).

---

## A. COMMAND INVENTORY — every command surface in the system

Write-risk legend: 🟢 read/observe · 🔵 benign visual (self-expiring) · 🟠 config/state change · 🔴 ops-grade (power, firmware, actuation)

### A.1 ESP-NOW wire vocabulary (`firmware/fixture/src/core/packet.h`, NB_PROTO_VER 1)
| # | Type | Dir | Risk | Meaning |
|---|---|---|---|---|
| 1 | NB_HEARTBEAT | peer→all | 🟢 | state + telemetry (29 B short / 148 B full, append-only tails) |
| 2 | NB_SHOWFRAME | bridge→all | 🔴 | show command |
| 3 | NB_ENTER_MAINT | bridge→all | 🔴 | enter shared-WiFi maintenance (kills ESP-NOW + rails) |
| 4 | NB_RESUME | bridge→all | 🟠 | leave maintenance |
| 5 | NB_SET_RATE | bridge→all | 🟠 | heartbeat/frame rate 1–100 Hz |
| 6 | NB_IDENTIFY | bridge→target/all | 🔵 | locate blink (+color/blink tail; see §A.6 caveat) |
| 7 | NB_SCANAP | bench peer→bridge | 🟢 | scanned AP report (fixtures never send) |
| 8 | NB_SET_MAINTAIN | bridge→all | 🟠 | charger VINDPM/maintain V |
| 9/14 | NB_SET_CAPACITY / TARGET_ | bridge→all/target | 🟠 | persist battery capacity mAh (reboots) |
| 10/15 | NB_SET_CHARGE_MA / TARGET_ | bridge→all/target | 🟠 | charge-current cap mA |
| 11/13 | NB_SLEEP_FOR / TARGET_ | bridge→all/target | 🔴 | timed deep sleep (rails cut) |
| 12 | NB_DRAWDOWN | bridge→bench | 🟠 | bench load (fixture ignores) |
| 16 | NB_TARGET_ENTER_MAINT | bridge→target | 🔴 | targeted maintenance/OTA |
| 17 | NB_TARGET_SOLENOID | bridge→target | 🔴 | one bounded D7 strike pulse (5–300 ms) |
| 18 | NB_CHOREO_STATE | peer→all | 🟢 | 1 Hz program/intensity/phase/flags |
| 19 | NB_PROGRAM_SET | bridge→all/target | 🔴 | program override lease |
| 20 | NB_TIME_QUALITY | — | 🟢 | **RESERVED, not sent** (ADR 0031 time anchors) |
| 21 | NB_PROFILE | bridge→all/target | 🟠 | commission/field flip (persists) |
| 22 | NB_NEIGHBOR_REPORT | — | 🟢 | **RESERVED, not sent** (locate substrate: censored-median RSSI) |
| 23 | NB_EVENT | — | 🟢 | **RESERVED, not sent** (event fabric) |
| 24 | NB_NEIGHBOR_SET | bridge→target | 🟠 | pinned CA adjacency (≤8) |
| 25 | NB_DIRECT_FRAME | bridge→all | 🔴 | per-fixture RGBW, ≤18 entries (15+7·n B) |
| 26 | NB_FORCE_LIFECYCLE | bridge→all/target | 🟠 | force day/night/auto (RAM-only) |

### A.2 Bridge text-mode serial verbs (`cores3_bridge.ino handleSerial`, 115200)
`r` status · `t` JSON bridge stats · `U[id]` maint burst 35 s 🔴 · `c` resume 🟠 · `+`/`-`/`R<hz>` rate 🟠 · `i[id][:s]`/`I` identify 🔵 · `F[id:]<0|1>` profile (persists!) 🟠 · `m<46-168>` VINDPM 🟠 · `C[id:]<100-30000>` capacity (reboots) 🟠 · `G[id:]<40-2000>` charge cap 🟠 · `K<id>:<5-300>` solenoid 🔴 · `S[s]` sleep 🔴 · `P<id>[:s]` park 🔴 · `D[id][:mAh]` drawdown 🟠 · `A` audio toggle (audio build). Broadcast ×4 @5 ms, targeted ×6 @8 ms repeats built in.

### A.3 Fixture USB serial CLI (`serial_cli.cpp`, single char, no echo/prompt)
`t` full telemetry JSON 🟢 · `r` one-line status 🟢 · `u` enter maint 🔴 · `c` resume 🟠 · `C`/`G` capacity/charge (bare = read-back 🟢) · `X` bare-board PROTECT clear 🟠 · `K<id>:<ms>` solenoid 🔴 · `S[s]` sleep 🔴 · `O[0-4]` class override 🟠 · `N[0|1|2]` day/night/auto (RAM) 🟠 · `L[0|1]` rail-off/smoke 🟠 · `F[0|1]` profile 🟠 · `H[1-13]` channel (reboots) 🟠

### A.4 Fixture HTTP endpoints (maintenance mode only, exactly four routes)
`GET /` banner 🟢 · `GET /telemetry` full JSON 🟢 · `GET /resume` 🟠 · `POST /update` OTA (multipart `firmware=@bin`; **unauthenticated** — the 08-16 competing-writer incident) 🔴. Maintenance auto-expires at 600 s. Bench firmwares add: `led_studio /state` 🟢 + `/set` 🟠, `power_bench /mode` 🟠, `led_sol_bench /probe_strike` 🔴, `presence_bench /api/frame` + `/api/state` 🟢.

### A.5 net_bench_dashboard command allowlist (`valid_command`, :1277-1326)
Ben's own vetted safe-write surface: the §A.2 verbs with validated ranges — the precedent the Mirror's allowlist file follows.

### A.6 Identify caveat (verify before UX depends on it)
Deployed image (`fx-260816-otafix1-b`) visibly blinked the fleet on broadcast identify (Ben's LOG). But at HEAD, bridge `sendIdentify` hardcodes `color=0/blink=0`, and the pixel-identify renderer appears unreachable from any current command path — only the tiny status LED's `..-` pattern is provably driven. PRD §9 Q3 asks Ben which behavior the deployed image actually has; his TODO already plans an identify rework (~30 s / toggle / by-ID).

---

## B. BENCH-TEST INVENTORY (`ops/bench/`, 45 files, stdlib-only by policy)

| Group | Tools | What's tested | Data out |
|---|---|---|---|
| **Power/battery/gauge** (14) | `power_logger` `power_summary` `afk_sweep` `afk_discharge` `afk_analyze` `hex_ramp` `bb_efficiency` `charge_taper_watch` `et5406_discharge` `ina_logger` `ina_mapcheck` `reconcile_ina_pf` `loadgen_log` `plot_soc_v` | 3-axis battery×LED×panel matrix; true usable capacity (INA coulomb); charge taper; buck-boost efficiency; gauge bias | site-partitioned JSONL `data/ca|tn/`, PNGs |
| **LED/optics** (10) | `led_ina_sweep` `led_efficiency_sweep` `apogee_par` `ab_lux` `boost_ab_log` `boost_ab_suite` `rgbw_boost_ramp` + 3 plotters | LED mA vs brightness/gamma; PAR-per-mA module comparisons; rail-vs-VBAT A/B (verdict: **skip the boost**) | JSONL/CSV/JSON, PNGs |
| **Networking** (9) | `net_bench_log` `net_bench_monitor` `net_bench_dashboard` `net_bench_serial_bridge` `net_bench_summary` `net_bench_ratesweep` `net_bench_walk` `net_bench_walk_plot` + tests | PDR up/down, RSSI, rate sweeps {1..50 Hz} → loss knee + safe node count; range walks | UDP :54321 line protocol → JSONL; live dashboards |
| **OTA/fleet** (3) | `net_bench_ota` `field_cycle_ota` `fleet_usb_bringup` | parallel OTA timing (t_ack/t_ready/recovered); USB batch commissioning (12 workers) | OTA-results JSONL; `ops/fleet/registry.csv` + bringup JSONL |
| **Solar/MPPT** (2) | `mpp_sweep` `mpp_analyze` | VINDPM sweep w/ light-normalization + anchor drift; best setpoint vs fixed 5.5 V | JSONL, plots |
| **Presence** (1) | `presence_logger` | MLX90640 thermal + VL53L5CX + TMF8821 + XM125 radar frames; thresholds deliberately downstream | typed JSONL (meta/frame/state/mark/summary) |
| **Solenoid/waveform** (3) | `solenoid_vdc_sweep` `plot_solenoid_vdc` `capbank_waveform` | strike energy vs width vs VDC (MSA311-scored); radio-quiet capbank waveforms | 13-col CSV, JSONL |

**Operator tools** (`tools/`): `revive` (USB defibrillator via ROM bootloader) · `ops` (status/flash/flash-old/color/knock/night/maint/watch; 48-way LAN sweep) · `certify` (green-blink ready ritual) · `bros`/`lights` (our lane).

## C. TEST-REPORT INVENTORY (`docs/tests/`, 18)
Highest-signal verdicts: **AUTOLOCATE RSSI SIM** (feasible w/ 3 beacons, not hands-free — the locate charter) · **BOOST A/B** (skip the boost) · **32700 SHOOTOUT** (vendor 7.2 Ah claim false) · **20 Ah UPLIGHT** (the 20 Ah that was) · **BROWNOUT** (root cause: PM-bus I²C integrity → ADR 0028's 100 kHz rule) · **5-NODE NETWORKING** (founded the ESP-NOW go + net_bench harness) · **SOLAR TELEMETRY RANGE** (telemetry rides ESP-NOW, not WiFi) · P0 OPEN: **dual-input USB service** (two boards bricked via powered hub). HTML reports are hand-written shells + script-generated PNG figures (`report_figs_boost_ab.py`).

## D. EXISTING DASHBOARD INVENTORY
| Dashboard | Feed | Renders |
|---|---|---|
| `net_bench_dashboard.py` (web :8765) | owns bridge serial; re-emits UDP | live peer table, sparklines, battery roll-up, SSE 1 Hz, `GET /api/state` (**the normalized schema to adopt**), command panel |
| `net_bench_monitor.py` (terminal) | UDP :54321 | per-peer table, ASCII RSSI bars, 8 s staleness grey-out |
| `perimeter_trio.html` | polls led_studio `/state` 1 Hz | presence badges, 16-zone ToF heatmap, battery/RSSI, anim controls |
| `cots-mode-dashboard.html` | iframes boards' own pages | 4-board mode grid (legacy) |
| presence bench (board-hosted) | `/api/frame` | thermal heatmap + zones (thresholds live here) |
| ADR 0037 cricket console | planned | Ben's handheld listen-first census — kill-tests pending, post-event |

## E. LIVE-DATA FIELD INVENTORY (what the Mirror can show per light)
- **Heartbeat short, 5 s cadence:** batt mV/mA/SoC(255=none), reset reason, mode, dl_pdr‰, dl_rssi, supply mV/mA/good.
- **Heartbeat full, 60 s:** + fw_rev, maint_status(0-5), lifecycle phase, BQ25628E truth (VINDPM/ICHG/VREG/status/fault regs), configured capacity/charge, profile, life_state, power_tier, active_program, night_min.
- **Choreo, 1 Hz (binary bridge mode only):** program_id, state, intensity, phase_ms, flags(power-limited/lease/commission).
- **Maintenance/USB only:** full ~60-key telemetry incl. sensors (ToF depth/confidence, tilt, sway, BMP temp/pressure), OTA partition/state, heap, solenoid counters.
- **Zero-not-absent trap:** heartbeat tails 5/10/12 (drawdown, energy summary, dim/protect latches) always arrive as valid zeros — render "—".
- **Not visible during normal ops:** all sensor data; neighbor RSSI table (local-only); uplink PDR (bridge-derived only); wall-clock time (uptime only).

## F. STATIC DATASET INVENTORY (loadable directly, no radio)
`app/public/fixtures.json` (130 slots, ADR-0032-exact, metres — **the Mirror's tree+perimeter scene skeleton**; blender lane continues on full-area geometry) · `ops/fleet/registry.csv` (57 boards: fw+SHA, battery config, role, location) · `ops/fleet/bringup/*.jsonl` (285 commissioning records) · OTA rollout JSONL (per-fixture firmware history) · `docs/block-diagram/SYSTEM.md` (fleet table + measured power anchors) · `docs/decisions/` (39 ADRs, uniform parseable headers) · `docs/glossary.md` · `ROADMAP.md` risk register · `ops/solarsim/data/` (solar scores; ~15%-conservative caveat) · `ops/locate/data/` (feasibility sims + viewers).

## G. TESTED-BY-BEN vs NOT-YET-AVAILABLE (the build-nothing-new line)
**Dashboardable today, zero new firmware:** everything in §E rows 1–2 + §F; fleet census; firmware-rev rollout progress (registry + OTA JSONL); battery health roll-ups; identify (pending §A.6 verification).
**Needs one Ben decision each:** choreo visibility over USB (bridge mode choice) · neighbor RSSI (type 22 flip-on) · sensor visibility in normal ops (slow tail or NB_EVENT) · time anchors (type 20, ADR 0031).
**Explicitly out (unproven or retired):** bulk direct-frame timing (Ben's LOG: "not treated as proof") · audio direct frames on fx-* firmware (live filter bug, PRD §9 Q6) · anything lease-based (Ben: lighting stays deliberately leaseless).
