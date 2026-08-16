import type { WidgetDataProps } from '../lib/types'

// Scope rule: one feature at a time from Ben's dashboard. Only presence
// metrics exist today; battery/power metrics return when that feature is
// deliberately pulled in.
const METRICS: Record<string, { label: string; compute: (t: WidgetDataProps['telemetry']) => string }> = {
  alive: {
    label: 'alive',
    compute: (t) => String(t.fixtures.filter((f) => f.lastHeardMs < 60_000).length),
  },
  stale: {
    label: 'stale >60s',
    compute: (t) => String(t.fixtures.filter((f) => f.lastHeardMs >= 60_000).length),
  },
}

export function StatTile({ config, telemetry }: WidgetDataProps) {
  const m = METRICS[String(config.metric)] ?? METRICS.alive
  return (
    <div className="stat-tile">
      <b>{m.compute(telemetry)}</b>
      <span>
        {m.label} · {telemetry.listenWindowS}s window
      </span>
    </div>
  )
}
