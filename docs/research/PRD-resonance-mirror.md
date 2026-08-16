# PRD — Resonance Mirror (DRAFT for Elliot's review)

> Status: **DRAFT v0.1** · 2026-08-16 · author: lighting-architect · reviewers: Elliot (product), Ben (protocol/firmware questions in §9)
> Research base: three-agent deep dive of this repo @ `b18938e` (ops/bench catalog · firmware data surfaces · docs/ADR sweep), 2026-08-16.
> Nothing here is built. This document is the research-layer output: parts located, contracts named, layers proposed.

---

## 1. What it is

**Resonance Mirror** is a new app, started from scratch, that **listens to the tree**. It renders the real tree geometry as a blank 3-D scene; as real fixtures broadcast on the mesh, they materialize on the tree. Clicking a light opens its card: name (editable), MAC id, firmware, battery, state, last-heard. Plugging in the bridge gives the **fleet dashboard**: every living light, its state and firmware, at a glance.

The firmware owns all behavior. The Mirror is a truthful window plus — later, and only with Ben's sign-off per verb — a narrow command surface fenced to **Ben's approved commands**.

**What it is not:** a controller, a frame streamer, a show engine, or a second OTA writer. The 2026-08-15 fleet incidents (our stack's idle-glimmer frames, parked leases, and OTA catcher overwriting Ben's rollout — see Ben's LOG 2026-08-16 "competing OTA writer") are the design's founding constraints.

## 2. Principles (normative)

1. **Read-only by construction.** The serializer can only emit types on the checked-in allowlist (§7). No allowlist entry → the bytes cannot be formed. A test pins the allowlist to the signed-off set.
2. **Ben's code only.** The radio stack is Ben's firmware + Ben's bridge. Zero components from the cambium *daemon* (Justin's Python) or `app/src/cambium.ts`. (One naming collision to be aware of: Ben's own bridge firmware has a binary serial build mode called `--cambium` — that is Ben's code, not the daemon. §5 makes this an explicit decision.)
3. **Unknown stays unknown.** Null is not 0 (a running fixture reports `life_state=null`; a dormant one reports real values — measured 2026-08-15). `soc=255` = no gauge reading. Heartbeat tails 5/10/12 arrive as *valid zeros that mean nothing* (fixture never populates them) — render as "—", never as 0.
4. **Never claim absence from a short listen.** Census counts are a function of listen time (25 s → 14, 300 s → 17, measured 2026-08-15). Last-heard windows on every surface.
5. **Pin every behavioral claim to a firmware string.** Two naming schemes are live in the field (`fixture-YYYY-MM-DD.N` and `fx-YYMMDD-<recipe>-<class>`). HEAD source (`fx-260816-dayzero-b`) differs behaviorally from the deployed fleet image (`fx-260816-otafix1-b`, → `prtrel1-b`). The Mirror displays what it hears and never infers behavior from source it hasn't verified against the deployed image.
6. **Layer by layer.** Each layer (§8) has a definition of done and ships before the next starts.
7. **Surface Ben's caveats with Ben's numbers.** INA 10× shunt correction, MAX17260 +8% gauge bias, solarsim ~15%-conservative energy. A number without its caveat is a lie of omission.

## 3. What we heard when we listened (the parts inventory)

Three-agent sweep, 2026-08-16. Full reports in session transcript; key holdings:

### 3.1 Live data surfaces (Ben's firmware)
| Surface | Transport | Contents | Cadence |
|---|---|---|---|
| `NbHeartbeat` short (29 B) | ESP-NOW → bridge → USB | batt mV/mA/SoC, reset reason, mode, dl_pdr, dl_rssi, supply | 5 s field / 1 s commission, ±30% jitter |
| `NbHeartbeat` full (148 B) | same | + fw_rev, maint_status, lifecycle, BQ25628E charger truth, config, **profile / life_state / power_tier / active_program** (tail 13) | 60 s ±30% |
| `NbChoreoState` (22 B) | ESP-NOW, 1 Hz | program_id, state, intensity, phase, flags (power-limited / lease / commission) | 1 Hz (basic-listener sends even at low cell) |
| `/telemetry` JSON | fixture HTTP, **maintenance mode only** | ~60 keys incl. full sensor block (ToF depth, tilt, sway, BMP temp/pressure), OTA state, charger registers | on demand; maint auto-expires 10 min |
| Serial CLI `t` | fixture USB | same JSON as `/telemetry` | on demand |
| Bridge STATUS (binary mode) | USB | mac, channel, tx/rx/drop/crc counters, fw | 1 Hz |

