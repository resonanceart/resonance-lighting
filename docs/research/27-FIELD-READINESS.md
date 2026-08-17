# 27 — FIELD READINESS + MIRROR INTEGRATION DESIGN

> **Written:** 2026-08-18, lighting-architect, from two full-source deep reads of Ben's fixture +
> bridge firmware and dashboard @ upstream `codex/deep-recovery-canary` **`1f1edfd`** (all claims
> file:line-verified against that commit; full cited reports in session transcript 6f14bfe9).
> Burn: gates 08-30, burn Sat 09-05. **Analysis only — no code changes ride this doc.**
> Companion: `26-MIRROR-STATE-CONTRACT.md` (field contract) · `25-FIRMWARE-LEDGER.md` (what runs where).

---

## 1 · WHAT THE FLEET IS TONIGHT (posture, one paragraph)

~91 fixtures on `fx-260817-ec7f28d-b` = **commission profile + basic-listener**, channel 11.
Commission profile means: lifecycle pinned to `LIFE_COMMISSION`, **no dusk/dawn, no bounded
night, no day-sleep, strikes decoupled from solar surplus** — the only autonomous energy
protection running is the voltage-tier ladder (FULL≥3.0 V → DIM<3.0 → OFF<2.95 → PROTECT<2.9
immediate, compensated mV, release +150 mV sustained). Basic-listener means: **quiet ≠ dark** —
idle renders the class beacon (canopy warm-white 128 · perimeter red 16 · RGB red 128), and the
radio+sensors+render path stay live 24/7 at a measured **~126–144 mA floor per fixture**.

## 2 · LIVE-FIRE SAFETY SURFACES (ranked — read before any field op)

1. **Strikes fire at ANY hour on today's fleet.** The strike gate on commission profile reduces
   to `power_tier == FULL` (`behavior_glue.cpp:232-233`; lifecycle hard-sets
   `strikesAllowed=false` so only the dev branch runs). AND the solenoid-policy migration
   **re-armed every fixture** including any an operator disarmed under old firmware
   (`solenoid_config.h:8`). AND the USER-button EXT0 wake **fires one 40 ms strike
   unconditionally**, bypassing all gates (`solenoid.cpp:169-173`). A crew member pressing the
   button on a hung canopy fixture at night = a bell in the dark.
2. **The command plane is unencrypted broadcast on channel 11.** Every "addressed" command is a
   wire broadcast with cooperative in-payload targeting (`cores3_bridge.ino:439-444`). Anyone
   with an ESP32 on ch 11 can sleep, darken, or strike the fleet. Acceptable at a private bench;
   a **known accepted risk at the playa** — name it, don't discover it.
3. **`/api/cmd` accepts bare `"S"` = broadcast 6-HOUR fleet sleep, no confirmation** — the UI has
   no such button but the allowlist takes it (`net_bench_dashboard.py:1816`, default 21600 s).
   And the **`B3600` "Lights off 1 h" button has NO confirm dialog** (`:864`, generic handler).
   ⚠ **Our bench launches the dashboard `--bind 0.0.0.0`** (phone access) — Ben's default is
   127.0.0.1. On any shared LAN (camp WiFi!) that's an unauthenticated fleet-sleep/strike API.
   **Decision owed (Elliot): keep 0.0.0.0 on trusted bench LAN only; at the burn either bind
   localhost + read-only proxy for phones, or accept and fence the WiFi.**
4. **Dark ≠ fail-safe.** The dark lease is RAM-only by design: a fixture that browns out
   mid-lease **comes back lit** (`runtime.cpp:67-69`; no persist bit exists for programs).
   Re-issue `B` after any suspected reboot (watch `rr=`/`up=` reset on peer lines).
5. **`B<secs>` on an old bridge is a SILENT no-op** — unknown opcodes are swallowed char-by-char
   (`cores3_bridge.ino:1508-1509`) while the dashboard prints green "Sent B3600". Dark-lease
   support starts at `cores3-bridge-2026-08-17.1`; **our bench bridge E39A34 runs 08-15.1 →
   the button lies on our bench today.** Pre-flight: `master.firmware_rev >= 2026-08-17.1`, then
   confirm `prog=4`/`active_program=4` actually appears on peers.

## 3 · PRE-FLIGHT CHECKLIST (every bench/field session)

