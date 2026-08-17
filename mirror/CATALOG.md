# Mirror Component Catalog

v1 · 2026-08-17 · network-tester · companion to DESIGN.md

**The rule this document serves (Elliot):** the live palette stays BLANK. Every
entry here is a *candidate* — componentized on paper, simplified, source-pinned —
and becomes real only when Elliot names it. Adoption = one reviewed commit that
registers exactly one component. Several already have working implementations in
git history (marked ⏪ — restorable in minutes); the rest are specs.

Tiers follow the wire fence: READ observe · BLINK benign visual · CONFIG/OPS
gated behind individual Ben approval (PRD §7). CONFIG/OPS entries are listed for
completeness and CANNOT register in v1 (the registry throws).

## A. From Ben's bench tools (`ops/bench/`, `tools/`)

| # | Component | Source (Ben's tool) | Simplified v1 form | Data | Tier | Status |
|---|---|---|---|---|---|---|
| A1 | Fleet census | `net_bench_dashboard` peer table | Heard-lights table: id · last-heard · fw. Counts always cite the listen window | `/api/state` peers | READ | ⏪ history |
| A2 | Stat tile | dashboard roll-ups | One number + label (alive, stale) | derived | READ | ⏪ history |
| A3 | Signal strength | per-peer `rssi_dbm` | Bars per light, worst first; honest empty on text-mode feeds | `/api/state` | READ | ⏪ history |
| A4 | Delivery meter | per-peer `pdr` / `dl_pdr` | Packet-delivery ‰ per light; loss-knee coloring per Ben's ratesweep verdicts | `/api/state` | READ | spec |
| A5 | Battery health | per-peer `battery_v/ma`, `soc_pct` | mV·mA·SoC rows; `soc=255`→"—" never 0; charging = negative mA | `/api/state` | READ | ⏪ history |
| A6 | Charger truth | `bq_*` conditional block | BQ25628E register readout per light, only when the tail arrives | `/api/state` | READ | spec |
| A7 | Program truth | `ca_state` / `peer_mode` / choreo | Fleet distribution bar + its own staleness caveat (60 s on text bridge) | `/api/state` | READ | ⏪ history |
| A8 | Bridge status | dashboard `serial` block | Connected · port · line count · master id/channel — is the ear alive? | `/api/state` | READ | spec |
| A9 | AP scan list | `nb-scanap` rows | Nearby-AP table from bench peers (RF environment) | `/api/state` scans | READ | spec |
| A10 | Command audit | dashboard `last_command` + fence log | Every command that passed the fence, newest first; empty = healthy | local + `/api/state` | READ | ⏪ history |
| A11 | Flash chips | flash-station cards | CONNECTED / PASS / FAIL / UNPLUGGED per USB device | station state (TBD w/ LX) | READ | ⏪ history |
| A12 | Hold countdown | flash-station 90 s hold | Post-PASS "don't unplug" bars | station state | READ | ⏪ history |
| A13 | Feed settings | — (Mirror plumbing) | Where the Mirror listens (dashboard URL) | local | READ | ⏪ history |
| A14 | Identify | dashboard vetted `i/I` | One verb: NB_IDENTIFY per light / broadcast | fence | BLINK | ⏪ history |
| A15 | Rate control | vetted `R<hz>` (1–100 bounds) | Heartbeat-rate dial | fence | CONFIG | gated |
| A16 | Maintenance burst | vetted `U[id]` 35 s | Per-light OTA window opener | fence | OPS | gated |
| A17 | Charger config | vetted `m/C/G` (bounded) | VINDPM · capacity · charge-cap forms | fence | CONFIG | gated |
| A18 | Sleep / park | vetted `S/P` | Rail-cut controls | fence | OPS | gated |

## B. From the original controller (TouchConsole / twin `app/src`)

| # | Component | Source | Simplified v1 form | Tier | Status |
|---|---|---|---|---|---|
| B1 | 3-D tree stage | `Scene.tsx` + worksite GLB | Ed-model tree + rings + slots + heard lights | READ | ✅ ADOPTED |
| B2 | Orbit navigator | `App.tsx:95` + `Scene.tsx:291` | Twin camera + OrbitControls verbatim, ⌂ reset | READ | ✅ ADOPTED |
| B3 | Bottom mode bar | `TouchConsole.tsx` | Fixed nav · 52px tabs · amber active · sheets 62% | — | ✅ ADOPTED |
| B4 | Locate / seat map | `selfmap.ts` (848 ln) | Staging field (radius-real) + drag-to-pin + slot snap; full pairwise solve awaits packet 22 | READ | ✅ partial |
| B5 | Pattern picker | 40 looks, grouped (08-15 work) | Grouped look grid — but driving the REAL fleet is NB_SHOWFRAME = OPS | OPS | gated |
| B6 | Master intensity | `Control.intensity` | One slider — fleet-wide via bridge = OPS | OPS | gated |
| B7 | Cue list ("looks") | `resonance.cues` | Save/recall named looks — sim-side only until OPS opens | OPS | gated |
| B8 | Show player | `LightShow` (AWAKENING…) | Timeline play — OPS | OPS | gated |
| B9 | Sound meter | `AudioReactiveDriver` | Local-mic level meter, display-only | READ | spec |
| B10 | Group manager | `namedGroups` | Name a set of seated lights (local metadata only) | READ | spec |
| B11 | Light card | twin fixture card | Tap a dot → id · status · rssi · fw | READ | ✅ ADOPTED (read-only) |

## C. Adoption protocol

1. Elliot names a component ("bring in A5").
2. If ⏪: restore from git history, re-verify against the live feed, register — one commit.
   If spec: build simplified against `/api/state` truth, verify, register — one commit.
3. CONFIG/OPS rows additionally need Ben's per-verb approval to extend the fence
   allowlist (a visible, reviewed commit) — never bundled with the UI commit.
4. Update the Status column here in the same commit.
