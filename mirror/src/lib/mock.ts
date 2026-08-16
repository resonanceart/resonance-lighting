import type { FixtureState, Telemetry } from './types'

/**
 * Mock telemetry provider.
 *
 * Simulates the shape the real adapter will produce from
 * net_bench_dashboard.py's GET /api/state + SSE stream. Encodes the honesty
 * rules from the inventory so widgets are built against them from day one:
 * soc=255 (no gauge), lifeState null-vs-value, staleness windows, and the two
 * live firmware naming schemes (fixture-* and fx-*).
 */

const CLASSES: [FixtureState['cls'], number][] = [
  ['downlight', 18],
  ['perimeter', 8],
  ['chandelier', 5],
  ['trunk', 5],
]

function hex6(i: number): string {
  return ((0xa10000 + i * 0x137) & 0xffffff).toString(16).padStart(6, '0').toUpperCase()
}

function mkFixture(i: number, cls: FixtureState['cls']): FixtureState {
  const noGauge = i % 9 === 0
  const stale = i % 11 === 0
  return {
    fixtureId: hex6(i),
    cls,
    battMv: 3550 + ((i * 37) % 500),
    battMa: i % 4 === 0 ? -(40 + ((i * 13) % 120)) : 25 + ((i * 7) % 90),
    soc: noGauge ? 255 : 35 + ((i * 11) % 60),
    rssi: -48 - ((i * 5) % 40),
    pdrPermille: 940 + ((i * 17) % 60),
    lastHeardMs: stale ? 65_000 + i * 1000 : (i * 337) % 5000,
    fwRev: i % 3 === 0 ? `fixture-prtrel1-b` : `fx-260816-otafix1-b`,
    activeProgram: ['breathe', 'ember', 'ripple', 'static'][i % 4],
    lifeState: i % 8 === 0 ? 'dormant-night' : null,
    usb:
      i < 12
        ? {
            state: (['CONNECTED', 'PASS', 'FAIL', 'UNPLUGGED'] as const)[i % 4],
            port: `usbmodem${1101 + i}`,
            holdRemainingS: i % 4 === 1 ? 90 - ((i * 9) % 90) : undefined,
          }
        : undefined,
  }
}

const FLEET: FixtureState[] = CLASSES.flatMap(([cls, n], ci) =>
  Array.from({ length: n }, (_, i) => mkFixture(ci * 40 + i + 1, cls)),
)

/**
 * Hidden ground-truth positions (normalized 0..1) the mock uses to synthesize
 * NB_NEIGHBOR_REPORT-shaped pairwise RSSI. Class-clustered like the real
 * scene: chandelier crown center, downlights inner ring, trunk interior,
 * perimeter outer ring. The solver never sees these — only the derived RSSI.
 */
const RADII: Record<FixtureState['cls'], [number, number]> = {
  chandelier: [0.06, 0.14],
  trunk: [0.1, 0.2],
  downlight: [0.22, 0.38],
  perimeter: [0.44, 0.48],
  unknown: [0.3, 0.4],
}
const GOLDEN = 2.399963

const TRUE_POS = new Map<string, { x: number; y: number }>()
FLEET.forEach((f, i) => {
  const [r0, r1] = RADII[f.cls]
  const r = r0 + (r1 - r0) * (((i * 37) % 100) / 100)
  const a = i * GOLDEN
  TRUE_POS.set(f.fixtureId, { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) })
})

const SCENE_METERS = 14

FLEET.forEach((f) => {
  const me = TRUE_POS.get(f.fixtureId)!
  f.neighbors = FLEET.filter((o) => o !== f)
    .map((o) => {
      const p = TRUE_POS.get(o.fixtureId)!
      const dM = Math.max(0.5, Math.hypot(p.x - me.x, p.y - me.y) * SCENE_METERS)
      return { id: o.fixtureId, d: dM }
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, 6)
    .map((n, k) => ({ id: n.id, rssi: Math.round(-40 - 25 * Math.log10(n.d)) - (k % 2) }))
})

let tick = 0

/** One animated snapshot; call on an interval for liveness. */
export function sampleTelemetry(): Telemetry {
  tick++
  return {
    now: Date.now(),
    listenWindowS: 120,
    fixtures: FLEET.map((f, i) => ({
      ...f,
      battMa: f.battMa + Math.round(8 * Math.sin((tick + i) / 3)),
      rssi: f.rssi + ((tick + i) % 5 === 0 ? 2 : 0),
      lastHeardMs: f.lastHeardMs > 60_000 ? f.lastHeardMs + 1000 : (f.lastHeardMs + 1000) % 6000,
      usb:
        f.usb && f.usb.holdRemainingS !== undefined
          ? { ...f.usb, holdRemainingS: Math.max(0, f.usb.holdRemainingS - 1) }
          : f.usb,
    })),
  }
}
