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
