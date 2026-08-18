# Mirror 3-D stage — testing protocol

Three lanes. Run lane 1 after EVERY change to Scene3D/locate/store-send; lane 2
when touching dropout/silent-seat logic; lane 3 once per install session.

## Lane 1 — automated regression (~20 s)

`stage_test.playwright.js` next to this file, run via the Playwright MCP:
`browser_run_code_unsafe({ filename: '<abs path>/stage_test.playwright.js' })`

Covers: feed chip · census shape · tap-slot select · orbit-preserves-card ·
empty-tap dismiss · camera reset · tag wire shape (`T<MAC6>:1` — INTERCEPTED,
never reaches the radio) · seat → census+1 → localStorage persist → unseat.
Runs in an isolated browser context: it can never touch an installer's seat map.
9 checks, all must pass. It requires the dev server on :4180 with SOME feed
(live :8765 or stub — see lane 2).

## Lane 2 — scripted dropout (stub feed, ~3 min)

The live feed can't be made to drop a light on cue. `bench_stub.py` (this dir)
replays a captured real snapshot on **127.0.0.1:8766** with two scripted
behaviors on the two strongest captured MACs: DROPPER (20 s heard / 75 s
silent — crosses the 60 s listen window) and GHOST (1 h stale).

1. Point the app at the stub (BENCH_PORT=8766 or Settings → data source).
2. Seat the DROPPER MAC on any slot.
3. Wait ≤ 95 s: census must flip to `… seated (1 silent)` and the dot must go
   MUTED — never vanish. Card must read `silent · last heard Ns ago`.
4. GHOST must never appear in "heard" or the seat picker.
5. Wait for DROPPER's return: dot back to full, `(1 silent)` gone.

## Lane 3 — real-device, real-radio (once per install session)

- Phone on the camp LAN → `http://<mac-ip>:4180` (IP printed by `npm run dev
  -- --host`). Feed chip green.
- One-finger orbit, pinch zoom (camera must never go under the ground or lose
  the tree), ⌂ reset.
- Tap a slot → picker lists strongest-RSSI first → **Tag** → CONFIRM THE
  PHYSICAL LIGHT GOES STEADY GREEN (this is the one deliberate real-radio
  step; the automated lane never fires it — and it doubles as the C0
  closed-loop confirmation MIRROR's telemetry test could not settle) →
  Seat → dot appears at the slot → Untag.
  ⚠ KNOWN-INERT until bridge E39A34 is reflashed to fw ≥2026-08-16.1:
  the 08-15.1 bridge has no `case 'T'` and silently swallows tags (LX,
  source-verified). The dashboard's ok:true only means written-to-serial.
  Reflash is escalated to Elliot; DELETE this caveat once it lands.
- Kill the light's power (or walk it out of range): within 60 s the census
  shows `(1 silent)` and the dot goes muted. Restore: it recovers.
- Two phones? Remember seats are PER DEVICE until the shared seat layer ships
  — one designated seating phone per session.

## Known gaps the protocol does NOT cover yet

- Orbit clamp values asserted only by eye (lane 3), not by camera introspection.
- Self-located population is structurally empty until the firmware ships
  neighbor reports (adapter maps no `neighbors` — solver springs never form).
- perimeter_slots.json ids are pre-LX (`PL-NN-A/B`); the F-id re-key is a
  rename gated on LX's ack.