□ `serial.connected == true` in `/api/state` — otherwise every number is frozen history
□ `master.firmware_rev` read and version-gated before trusting `B`/`b`
□ Exactly **one dashboard per bridge** (pyserial is opened non-exclusive — two dashboards BOTH
  open the port and split bytes into fused commands; enforced procedurally only) and one bridge
  per channel (two bridges = last-writer-wins on every lease, invisible to each other)
□ CoreS3 **LCD checked at bring-up** — `radio FAIL` (channel set failure) appears ONLY there;
  serial keeps printing `nb-master` with the compiled ch as if fine
□ Freshness triple-rule in force for any actuation list (age_ms < 5 s AND ts_utc < 3 s AND
  serial.connected) — the dashboard's own strike gate uses age_ms alone and can strike ghosts
  after a serial drop
□ After OTA: acceptance = fresh heartbeat with exact expected rev SURVIVING the 20 s self-test
  window (`ota_verify.cpp` — rollback is automatic; `9E5B44`'s double rollback is the proof)
□ Dark ops: re-issue `B` after any fixture reset; expiry crossfades back to autonomy by design

## 4 · OPERATOR SYMPTOM TABLE (what dark/odd actually means)

**A dark fixture is one of 12 causes** — in rough order of likelihood on today's posture:
scheduled/commanded deep sleep (radio silent too) · PROTECT tier (radio ALIVE, `power_tier=3`) ·
boot-guard park (`guard_stage=4` — DURABLE, survives reflash) · active dark lease
(`active_program=4`, radio alive) · maintenance mode (WiFi join window, ESP-NOW off) · legacy
holdback image · LED-ramp abort (<2.9 V mid-ramp, tries then dies in ~3 s) · rail pad verify
failure · bench `L0` latch · deep-recovery posture (rails off while proving a 2.2–2.5 V cell —
**dark on good USB is CORRECT here**) · OFF tier · never got the command.

Key recognitions (full table in the deep-read):
- **Reboot right after PROTECT release is NORMAL** — the firmware deliberately restarts to redo
  the skipped cold-boot init (`power_glue.cpp:108-121`). Don't count it as a crash.
- **`charging_enabled=false` on a healthy unit**: 60 s of ~0 V cell reading at boot latches
  charging OFF until reboot (`board_power.cpp:256-261`). Fix = reboot with cell seated.
- **PROTECT with a battery installed cannot be hand-cleared** — serial `X` is bare-board-only;
  the only release is the compound 60 s charge qualification (≥20 mA, ≥3100 mV, supply good).
- **Watchdog loops bury fixtures in PROTECT**: every WDT reset is "unexpected" to the boot
  guard; two in a row walks FULL→DIM→PROTECT (durable). A firmware hang bug field-translates
  into parked-dark fixtures.
- **`class 4 / sensor_bits 0`** = STEMMA physical reseat (11 known; remote re-probes proven
  useless).
- **Wave color persisting for hours is intentional** — `gWaveDisplayActive` is never cleared;
  last wave hue holds until the next wave/lease/reboot.

## 5 · FIELD-READINESS GAPS (ranked, with owner)

| # | Gap | Owner | Why it matters before 08-30 |
|---|---|---|---|
| 1 | **The `F1` field-profile flip is an unmade decision** — commission is bench posture; flipping changes 5 behaviors at once (dusk/dawn on, 10.5 h bounded night, 300 s day-sleep, strike gating to solar-surplus, hb cadence 5 s/60 s). Ben's TODO flags it unresolved | **Ben+Elliot** | The fleet cannot run the burn on commission (no energy autonomy, ~130 mA 24/7 floor) |
| 2 | **Holdback cleanup**: F3FD88 on legacy 08-06.5 (USB visit) · sun-pile stragglers · 9E5B44 bench diagnosis (2× rollback) · F40424 · 11 STEMMA reseats · F2BDFC at 2,256 mV deep cell | **Elliot bench + Ben OTA batch** | Every holdback ignores fleet-era commands incl. dark lease |
| 3 | **Bridge fleet on 08-17.1** — ours is 2 versions back; dark lease inert; rebuild recipe known (`--channel 11`) | **Ben's call** | §2.5 silent-no-op |
| 4 | **Dashboard exposure decision** (0.0.0.0 vs localhost+proxy) | **Elliot** | §2.3 |
| 5 | **Maintenance-AP channel discipline**: the camp AP MUST be ch 11 (ADR 0036 agrees); associating off-channel breaks a fixture's mesh until USB | **network lane** | one wrong AP = stranded fixtures |
| 6 | **No state-change full-heartbeat** (packet.h claims it; not wired) — tier/lifecycle changes lag ≤60 s in field cadence | **Ben (question)** | field dashboards will look stale-slow; don't misread as faults |
| 7 | Strike posture for the event (disarm-by-default? `sol_en=0` per fixture is the only off) | **Elliot+Ben** | §2.1 |

**Questions/bugs to file to Ben** (batched, next results handoff): frozen-age_ms freshness gate
+ no peer eviction (dashboard) · bare-`S` in the /api/cmd allowlist + unconfirmed B3600 button ·
pyserial non-exclusive open · packet.h full-hb claim vs implementation · `field_min_mv/max_mv`
are placeholders (both = current V) · `NB_NEIGHBOR_SET` NVS persistence unimplemented (pinned
adjacency dies on reboot) · retired-wave ring only 4 deep · EXT0 button-strike bypasses gates.

## 6 · MIRROR INTEGRATION DESIGN (fleet + flash station → one app)

**Shape: two read-only feeds → one typed store → seat-keyed scene.** No new daemons, no new
ports, no protocol invention — the Mirror consumes exactly what exists:

```
Ben's dashboard :8765 ──GET /events (SSE 1 Hz snapshot)──┐
                                                          ├─→ Mirror store ─→ 3-D scene + console
Flash station  :8940 ──GET /state (poll 1–2 s)───────────┘      (zustand)      (blender's layer)
```

- **Vite same-origin proxy for both** (`/bench` → 8765 exists; add `/station` → 8940) — no CORS,
  no direct browser-to-port coupling, stub swap via env var stays possible. Mirror NEVER talks
  serial and NEVER POSTs — the watch-only fence is structural (all mutation is 3 POST routes it
  simply doesn't call).
- **Keying discipline:** everything keys on the 6-hex MAC tail (`id`). fixtures.json `F###` ids
  are MODEL seats; the **seat↔MAC binding table is Mirror-owned state** (it exists nowhere in
  firmware — Ben's TODO confirms), Elliot-editable, BETA until he confirms seats in-app.
- **Freshness:** the store computes `live` per peer via the triple-rule (contract §2) and
  renders three states only: LIVE / LAST-SEEN-age / GHOST (ever-seen, stale >6 min). A
  `serial.connected=false` feed renders the whole fleet view as STALE, full stop — never "0
  lights".
- **Fusion rule (flash ⊕ fleet):** the station contributes *bench truth* (what we uploaded,
  verdicts, roster names, staged artifact) and the dashboard contributes *air truth* (what runs,
  battery, tier, program). Where they disagree, **air wins for "running", bench wins for
  "flashed"** — same doctrine as the ledger's three-questions table. The station's mesh overlay
  (UDP :54321) is bench-only convenience; Mirror uses `/api/state`, not UDP (render tails vanish
  on short heartbeats in the raw feed; the dashboard carries them forward).
- **Version gates in UI:** dark-lease widget (when it ever unfences) renders DISABLED unless
  `master.firmware_rev >= cores3-bridge-2026-08-17.1` — the silent-no-op bridge is the reason
  this must be a UI gate, not a doc note.
- **SSE budget:** thread-per-client, no cap server-side → Mirror holds ONE `/events` connection
  and fans out internally.
- **Phases (each BETA → Elliot in-app confirm):** L1 blank tree + live peers (fleet feed only) →
  L2 seat binding UI → L3 station panel (flash cards + staged artifact via `/station` proxy) →
  L4 identify (only when Elliot/Ben unfence NB_IDENTIFY; 8 s round-robin `i` exists today,
  Ben-approved list precedent = dashboard's `valid_command`).

## 7 · RETEST PROTOCOL (standing, no new tooling)

After ANY change to station/waiter/contract or any Ben fetch:
`python3 tools/mirror-contract-check.py --selftest && python3 tools/mirror-contract-check.py` ·
`python3 tools/bridge-dashboard-waiter.py --selftest` · station `/state` curl (staged artifact +
mesh count sane) · this doc + ledger re-pinned if upstream moved. Green = build may proceed
(Elliot's rule #2); any red = stop and fix before building.