### 3.2 The bridge (CoreS3, Ben's `firmware/cores3_bridge`) — the Mirror's ear
One sketch, two relevant serial modes @115200:
- **Text mode** (default): `nb-master` / `nb-peer` ASCII lines at 1 Hz, plus ASCII command verbs with vetted ranges and built-in ×4/×6 repeat reliability. **Hard-filters RX to heartbeats** — choreo state never reaches USB; program truth goes 60 s stale.
- **Binary mode** (`--cambium` build flag — Ben's firmware, unfortunate name): COBS-framed, CRC-16/CCITT-FALSE, five frame types. Forwards **every** ESP-NOW packet with source MAC + per-packet RSSI (the substrate locate will need), incl. choreo at 1 Hz. Costs: we implement framing + command assembly + repeat logic ourselves (spec fully recovered from `cobs.h` + sketch; no daemon needed). §9 Q1 decides which mode.

### 3.3 Static/reference datasets loadable from the repo
| Dataset | Path | Use in Mirror |
|---|---|---|
| Designed geometry, 130 slots (ADR-0032-exact) | `app/public/fixtures.json` (schema 0.4.1) | the blank tree + seat positions |
| Fleet register (57 boards, 19 cols: fw rev+SHA, battery config, role, location, status) | `ops/fleet/registry.csv` | per-light card enrichment; bring-up record, **not** a deployment roster |
| Commissioning evidence (285 records) | `ops/fleet/bringup/*.jsonl` | provenance per MAC |
| OTA rollout records | `ops/bench/data/ca/*.jsonl`, `data/usb/*.jsonl` | firmware history per fixture |
| Canonical fleet table + measured power anchors | `docs/block-diagram/SYSTEM.md` | class specs, power context |
| ADR corpus (39 files, uniform headers) | `docs/decisions/` | parseable decision index |
| Locate solver + feasibility verdict | `ops/locate/`, `docs/tests/AUTOLOCATE_RSSI_SIM_FEASIBILITY_2026-07-12.md` | §6 |
| Solar sim datasets | `ops/solarsim/data/` | future overlay (with its ~15% caveat) |

### 3.4 Ben's existing dashboards (aggregate by consuming, never editing)
- `ops/bench/net_bench_dashboard.py` — serial-owning web dashboard; `GET /api/state` (normalized JSON snapshot — **the best-shaped schema in the repo; adopt its field names**), SSE 1 Hz, vetted command allowlist.
- `ops/bench/net_bench_monitor.py` (terminal), `perimeter_trio.html` (led_studio bench), `cots-mode-dashboard.html` (iframe grid).
- ADR 0037 "cricket console" — Ben's own handheld listen-first console direction; its non-negotiables (reuse packet.h, ordinary RX callback, no OTA/reboot opcodes on the tool surface, clamps in firmware) are adopted here as Mirror principles.

### 3.5 Identity model (the join key, and the missing link)
- `fixture_id` = last 6 hex of STA MAC (`ops/fleet/README.md`, `identity.cpp`). Join key across every dataset. Ports/IPs/roles/locations are explicitly not identity.
- **The MAC↔slot(F000–F129) binding exists nowhere in the repo.** Ben's TODO records it as unbuilt commissioning work; our app's Calibrate mode designed for it but it was never run at fleet scale. **The Mirror's naming/seating layer is this missing piece.**
- Three geometry generations coexist; only `app/public/fixtures.json` (130, metres) matches ADR 0032. Ben's TODO queues adopting a shared export as ground truth — coordinate, don't fork.

## 4. Product surfaces

1. **The Mirror (3-D)** — blank tree from `fixtures.json` geometry; heard fixtures materialize. Seated lights render at their slot; unseated lights float in a **staging halo**. Visual state from reported data only (never simulated): last-heard freshness, battery class, lifecycle, program-active.
2. **Fleet dashboard (grid)** — one row per heard MAC: name, fixture_id, fw_rev, battery mV/mA/SoC (sentinel-aware), lifecycle/tier/program (with staleness age), maint status, dl_pdr/rssi, last-heard. Sort/filter; registry.csv enrichment where MAC matches.
3. **Light card** — tap a light anywhere: identity (name editable), seat control, firmware + OTA state, battery/charger, commissioning provenance (bringup records), action buttons limited to the allowlist tier.
4. **UI shell** — reuse the TouchConsole mobile interface pattern (the v4 bottom-sheet: tap/hold, sheet heights, compact header) rewired to read-side state. Mobile-first, 375 px.

## 5. Architecture

```
[fleet ESP-NOW ch11] → [Ben's CoreS3 bridge, USB serial]
                            │
                 (A) Web Serial in browser  ← preferred if binary-mode parse proves clean in TS
                 (B) tiny read-only relay (net_bench_serial_bridge.py mold) → WebSocket
                            │
                    [protocol module: parse-only + allowlist serializer]
                            │
                    [store: MAC-keyed live state + persisted identity map]
                       │                │                 │
                  [3-D Mirror]   [Fleet dashboard]   [Light card]
```
- **No daemon requirement** in the design; if (B) is chosen it is a stateless pipe with no command path.
- **Browser reality check:** Web Serial needs a user gesture to grant the port — "plug in bridge → dashboard" means "plug in + one click." Stated here so it's a decision, not a surprise.
- **Persisted state owned by the Mirror:** exactly one file — the identity map `{mac_short → {name, slot, notes, seated_by, seated_at}}`. Local JSON, exportable; becomes the input to Ben's planned commissioning flow rather than a competitor to it.
- **New repo directory** `mirror/` in this repo (keeps fixtures.json + Ben sync in one place; zero imports from `app/` transport code). Reuse from `app/` is by copy-and-strip, not import, so no cambium dependency can ride in.

## 6. Locate story (research summary, build-later)

Two independent solvers agree: **triangulation does most of the work; humans finish it.**
- Ben's `ops/locate` (RSSI + ToF z-anchors): *"feasible at the optimistic-to-middle playa noise estimate… NOT hands-free-perfect"* — needs ~3 surveyed beacons; outputs auto-correct / **flagged** / silent-wrong.
- Our selfmap solver at true 12 m scale: no-anchor 0.000; 10 human confirms → 0.908; 20 → 0.977.

The wire slot exists (`NB_NEIGHBOR_REPORT`, type 22, censored-median RSSI — **defined, not sent**), the firmware keeps a local neighbor table, and Ben's TODO already plans the pairwise dump emitting the `ops/locate` JSONL contract. Mirror's role: staging halo + click-to-seat now; ingest the solver's auto-seats when Ben flips the channel on; the *flagged* bucket lands in the halo. No Mirror-side RF invention.

## 7. Command fence

- **Tier 0 (always):** listen. Everything in §3.1.
- **Tier 1 (proposed v1 allowlist):** `NB_IDENTIFY` only — broadcast and targeted. Evidence it's safe and useful: Ben used a 60 s broadcast identify as his fleet-wide rollout proof (LOG 2026-08-16); his TODO asks for identify improvements (longer blink, identify-by-ID). ⚠ Verify item: at HEAD, the bridge's own identify path hardcodes `color=0/blink=0` and the pixel-identify renderer appears unreachable — yet the deployed image visibly blinked. Behavior must be confirmed **against the deployed image** before L4 promises UX (§9 Q3).
- **Tier 2+ (each verb individually Ben-approved, default deny):** rate, capacity, charge-cap, maintenance entry/resume, sleep, profile, solenoid, program, direct frames, lifecycle force. The Mirror ships with these OFF; enabling one = a commit changing the allowlist file + a linked sign-off note.
- Enforcement: the serializer refuses non-allowlisted types; a unit test asserts allowlist == signed-off set; the UI renders no affordance for fenced verbs.

## 8. Layers (each gated on Elliot's go)

| Layer | Scope | Definition of done |
|---|---|---|
| **L0 Research** | this document + the three inventory reports | Elliot accepts PRD; Ben answers §9 or PRD amended |
| **L1 Blank tree** | `mirror/` scaffold; fixtures.json render; TouchConsole shell; staging halo (empty); zero radio code | opens on phone + desktop; 130 slots visible; no network calls |
| **L2 Ears** | protocol parse module (mode per §9 Q1) + fake-feed replay harness (recorded real heartbeats); fleet grid populates | replay drives grid + tree with recorded data; live bridge smoke test when hardware present; zero TX paths (test-enforced) |
| **L3 Identity** | light card; naming; click-to-seat; persisted identity map; registry.csv enrichment | name+seat survive reload; export map file |
| **L4 First command** | allowlist serializer + `NB_IDENTIFY` (pending §9 Q3 verification) | click → physical blink confirmed by eyes on deployed-image fixture |
| **L5+** | locate ingestion (when NB_NEIGHBOR_REPORT ships) · bench-data panels (`/api/state` consumption, JSONL history) · presence/sensor overlay (needs a Ben protocol decision — §9 Q4) | per-feature |
| **Future** | **Orchestrator**: rhythm/pacing/theme suggestions riding approved control types — never rapid per-light instruction. Separate PRD when we get there. | — |

## 9. Open questions for Ben (blocking marked ⛔)

1. ⛔ **Bridge mode for the Mirror's ear.** Text mode = simple, but drops `NbChoreoState` (program truth 60 s stale) and has no per-packet RSSI. Binary mode (`--cambium` flag — naming aside, it's your firmware) forwards everything + RSSI, but we'd implement COBS/CRC + command assembly ourselves. Which do you want a read-only consumer on? Would you accept a third build flag (`--listener`?) = binary framing, RADIO_TX compiled out entirely?
2. **Deployed-image wire truth.** Our analysis is of HEAD source; the fleet runs `fx-260816-otafix1-b` → `prtrel1-b`. Any wire-visible behavioral deltas we should know (heartbeat tails, choreo cadence, identify visuals)?
3. **Identify path.** LOG says broadcast identify blinked the fleet blue; HEAD source suggests bridge-sent identify can't reach the pixel renderer (color hardcoded 0; status-LED `..-` only). What actually fires on the deployed image, and does your planned identify rework (TODO: ~30 s / toggle / by-ID) change the packet?
4. **Sensor visibility.** ToF/tilt/sway/BMP data is invisible during normal ops (maintenance-only). Any appetite for a slow sensor tail or event packet post-event? (NB_EVENT is reserved already.)
5. **NB_NEIGHBOR_REPORT timing.** Your TODO has the pairwise-RSSI dump planned. Is that pre- or post-event? Mirror will consume the JSONL contract as-is either way.
6. **Found bug (your lane, your call):** audio-reactive mode filters targets by `fwRev.startsWith("fixture-")` (`cores3_bridge.ino:518-520`) — every `fx-*` fixture is excluded from audio direct frames.
7. **Geometry ground truth.** Adopt `app/public/fixtures.json` (130, ADR-0032-exact, metres) as the shared export replacing `ops/locate`'s 118-slot file, per your TODO:1275?

## 10. Reuse manifest

**Lift (copy-and-strip from `app/`):** R3F tree scene + camera rig (TreeLights/Scene), fixtures.json loader + validation + stale-units guard, census honesty (heard-windows, litState UNKNOWN), TouchConsole UI pattern, names overlay concept (`names.ts` → identity map).
**Consume (Ben's, unmodified):** packet.h struct layouts (+ its golden layout tests as our vectors), cobs.h framing spec, net_bench_dashboard normalized field names, registry.csv, bringup/OTA JSONL, fixtures geometry, SYSTEM.md/ADR reference data.
**Leave behind (do not port):** cambium daemon + `cambium.ts`, every TX driver (AutoVJ/Ignition/Presence/DJ/audio), frame pump, lease machinery, show engine, OpenRouter operator (revisit at Orchestrator).

---
*Draft ends. Elliot: mark up anything; §9 goes to Ben in whatever form you prefer (room message or a short doc PR).*
