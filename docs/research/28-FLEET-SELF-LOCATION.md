# 28 — FLEET SELF-LOCATION + CLICK-TO-CONTROL (design)

> **Written:** 2026-08-18, lighting-architect. Elliot's directives: *"see the fleet locating
> themselves in the world"* · *"lights clickable and controllable from the visualizer"* ·
> three-lane build (blender = world visualizer · network-tester = app · lighting = comms).
> All firmware claims verified at upstream `1f1edfd`. Design only — builds ride the protocol
> (26-contract §0: simple · test-first · every feature BETA until Elliot confirms in-app).

---

## 1 · SIGNALS WE ACTUALLY HAVE (source-verified)

| Signal | State | Field truth |
|---|---|---|
| **Class census** (STEMMA glyphs in the grid) | LIVE in every rich hb | 72 downlight / 24 perimeter / 18 chandelier / 16 uplight seats → location is FOUR small class-constrained matching problems, not one 130-way puzzle. ⚠ the 11 broken-census fixtures (class 4 / bits 0) fall out of this prior until physically reseated |
| **Identify/tag render** | LIVE — but `fixture.ino:168`: renders **only when `color > 0`** | Bridge `i`/`I` send color=0 → **pixel-invisible** (status-LED only). `T<id>:1` (green 128, 255 s renewable) is the visible instrument. **This closes PRD §9's "identify contradiction"** — it was never a deployed-vs-HEAD mystery, it's the color-0 default |
| **Full identify vocabulary** | in packet + fixture (`led_driver.cpp:189-211`) | color 1 red / 2 green / 3 blue / 4 amber / 5 white · blink (500 ms) · value 1-255 · secs 1-255. **Not yet reachable**: bridge serial + dashboard only expose the hardcoded green `T` — a small Ben ask unlocks the palette |
| Fixture→bridge RSSI | LIVE per heartbeat | one anchor only — topology hints, not position |
| Wave adjacency (each origin forwards to its 2 strongest neighbors) | on air, but **bridge ingress drops NB_EVENT** (`.ino:628-633` accepts types 1+7 only) | a free proximity graph exists in the air; logging it is a one-line-class Ben ask |
| `NB_NEIGHBOR_REPORT` (22) | reserved, never sent | Ben's intended future answer to exactly this |
| GPS / UWB / FTM | none | tree frame → world frame = survey 2 anchor points once |

## 2 · LOCATION LADDER (recommendation: L0 now → L1 automation → L2 verification)

- **L0 — seat-binding UI + tag walk (available the day the ruling lands).** Mirror shows the
  3-D seats (blender's worksite scene) + the live peer list; operator taps a peer → `T<id>:1`
  green tag via dashboard `/api/cmd` (Ben-approved surface, audited, reversible) → taps the seat
  it lit at → binding row written (Mirror-owned table; exists nowhere in firmware — Ben's TODO
  agrees). ~91 fixtures × ~15 s ≈ 25 min of crew time. Class prior auto-filters the candidate
  seats per tap.
- **L1 — camera-automated binding (the "self-locating" magic, zero firmware change).** Night,
  phone/tripod camera on the hang; script drives tag round-robin (2-3 s green per fixture,
  sequenced via `/api/cmd`); CV finds which blob lights in each window → image-space position
  per MAC; register `fixtures.json` (130 seats, metres) into the camera view (blender lane) →
  bipartite match per class. 91 fixtures ≈ 5 min of blinking. OpenCV already lives on this Mac.
- **L2 — radio geometry as CONTINUOUS VERIFICATION, never placement.** RSSI in a dense
  bamboo+bodies hang is ±metres; its value is drift detection ("is F40364 still where the
  binding says?"). Cheapest path needing no firmware change: a **second CoreS3 flashed as a
  listen-only bridge** (the two-bridge hazard is command WRITES; a silent listener just hears
  heartbeats with its own per-peer RSSI) at 2-3 surveyed positions → multi-anchor matrix.
  Constraint: second dashboard instance runs `--udp-host ""` (else two broadcasters flap the
  station's mesh overlay). Ben-ask alternatives: log NB_EVENT at the bridge (wave adjacency
  free-rides the art) or wire NB_NEIGHBOR_REPORT.
- **L3 — not now:** FTM/UWB ranging. Park unless Ben raises it.

**World frame:** fixtures.json is tree-local metres; survey two ground-truth points at the
worksite once (GPS or tape from datum) and every bound light inherits playa coordinates.

## 3 · CLICK-TO-CONTROL LADDER (Elliot: "clickable and controllable")

- **C0 — TODAY, zero changes:** click a light in the visualizer → `T<id>:1` → that light goes
  steady green 128 for 255 s (renew every ≤120 s like the dashboard does); click again →
  `T<id>:0` release. Tag wins render arbitration over wave/program; power veto still caps;
  RAM-only; addressed. This is real per-light control inside the existing Ben-approved fence.
- **C1 — full palette, small Ben ask:** the packet and fixture already do red/green/blue/amber/
  white × blink × brightness × duration — only the bridge serial grammar (`T<id>:1` hardcodes
  green) and the dashboard allowlist stand between us and "click → pick a color". Proposed ask:
  extend `T` to `T<id>:<color>[:<value>[:<blink>]]` + matching `/api/cmd` pattern. Risk profile
  identical to C0 (same packet type, same arbitration, same veto).
- **C2 — LATER, gated:** program leases / DIRECT frames per click (real shows). Stays behind
  the CONFIG/OPS registry throw until Elliot + Ben open it (PRD §7). Not needed for locate.

## 4 · PREREQUISITES (blocking, in order)

1. **F106–F129 perimeter ruling** (r 15.07 / z 1.487, span-guard 30.2 m) — binding MACs to
   seats that are about to move is wasted crew time. **This decision has been open since the
   08-17 briefing and is now load-bearing.** My recommendation stands: approve.
2. **STEMMA reseats** (11 fixtures) — restores the class prior for those units.
3. Holdbacks (F3FD88 legacy image etc.) — they can't render tags reliably; bind them by hand.

## 5 · PROPOSED THREE-LANE SPLIT (Elliot confirms)

| Lane | Owns |
|---|---|
| **network-tester** (app) | Seat-binding UI + Mirror-owned binding table · click→tag C0 (via `/api/cmd`, audited) · BETA confirm controls |
| **blender-architect** (world visualizer) | Worksite scene truth (Ed GLB + ring + seats from fixtures.json) · camera↔model registration for L1 · rendering bound vs unbound seats |
| **lighting** (comms) | The tag/identify contract + rate discipline (≤120 s renew, one writer) · L1 CV script + camera experiment · L2 listen-only-bridge experiment · Ben asks (palette `T` grammar · NB_EVENT logging · neighbor report) · contract updates |

## 6 · EXPERIMENTS (each test-first, BETA, eyes-verified)

- **E1 (tonight-able):** `T<id>:1` on one bench light → confirm steady green 128, confirm
  release, confirm renewal keeps it lit past 255 s. Eyes on the fixture = the acceptance test.
- **E2:** tag round-robin over ~6 bench lights + phone video → CV picks the right blob per
  window ≥ 5/6. Pass gates L1.
- **E3:** second CoreS3 as listen-only ear at a second position → per-peer RSSI matrix sanity
  (near lights louder than far) before anyone dreams of trusting it.
