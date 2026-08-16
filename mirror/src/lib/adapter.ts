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

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function mapPeer(id: string, row: PeerRow): FixtureState {
  const battV = num(row.battery_v)
  // dl_pdr arrives either as a 0..1 ratio or already per-mille depending on
  // firmware tail; normalize on the safe side of the ambiguity.
  const rawPdr = num(row.dl_pdr) ?? num(row.pdr)
  const pdrPermille = rawPdr === undefined ? 0 : rawPdr <= 1 ? Math.round(rawPdr * 1000) : Math.round(rawPdr)
  return {
    fixtureId: id.toUpperCase(),
    cls: 'unknown', // wire carries no class; the registry join adds it later
    battMv: battV !== undefined ? Math.round(battV * 1000) : 0,
    battMa: num(row.battery_ma) ?? 0,
    soc: num(row.soc_pct) ?? 255,
    rssi: num(row.rssi_dbm) ?? num(row.dl_rssi_dbm) ?? 0,
    pdrPermille,
    lastHeardMs: num(row.age_ms) ?? 0,
    fwRev: str(row.firmware_rev) ?? '—',
    activeProgram: str(row.active_program) ?? str(row.ca_state) ?? str(row.peer_mode) ?? '—',
    lifeState: str(row.field_phase) ?? null,
  }
}

export function mapState(json: unknown): Telemetry {
  const root = (json ?? {}) as Record<string, unknown>
  const peers = (root.peers ?? {}) as Record<string, PeerRow>
  return {
    now: Date.now(),
    // Must match the widgets' alive filter (lastHeardMs < 60s) — the census
    // line cites this number, and a mismatched citation is a small lie.
    listenWindowS: 60,
    fixtures: Object.entries(peers).map(([id, row]) => mapPeer(id, row)),
  }
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
