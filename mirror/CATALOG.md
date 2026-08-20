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
| A1 | Fleet census | `net_bench_dashboard` peer table | Heard-lights table: id · last-heard · fw. Counts always cite the listen window | `/api/state` peers | READ | ✅ ADOPTED (4aab1fed) |
| A2 | Stat tile | dashboard roll-ups | One number + label (alive, stale) | derived | READ | ✅ ADOPTED (4aab1fed) |
| A3 | Signal strength | per-peer `rssi_dbm` | Bars per light, worst first; honest empty on text-mode feeds | `/api/state` | READ | ✅ ADOPTED (4aab1fed) |
| A4 | Delivery meter | per-peer `pdr` / `dl_pdr` | Packet-delivery ‰ per light; loss-knee coloring per Ben's ratesweep verdicts | `/api/state` | READ | spec |
| A5 | Battery health | per-peer `battery_v/ma`, `soc_pct`, `power_tier` | mV·mA·SoC·tier rows; `soc=255`→"—" never 0; charging = negative mA; tier telemetry-authoritative (8d0b20ca) | `/api/state` | READ | ✅ ADOPTED (4aab1fed) |
| A6 | Charger truth | `bq_*` conditional block | BQ25628E register readout per light, only when the tail arrives | `/api/state` | READ | spec |
| A7 | Program truth | `ca_state` / `peer_mode` / choreo | Fleet distribution bar + its own staleness caveat (60 s on text bridge) | `/api/state` | READ | ✅ ADOPTED (4aab1fed) |
| A8 | Bridge status | dashboard `serial` block + `master.firmware_rev` | Bridge OS banner: fw id + 5 verb-capability chips (M1) | `/api/state` | READ | ✅ ADOPTED (6130755c) |
| A9 | AP scan list | `nb-scanap` rows | Nearby-AP table from bench peers (RF environment) | `/api/state` scans | READ | spec |
| A10 | Command audit | dashboard `last_command` + fence log | Every command that passed the fence, newest first; empty = healthy | local + `/api/state` | READ | ⏪ history |
| A11 | Flash chips | flash-station cards | CONNECTED / PASS / FAIL / UNPLUGGED per USB device | `/station` (GET-only) | READ | ✅ ADOPTED (4aab1fed) |
| A12 | Hold countdown | flash-station 90 s hold | Post-PASS "don't unplug" bars | station state | READ | ⏪ history |
| A13 | Feed settings | — (Mirror plumbing) | Where the Mirror listens (dashboard URL) | local | READ | ⏪ history |
| A14 | Identify | dashboard vetted `i/I` | One verb: NB_IDENTIFY per light / broadcast | fence | BLINK | ⏪ history |
| A15 | Rate control | vetted `R<hz>` (1–100 bounds) | Heartbeat-rate dial | fence | CONFIG | gated |
| A16 | Maintenance burst | vetted `U[id]` 35 s | Per-light OTA window opener | fence | OPS | gated |
| A17 | Charger config | vetted `m/C/G` (bounded) | VINDPM · capacity · charge-cap forms | fence | CONFIG | gated |
| A18 | Sleep / park | vetted `S/P` | Rail-cut controls | fence | OPS | gated |
| A19 | Ben's bench (embedded) | `net_bench_dashboard` UI itself | Elliot ×2: HIS page in an iframe, full-bleed on Fleet; honest BENCH-DOWN state; LIVE-commands caption | iframe :8765 | READ¹ | ✅ ADOPTED (94cdad95) |

¹ The iframe renders Ben's own UI, which contains live command controls — the
caption says so. The Mirror's fence governs only the Mirror's own emissions.

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

## D. From Ben's ADRs + wake-alignment howto (docs/decisions · docs/howto, ben/main)

Added 2026-08-20 during Elliot's "integrate Ben's work" sprint. Candidates only —
Elliot names, per the rule above. Sources are file-pinned on `ben/main`.

| # | Component | Source (Ben's doc/tool) | Simplified v1 form | Data | Tier | Status |
|---|---|---|---|---|---|---|
| D1 | L-survey monitor (M4) | ADR 0045 `NB_NEIGHBOR_REPORT` + bridge `L[sec]` | Survey state: window countdown · fragments arriving · per-peer neighbor counts; honest empty = "no survey running · no neighbor data on the wire"; gated `surveyCapable` (≥08-17.2). Feeds BLD's binding_sanity join | `/api/state` (nb-rssi — LX pin pending) | READ | spec (mine, next) |
| D2 | Fleet-wake countdown | `WORKSITE_WAKE_ALIGNMENT_2026-08-19.md` @ 6c046c4b | "Fleet wake ~Fri 23:11 PDT ± RC-clock drift" countdown. ⚠ PLAN-SOURCED, not telemetry — must carry a "per wake-alignment doc" label or it lies by omission | doc constant | READ | spec |
| D3 | Wake-bucket view | same howto §3 table (buckets A–E) | Classify awake fixtures: known-six / new-fw dark / new-fw lit / old-fw lit / old-fw dark — the operator's triage lens for the wake window | `/api/state` + doc constants | READ | spec |
| D4 | Sleep-drop labeling | howto §6 + ADR 0045 ("count slept only when it vanishes from fresh telemetry") | After a bridge `Q` echo in `/events`, label the fleet-wide drop "TRANSPORT SLEEP (Q<n> @ hh:mm)" instead of generic ghost; old-fw stragglers still heartbeating listed as "ignored Q (old fw)" | `/bench/events` + `/api/state` | READ | spec |
| D5 | Power-tier distribution | ADR 0046 + `power_tier` telemetry | One bar: fleet counts full/dim/LEDs-off/protect/unknown — the power veto at a glance | `/api/state` | READ | spec |

## C. Adoption protocol

1. Elliot names a component ("bring in A5").
2. If ⏪: restore from git history, re-verify against the live feed, register — one commit.
   If spec: build simplified against `/api/state` truth, verify, register — one commit.
3. CONFIG/OPS rows additionally need Ben's per-verb approval to extend the fence
   allowlist (a visible, reviewed commit) — never bundled with the UI commit.
4. Update the Status column here in the same commit.
