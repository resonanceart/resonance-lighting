import type { WidgetDataProps } from '../lib/types'
import { isHeard } from '../lib/adapter'

type Tel = WidgetDataProps['telemetry']
const earDown = (t: Tel) => (t.serialConnected ? '' : ' · EAR DOWN, stale')

const METRICS: Record<string, { label: (t: Tel) => string; compute: (t: Tel) => string }> = {
  alive: {
    label: (t) => `alive · ${t.listenWindowS}s window${earDown(t)}`,
    compute: (t) => String(t.fixtures.filter((f) => isHeard(t, f)).length),
  },
  stale: {
    label: (t) => `stale >${t.listenWindowS}s${earDown(t)}`,
    compute: (t) => String(t.fixtures.filter((f) => !isHeard(t, f)).length),
  },
}

export function StatTile({ config, telemetry }: WidgetDataProps) {
  const m = METRICS[String(config.metric)] ?? METRICS.alive
  return (
    <div className="stat-tile">
      <b>{m.compute(telemetry)}</b>
      <span>{m.label(telemetry)}</span>
    </div>
  )
}
