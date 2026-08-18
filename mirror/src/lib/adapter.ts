import type { FixtureState, Telemetry } from './types'

/**
 * Live adapter for ops/bench/net_bench_dashboard.py.
 *
 * Snapshot:  GET <base>/api/state
 * Stream:    GET <base>/events — SSE, single event name 'snapshot',
 *            the ENTIRE state re-pushed every 1.0 s (not deltas).
 *
 * Field names follow the dashboard's canonical schema (see types.ts).
 * Everything here is defensive: the dashboard merges heartbeat tails
 * conditionally, so any field can be absent — absence maps to the honest
 * unknowns (soc 255, null, '—'-rendered zeros), never to fabricated values.
 */

type PeerRow = Record<string, unknown>

/** fixture_context.h FixtureClass — wire/NVS-stable byte values. */
const CLASS_BY_WIRE: Record<number, FixtureState['cls']> = {
  0: 'unknown',
  1: 'downlight',
  2: 'perimeter',
  3: 'uplight',
  4: 'chandelier',
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function mapPeer(id: string, row: PeerRow, now: number): FixtureState {
  const battV = num(row.battery_v)
  // dl_pdr arrives either as a 0..1 ratio or already per-mille depending on
  // firmware tail; normalize on the safe side of the ambiguity.
  const rawPdr = num(row.dl_pdr) ?? num(row.pdr)
  const pdrPermille = rawPdr === undefined ? 0 : rawPdr <= 1 ? Math.round(rawPdr * 1000) : Math.round(rawPdr)
  // Contract §2 (26-MIRROR-STATE-CONTRACT @ 5bb0e30): at the /api/state layer
  // the no-gauge sentinel is -1 (bridge translates wire-255 → -1,
  // cores3_bridge.ino:969); a literal 255 here is an untranslated path and
  // equally not a reading. View-model sentinel stays 255 → renders "n/a".
  const rawSoc = num(row.soc_pct)
  const rowTs = str(row.ts_utc)
  return {
    fixtureId: id.toUpperCase(),
    cls: CLASS_BY_WIRE[num(row.fixture_class) ?? 0] ?? 'unknown',
    battMv: battV !== undefined ? Math.round(battV * 1000) : 0,
    battMa: num(row.battery_ma) ?? 0,
    soc: rawSoc === undefined || rawSoc < 0 || rawSoc === 255 ? 255 : rawSoc,
    rssi: num(row.rssi_dbm) ?? num(row.dl_rssi_dbm) ?? 0,
    pdrPermille,
    lastHeardMs: num(row.age_ms) ?? 0,
    // Contract §2: age_ms is the FIXTURE-reported downlink age; bridge-side
    // row freshness is now − row.ts_utc. Carried separately so widgets can
    // cite the right staleness; rendering still keys on age_ms everywhere
    // (one consistent window — divergent counts would be a lie of divergence).
    rowAgeMs: rowTs ? Math.max(0, now - Date.parse(rowTs)) : undefined,
    fwRev: str(row.firmware_rev) ?? '—',
    activeProgram: str(row.active_program) ?? str(row.ca_state) ?? str(row.peer_mode) ?? '—',
    ledR: num(row.led_r) ?? null,
    ledG: num(row.led_g) ?? null,
    ledB: num(row.led_b) ?? null,
    lifeState: str(row.field_phase) ?? null,
  }
}

export function mapState(json: unknown): Telemetry {
  const root = (json ?? {}) as Record<string, unknown>
  const peers = (root.peers ?? {}) as Record<string, PeerRow>
  const serial = (root.serial ?? {}) as Record<string, unknown>
  const master = (root.master ?? {}) as Record<string, unknown>
  const now = Date.now()
  return {
    now,
    // Client rendering choice, labeled as such in every widget that cites it
    // (contract §2). Must match the widgets' alive filter — the census line
    // cites this number, and a mismatched citation is a small lie.
    listenWindowS: 60,
    serialConnected: serial.connected === true,
    serialError: str(serial.error) ?? null,
    bridgeFwRev: str(master.firmware_rev) ?? null,
    fixtures: Object.entries(peers).map(([id, row]) => mapPeer(id, row, now)),
  }
}

/** Freshness triple-rule (contract §2 @ 16ed84d): LIVE only when the ear is
 *  up AND the fixture reported recently AND the row itself is fresh. GHOST =
 *  ever-seen but stale past 6 min (memo 27 §6). Everything else = LAST-SEEN. */
export type PeerLiveness = 'live' | 'last-seen' | 'ghost'
const GHOST_MS = 360_000

export function liveness(t: Telemetry, f: FixtureState): PeerLiveness {
  if (t.serialConnected && f.lastHeardMs < 5000 && (f.rowAgeMs ?? Infinity) < 3000) return 'live'
  return Math.max(f.lastHeardMs, f.rowAgeMs ?? 0) >= GHOST_MS ? 'ghost' : 'last-seen'
}

/** Heard within the labeled window — on BOTH axes, so a frozen age_ms (ear
 *  down, HTTP still serving) can never keep a fixture "heard" forever. */
export function isHeard(t: Telemetry, f: FixtureState): boolean {
  const win = t.listenWindowS * 1000
  return f.lastHeardMs < win && (f.rowAgeMs === undefined || f.rowAgeMs < win)
}

/** Verb capability gates (design 28 rule 5 + the 08-15.1 no-`case 'T'`
 *  incident). A bridge only gets a verb its firmware is KNOWN to forward —
 *  older bridges swallow unknown opcodes char-by-char while the dashboard
 *  still prints Sent. FAIL CLOSED: null/unparseable fw (the reconnect
 *  boot-banner window) counts as incapable until the bridge introduces
 *  itself. Two capabilities, two thresholds (LX): T tags land in 08-16.1;
 *  B dark-lease lands one version later in 08-17.1. Date compares are safe
 *  lexicographically (ISO); the trailing .N is parsed numerically — '.10'
 *  must not sort before '.2'. */
function fwAtLeast(fw: string | null, date: string, minor: number): boolean {
  const m = fw?.match(/(\d{4}-\d{2}-\d{2})\.(\d+)$/)
  if (!m) return false
  return m[1] > date || (m[1] === date && Number(m[2]) >= minor)
}

export function tagCapable(fw: string | null): boolean {
  return fwAtLeast(fw, '2026-08-16', 1)
}

export function darkCapable(fw: string | null): boolean {
  return fwAtLeast(fw, '2026-08-17', 1)
}

export type FeedStatus = 'connecting' | 'live' | 'error'

/**
 * Subscribe to a running dashboard. Returns a cleanup function.
 * Uses the native EventSource reconnect; a failed initial fetch surfaces
 * as 'error' but the SSE keeps retrying client-side.
 */
export function connectDashboard(
  baseUrl: string,
  onTelemetry: (t: Telemetry) => void,
  onStatus: (s: FeedStatus) => void,
): () => void {
  const base = baseUrl.replace(/\/+$/, '')
  onStatus('connecting')

  fetch(`${base}/api/state`)
    .then((r) => r.json())
    .then((j) => {
      onTelemetry(mapState(j))
      onStatus('live')
    })
    .catch(() => onStatus('error'))

  const es = new EventSource(`${base}/events`)
  es.addEventListener('snapshot', (ev) => {
    try {
      onTelemetry(mapState(JSON.parse((ev as MessageEvent).data)))
      onStatus('live')
    } catch {
      /* one bad frame never kills the feed */
    }
  })
  es.onerror = () => onStatus('error')

  return () => es.close()
}
