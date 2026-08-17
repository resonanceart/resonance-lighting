/**
 * The Mirror layout contract.
 *
 * Deliberately the same shape family as the Resonance Network profile builder
 * (ContentBlock: id / type / order / visible / label / config / content) so the
 * two systems stay mentally interchangeable: a PAGE is a stack of WIDGET
 * INSTANCES, each pointing at a registered widget type plus per-instance config.
 * The whole UI is one JSON document — customizing the interface is editing
 * this document in-app, never editing code.
 */

/** Wire-risk tier, mirroring packet.h's command taxonomy. The registry refuses
 *  to register any widget whose tier is not in ALLOWED_TIERS (v1: READ+BLINK). */
export type Tier = 'READ' | 'BLINK' | 'CONFIG' | 'OPS'

export interface WidgetInstance {
  id: string
  /** Registered widget type key, e.g. 'stat-tile' */
  type: string
  /** User override of the widget's default label */
  label?: string
  /** Grid columns spanned (page grid is 2 columns on mobile) */
  span: 1 | 2
  visible: boolean
  /** Widget-type-specific settings, edited via the widget's configFields */
  config: Record<string, unknown>
}

export interface PageDef {
  id: string
  label: string
  /** Emoji/symbol shown in the bottom tab bar */
  icon: string
  widgets: WidgetInstance[]
}

export interface LayoutDoc {
  version: 1
  name: string
  pages: PageDef[]
}

/** Simple schema for auto-generated per-widget config forms. */
export type ConfigField =
  | { key: string; label: string; kind: 'text'; placeholder?: string }
  | { key: string; label: string; kind: 'number'; min?: number; max?: number }
  | { key: string; label: string; kind: 'toggle' }
  | { key: string; label: string; kind: 'select'; options: { value: string; label: string }[] }

/** Live telemetry snapshot handed to every widget each tick (mock today,
 *  net_bench_dashboard /api/state adapter tomorrow — same shape).
 *
 *  ADAPTER CONTRACT (PRD: the dashboard's field names are canonical). The
 *  /api/state per-peer row maps 1:1 onto this view model:
 *    id → fixtureId · battery_v*1000 → battMv · battery_ma → battMa ·
 *    soc_pct → soc (255 = no gauge) · rssi_dbm → rssi · dl_pdr*1000 →
 *    pdrPermille · age_ms → lastHeardMs · firmware_rev → fwRev.
 *  There is no separate mac field — the id IS the short-MAC fixture id —
 *  and no last_seen: recency is age_ms + the envelope ts_utc. */
export interface FixtureState {
  fixtureId: string // last 6 hex of MAC
  /** 'unknown' when the source is the live wire — class comes from the
   *  registry join, not the heartbeat. */
  cls: 'downlight' | 'perimeter' | 'chandelier' | 'trunk' | 'unknown'
  battMv: number
  battMa: number
  /** 255 = no gauge reading. Render '—', never 0. */
  soc: number
  rssi: number
  pdrPermille: number
  /** ms since last heartbeat — census honesty window.
   *  Contract §2: this is age_ms = FIXTURE-reported downlink age. */
  lastHeardMs: number
  /** Bridge-side row freshness (now − row.ts_utc) — the other staleness axis.
   *  Undefined when the row carries no ts_utc. */
  rowAgeMs?: number
  fwRev: string
  activeProgram: string
  /** null on a running fixture; real value only when dormant. null ≠ 0. */
  lifeState: string | null
  usb?: { state: 'CONNECTED' | 'PASS' | 'FAIL' | 'UNPLUGGED'; port: string; holdRemainingS?: number }
  /** Pairwise neighbor RSSI — the NB_NEIGHBOR_REPORT shape (censored-median,
   *  ≤8 neighbors). Mock fills it; the live wire leaves it undefined until Ben
   *  enables packet 22 (PRD Q5). Absence = staging halo, never guessed positions. */
  neighbors?: { id: string; rssi: number }[]
}

export interface Telemetry {
  now: number
  listenWindowS: number
  fixtures: FixtureState[]
}

export interface WidgetDataProps {
  config: Record<string, unknown>
  telemetry: Telemetry
  /** Fenced command emitter — throws on any verb outside the v1 allowlist. */
  send: (cmd: MirrorCommand) => void
}

/** v1 sendable surface: exactly one verb. */
export type MirrorCommand = { verb: 'NB_IDENTIFY'; target: string | 'all' }
