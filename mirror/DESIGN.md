# Resonance Mirror — Component Library & No-Code Console Design

v0.2 · 2026-08-16 · network-tester lane · companion to `docs/research/PRD-resonance-mirror.md`

## What this is

The Mirror's UI is **one JSON document rendered by a widget registry**. Operators
compose their own console screens in-app (add/arrange/configure widgets, make
pages, share layouts) — no code changes. This document records the research that
validates the pattern, the contracts, and the v1 scope Elliot set.

## Elliot's v1 scope (2026-08-16, verbatim intent)

1. A **light dashboard** — fleet status that reports **only lights it can hear**.
2. **Locate**: heard lights place themselves in space in proportion to each
   other and to fix points we give them — "essentially locate mode of the
   simulator" (`app/src/selfmap.ts`, copy-and-strip).
3. **Bare bones, no background processes** — static browser app; the only live
   connection is the browser's own EventSource to Ben's dashboard.
4. **Skeleton to grow on** — features land as widgets on the TouchConsole-style
   tab shell.
5. **Flash Station is the onboarding** — flash → heard → staged → seated is the
   system's front door.

## Research: how the field solves "customize without code"

| Product | Customization model | What we take |
|---|---|---|
| **QLC+ Virtual Console** | Drag-drop operator consoles from a widget set (buttons, sliders, frames, cue lists, XY pads). Hard **Design vs Operate mode split** — edit affordances are disabled in Operate so a live show can't be accidentally restructured. | Our Edit/Done toggle; v1.1: an *operate lock* so edit mode can be disabled entirely during live operation. |
| **Home Assistant dashboards** | Storage-mode dashboards are **JSON documents** edited via a GUI card editor. Every card type registers defaults (`getStubConfig`) and a config editor (`getConfigElement`); a card picker lists the registry. | Exactly our `WidgetDef.defaults` + `configFields` + palette. Later: per-widget custom config components when schema forms run out, conditional visibility. |
| **TouchOSC / Open Stage Control** | Control surfaces are **documents** (`.tosc`, JSON5) built in an editor and run by a thin client; parts copy between documents; one server, many client screens. | Export/import of `.mirror.json` layout docs; sharing layouts between phones/laptops is file-passing, no server. |
| **net_bench_dashboard.py** (in-repo precedent) | Vetted command panel behind a **grammar validator** — fixed literal set + per-verb regex with numeric bounds; invalid never reaches the port. | Our fence is the same idea one level up: tier gate at registry (build-time throw) + verb allowlist at emission (runtime throw) + audit log. |

Sources: [QLC+ Virtual Console docs](https://docs.qlcplus.org/v4/virtual-console) · [QLC+ styling/placement](https://docs.qlcplus.org/v4/virtual-console/styling-and-placement) · [HA dashboard cards](https://www.home-assistant.io/dashboards/cards/) · [HA custom card API](https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/) · [TouchOSC editor](https://hexler.net/touchosc/manual/editor) · [Open Stage Control editor](https://openstagecontrol.ammd.net/docs/user-interface/editor/)

## Contracts (implemented)

### Layout document
`LayoutDoc { version: 1, name, pages: PageDef[] }` · `PageDef { id, label, icon, widgets }` ·
`WidgetInstance { id, type, label?, span: 1|2, visible, config }`.
Persisted to localStorage, exportable/importable as `<name>.mirror.json`.
Same shape family as the Network profile builder's `ContentBlock` — deliberately.

### Widget registry
`WidgetDef { type, title, icon, tier, description, defaults, configFields, component }`.
Registering a widget outside tiers READ/BLINK **throws at module load** — the
build-nothing-new line is enforced by construction, not review.

### Command fence
`send()` allowlists exactly `NB_IDENTIFY` (v1), audit-logs every emission.
Growing Tier 2 = a reviewed commit changing the allowlist, per PRD §7.

### Telemetry adapter
`net_bench_dashboard.py` field names are canonical (PRD-normative):
`GET /api/state` snapshot + `GET /events` SSE (`snapshot` event, full state @ 1 Hz).
Absent heartbeat tails map to honest unknowns (`soc=255` → "—", `null ≠ 0`),
never fabricated values. The mock provider implements the same `Telemetry`
shape with the fleet's real quirks (two fw naming schemes, gaugeless units,
stale fixtures) so widgets are built against reality before hardware arrives.

## Honesty rules (inherited from the inventory, enforced in widgets)

- Fleet views render **only fixtures heard**; counts always cite the listen window.
- `soc=255` = no gauge → "—", never 0. `life_state=null` = running, not unknown.
- Program truth carries its own staleness caveat (60 s on a text-mode bridge).
- RSSI widgets render an honest empty state on feeds that carry no per-packet RSSI.

## v1 locate plan (next increment)

Copy-and-strip `app/src/selfmap.ts` (848 lines; measured: 10 human confirms →
0.908 accuracy, 20 → 0.977). Constellation widget: fix-point anchors placed by
the operator, force layout from pairwise proximity, staging halo for
heard-but-unplaced lights, click-to-seat. Data honesty: true light↔light
ranging needs `NB_NEIGHBOR_REPORT` (packet 22 — defined, never sent; PRD Q5 to
Ben). Until then the solver runs on bridge-side RSSI + human seats; the packet
flipping on is a data upgrade, not a rework.

## Flash Station = onboarding (agreed direction)

The commissioning flow becomes the system's front door: a light is flashed at
the station (`tools/flash-station.py`, watch-only) → appears in the Mirror's
heard set → staged in the halo → seated by a human in Locate. Open question
with lighting-architect: how the Mirror's Flash page consumes station state
with zero background processes (does the station expose JSON, or do we read
the bring-up JSONL another way).

## Roadmap

- v0.1 ✅ registry + layout doc + edit mode + Flash Station trio + fleet/battery/identify
- v0.2 ✅ live adapter (dashboard :8765) + signal/program/audit widgets + source chip
- v0.3 ⟶ locate constellation (selfmap port) + seat map persistence (the L3 identity map)
- v0.4 ⟶ registry join (class/role enrichment from `ops/fleet/registry.csv` snapshot, honest "bring-up record ≠ deployment roster" framing)
- v1.0 ⟶ operate lock · named layout presets per role · Flash page consuming station state
