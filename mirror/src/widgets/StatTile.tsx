import type { WidgetDataProps } from '../lib/types'

type Tel = WidgetDataProps['telemetry']
const win = (t: Tel) => t.listenWindowS * 1000

const METRICS: Record<string, { label: (t: Tel) => string; compute: (t: Tel) => string }> = {
  alive: {
    label: (t) => `alive · ${t.listenWindowS}s window`,
    compute: (t) => String(t.fixtures.filter((f) => f.lastHeardMs < win(t)).length),
  },
  stale: {
    label: (t) => `stale >${t.listenWindowS}s`,
    compute: (t) => String(t.fixtures.filter((f) => f.lastHeardMs >= win(t)).length),
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
