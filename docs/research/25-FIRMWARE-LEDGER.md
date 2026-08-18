# 25 — FIRMWARE LEDGER (operator's answer sheet)

> **Maintained by:** lighting-architect, refreshed each session boot (`git fetch upstream` + read the
> top of Ben's `LOG.md`). **Truth lives in Ben's records** — his `LOG.md` entries, the immutable
> artifact manifests (`firmware/*/build/<fw_rev>/manifest.json`), and `ops/fleet/registry.csv`.
> This file is the derived quick-answer sheet so nobody has to re-mine the log at the bench.
> Contract: ADR 0040 + `docs/howto/FIRMWARE_ARTIFACT_HANDOFF.md`.
>
> **Last refreshed: 2026-08-17 ~19:00 PDT** from `upstream/codex/deep-recovery-canary @ e4d6dbf`.

---

## The three questions, and which record answers each

| Question | Authoritative record | NOT the answer |
|---|---|---|
| What is the **latest fleet firmware**? | Top of Ben's `LOG.md` (newest-first) + its artifact manifest | A branch name (branches move — ADR 0040), a file named `latest` |
| What is **light X running right now**? | A **fresh heartbeat** showing exact `fw_rev` (Ben's dashboard / registry) | Our USB flash roster — it records what **we uploaded**, not what runs now. Ben's OTA sweeps have silently superseded our bench flashes **twice** (08-16 ×2) |
| What did **we flash over USB, when, with what evidence**? | `ops/bench/data/usb/flash-roster-elliot.json` + evidence JSONLs | Heartbeats (a light can run our image and still be asleep/dark) |

Identity = **two values that travel together** (ADR 0040): `fw_rev` (`fx-YYMMDD-recipe7-V`) tells you
the intended recipe; **binary SHA-256** proves the exact bytes. Build class `V`: `p` fleetable ·
`b` bench/canary (NOT approved for fleet promotion) · `t` targeted safety-bypass (never fleetable,
locked to explicit short MACs). Note: today's entire fleet standard is still a **`b`-class** image —
the final one-image `p` fleet artifact does not exist yet (listener is still a compile flag).

---

## ⚡ ROLLOUT IN FLIGHT — 2026-08-17 ~19:5x PDT (watched live)

**`fx-260818-f80f315-b` landing NOW: 48 fixtures converted** (software resets, uptimes 1.5–2.4
min when caught) — incl. legacy `F3FD88` (finally captured!) and `9F26BC`. Remaining: 12×05ed4b3
· 31×ec7f28d (holdback-shaped). LOG entry for f80f315 NOT pushed yet — rollout ahead of record;
source is certainly `29ebe2b` (**ADR 0045**, pushed 19:45 PDT):
- **Transport sleep**: 32-bit rails-off timer for the Nevada City pack-out; auto wake restores
  radio/telemetry; RTC-retained latch keeps LEDs dark until a valid program command (bare `b`
  clears it) — dark-through-transport without opening fixtures.
- **Bounded RSSI survey — THE SELF-LOCATION UNLOCK**: neighbor cache 24 → full 160-device
  envelope; during an explicit `L[seconds]` window each fixture reports its complete fresh heard
  roster in 16-entry fragments (~20 s cadence); bridge emits directed `nb-rssi` rows;
  `ops/locate/rssi_capture.py` logs canonical JSONL "for offline grid-recovery experiments."
  Ben's own framing: feasibility data (RSSI EWMA samples), not production coordinates — exactly
  doc 28's L2 verification posture. Costs 5.9 KB fixture RAM.
⚠ Bridge support for `L` presumably needs the NEW bridge fw — re-check grammar after his next
push; our E39A34 (08-15.1) certainly lacks it.

## CURRENT STATE — 2026-08-17 evening (post small-fixes rollout)

**Fleet standard fixture image: `fx-260818-05ed4b3-b`** (small fixes: real blackout + anchors)
- source commit `e09f46f` · recipe `05ed4b3f…` · binary SHA-256 `2986a029…67e1db` · 1,176,000 B
- **60 of 60 attempted verified** (canary `F40174` + 56 main wave + 3 safe tail), evidence in
  `ops/bench/data/ca/20260818-01*-fleet-ota-results.jsonl`; low/recovery/anomalous/silent
  fixtures deliberately HELD BACK → **31 remain on `ec7f28d-b`** (live census 19:00 PDT:
  60×05ed4b3 · 31×ec7f28d · 4×prtrel1 · 3×otafix1 · 2×9ef4324 · 1×29ac840 = 101 peers)
- Rollout ended under a live `B3600` blackout — all 60 verified rail-OFF, zero lit pixels.

### `fx-260818-05ed4b3-b` — what changed vs ec7f28d (behavior)
- **Dark lease now cuts the PHYSICAL LED rail** (an active `PROG_COMMISSION_DARK` is
  distinguishable from the unleased commission fallback — basic-listener returns no frame).
- **Wave latch retired by explicit authority**: accepted program leases / direct-frame
  microleases clear the persisted wave color, and autonomous presence events are suppressed
  while a lease is active — a prior wave no longer reappears when a blackout expires.
- **Anchor inventory (read-only, sensor_bits append)**: bit 4 = SAM-M8Q **GPS** ACK @0x42,
  bit 5 = DS3231 **RTC** @0x68. Found so far: GPS on `F2BDB4` · RTC on `9F0E7C`, `9F26C0`
  (3 of 8 purchased anchor boards; absence unproven — holdbacks weren't probed).
- Ben's dashboard adds G/R anchor badges + tracks rich-report age separately from short-hb age
  (fixes the cached-revision display trap).

### Dusk USB rescue (same session)
9 low fixtures charging on USB: F402A4 F401DC 9F0E5C F2BDD4 9E5B34 F2BF7C F3FD28 9F2714 9E5A94.
**4 accept ≤1 mA → battery/charge-path BENCH candidates: `F2BDFC` `F2B900` `F40314` `9E5B44`**
(F2BDFC matches our 2,256 mV census find). Some dark perimeter fixtures remain unrescued
(cables ran out) — their silence is NOT yet evidence of a dead battery.
Field visual census: 74 canopy + 8 trunk + 24 perimeter installed (1 intentionally batteryless).

**Superseded standard: `fx-260817-ec7f28d-b`** (hardened presence wave)
- source commit `e70cb86` · recipe `ec7f28d9…` · binary SHA-256 `1598f550…b40f2b7` · 1,175,648 B
- accepted on **71 fixtures** (70 batch + canary `F40364`), evidence-gated per ADR 0040 §6

**Fleet is ASLEEP**: 65 fixtures took an addressed 8-hour bedtime at 23:16 PDT → **wake ~07:16 PDT
today**. A dark tree this morning is scheduled, not broken. Chargers (BQ25628E) stay autonomous
during sleep — solar resumes at sunrise.

**Bridges:**
| Bridge | Image | Notes |
|---|---|---|
| `4D5DB0` (Ben) | `cores3-bridge-2026-08-17.1` · SHA `f4b76098…` | NEW: dark-lease grammar `B<seconds>` / `b` release |
| `E39F1C` (Justin/ours) | `cores3-bridge-2026-08-16.1` | flashed by Ben 08-16 |
| `E39A34` (our bench, 3rd) | `cores3-bridge-2026-08-15.1` | drives Ben's dashboard :8765 on our bench |

**Our bench rebuild of the fleet standard: `fx-260817-e70cb86-b`** (2026-08-17, Elliot-directed)
- built once from Ben's fleet-standard source commit `e70cb86` (flags verified in
  build.options.json: commission · ch 11 · basic-listener · precharge 300); binary SHA-256
  `a48723ab…4824ae3`, 1,155,616 B (Ben's is 1,175,648 B — toolchain delta, his Windows bench core).
- **NOT Ben's artifact** — never call it `ec7f28d`; his census lists this rev as foreign. Staged as
  the default ⚡ package on the flash station (:8940 FIRMWARE panel; artifact dir in the
  resonance-fleet-dash worktree, ignored/uncommitted).

**USB-commissioning image for new/rescue boards: `fx-260816-prtrel1-b`**
- Ben's artifact SHA-256 `6305E971…` — our 08-16 bench rebuild was a **different binary** that
  self-IDs `fx-260816-cef34a4-b` (allowed per handoff, but never quote "prtrel1" for our uploads).

**Deliberately-old fixtures (Ben's census, 74 of 86 seen on current image):**
- Bench diagnosis owed: `9E5B44` (2× clean rollback at 20 s self-test), `F40424`
- Never exposed maintenance endpoint: `9E5A84`, `9F26D8`, `F2BCF4`, `F3FD88` — **F3FD88 SOLVED
  08-18 (station mesh census): it runs LEGACY `fixture-2026-08-06.5`**, a pre-recipe image ~11
  days old; its maintenance stack predates the current contract. Needs a USB bench visit.
- **Refused for low power — this is our sun pile**: `F2BE08`, `F3FD28`, `F401DC`, `F40308`,
  `F40314`, `F4035C` → once charged they still run our USB image and **need Ben's explicit OTA
  batch** (`ops/bench/fleet_dashboard_ota.py`) to join the fleet standard
- Parked on eager presence image `fx-260817-9ef4324-b`: `9E5AE0`; also `9E5B34` holds it,
  `9F2638` holds `fx-260817-29ac840-b` (both low/intermittent)
- Old `fx-260816-otafix1-b`: 3 fixtures still on it (slept with the fleet)

---

## WHAT EACH IMAGE IS SUPPOSED TO DO WHEN YOU TEST IT

The bench question is always: *I plugged/flashed/woke a light — what behavior proves which image,
and what is a bug?* Newest first. (Class defaults since `29ac840`: **canopy/downlight = warm-white
at 128 · 37-px perimeter HEX = red at 16 · RGB trunk/uplight = red at 128**. Boot-salute rule, ADR
0040 §8: a USB boot salute means *alive*, never *verified* — only a host-triggered salute after the
full commissioning gate means ready-to-unplug.)

### `fx-260817-ec7f28d-b` — hardened presence wave (CURRENT, 71 fixtures)
Everything `29ac840` does, plus:
- **Presence**: TMF ToF keeps a per-channel (9) closest-background, learns the installed scene over
  90 confident reports, triggers only on ≥300 mm closer for 3 consecutive confident reports;
  4 clear reports re-arm. So: a **stationary rig member becomes background** — waving once won't
  trigger; a sustained approach will. Triggering is deliberately hard (field-confirmed).
- **Wave**: an accepted presence event picks a new color, persists it locally, forwards addressed
  events to the 2 strongest recent wave-capable neighbors; 150-hop budget + event ledger stop
  loops; randomized origin delay cancels simultaneous origins. Test: trigger one fixture → color
  wave crosses the grid; telemetry showed 60/63 and 57/63 change in field windows.
- Bridge identify/tag leases and local power protection still override the demo.

### `fx-260817-29ac840-b` — self-identifying recovery (superseded standard)
- **STEMMA class census**: heartbeat reports raw sensor signature + derived class + mismatch guard.
  Test: dashboard glyph circle/hex/triangle/diamond = canopy/perimeter/trunk/chandelier.
  `class 4 / sensor bits 0` on a powered fixture ⇒ **physical STEMMA reseat needed** (11 known).
- **Deep-cell recovery (safe, universal)**: BQ25628E 30 mA discharge presence-test before any
  2.2–2.5 V recovery; needs strong USB + clean faults; proven cell capped at 100 mA, loads parked,
  until ≥2.55 V held 60 s → normal persisted cap restored. Recovery state + BQ test voltage are
  heartbeat telemetry. Test: deep light on good USB = LED rail OFF while it proves the cell — dark
  is correct here.
- **Tag lease**: dashboard checkbox = renewable addressed steady-green at 128; local power veto wins.

### `fx-260816-19c6bbb-b` — universal 300 mA precharge + solenoid policy v1
- 300 mA precharge default (REG0x10 `0x00F0`); deep trio recovery proven (+240…+295 mA on USB).
- Solenoid capability universal: one-time NVS migration to enabled, later explicit disarm preserved;
  armed idle = D7/GPIO37 INPUT/high-Z (433 MHz manual path preserved). Strikes stay addressed +
  fully gated. `--canopy-solenoid` is a no-op; `--solenoid-test` bench-only.
- Commission/basic-listener posture, channel 11.

### `fx-260816-prtrel1-b` — USB bringup / PROTECT-release rescue (`b`)
What our whole 08-16 flash day used. Expected sequence on a good flash:
8 MB flash / 2 MB PSRAM preflight → exact upload → guarded PROTECT clear → **automatic clean
software reboot immediately after qualified PROTECT release** → channel-11 ESP-NOW up → steady red.
- **PASS on the tool ≠ released**: guard_stage + a real charging window is the truth; dark + PASS on
  the card = charging, never re-flash (F40414 lesson: 3 identical uploads changed nothing).
- Bare boards report `battery_present=false` — commissioning-legit, not a fault.

### `fx-260816-otafix1-b` — PROTECT-recovery fix (3 fixtures still hold it)
**Known trap**: its in-RAM `park` flag doesn't clear on recovery — fixture climbs
PROTECT→LEDS_OFF→DIM→FULL with `led_rail_on=false` and sensors uninitialized until a **software
reboot**. Physical RESET is NOT a reliable release (can re-park). Prefer USB-installing `prtrel1-b`.

### `t`-class (never fleetable, exact-MAC-locked)
- `fx-260816-625fab1-t` — deep-LFP recovery, authorized **only `F2BFE0`** (since returned to fleet
  image). Posture: 50 mA precharge, 100 mA absolute ceiling, LED+sensor rails off, D7 clamped low,
  strikes refused, exact precharge-register readback gates enable.
- `fx-260816-e5ca3a0-t` — locked to `F401DC`, **never sent** (stale telemetry preflight refused it).

### Our listener lineage (`Lighting-Controller`, e.g. 71c4cf8-era `fixture-2026-08-15.4`)
The behavior ADR 0039 adopted: boot R→G→B salute (1.5 s each, keyed to first render) → plugged
<1 h = continuous RGB carousel ("ready to unplug") → unplugged = low-red ready beacon + MAC-derived
signature pop every 10 s → ToF presence <1.2 m = signature glow → any bridge command overrides.
⚠ Legacy `fixture-YYYY-MM-DD.N` strings are ambiguous by decision — never infer an image from them.

### Bridge `cores3-bridge-2026-08-17.1` — dark lease (bridge `4D5DB0` only)
`B<seconds>` broadcasts `PROG_COMMISSION_DARK` with hard cut, TTL 1–65535 s; `b` releases. RAM-only:
no profile/lifecycle/sleep/NVS change, no fixture OTA needed. Measured 08-17: fleet dark = ~72 mA
median per-fixture improvement (~12.5 W fleet swing); always-on radio floor confirmed ~126–144 mA.

---

## BENCH RULES THAT PROTECT THE RECORD

1. **Single OTA-writer** (ADR 0040 §7): firmware mutation is a declared single-operator session
   across ALL bridges/benches, with owner/source/artifact/targets called out. Our 08-16 collision
   (Ben's sweep over our bench) is the reason.
2. **OTA success** = fresh post-job heartbeat + exact expected revision + survival through the
   20 s pending-verify window. Upload ACK and cached `online` are insufficient. Pending images are
   forbidden to sleep — a `deepsleep` reset on the exact revision is itself acceptance evidence.
3. **Never rebuild a named artifact** — build once, distribute that binary. If we must rebuild
   locally, it gets its own recipe slug (our `cef34a4-b`), and we say so.
4. **Dark ≠ dead.** Check in order: scheduled sleep? (bedtime batches) · dark lease active? ·
   deep-cell recovery posture? · PROTECT? Only then suspect the flash.
5. Binaries carry compiled WiFi credentials → artifact dirs stay ignored/uncommitted; SHAs and
   manifests are what travel.

## How to refresh this ledger
`git fetch upstream` → read new entries at the TOP of `LOG.md` (newest-first) on Ben's most recent
branch (`git for-each-ref --sort=-committerdate refs/remotes/upstream`) → update the CURRENT STATE
block + add any new image's behavior section → bump the "Last refreshed" line with the upstream SHA.
