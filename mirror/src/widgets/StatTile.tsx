import type { WidgetDataProps } from '../lib/types'

const METRICS: Record<string, { label: string; compute: (t: WidgetDataProps['telemetry']) => string }> = {
  alive: {
    label: 'alive',
    compute: (t) => String(t.fixtures.filter((f) => f.lastHeardMs < 60_000).length),
  },
  avgSoc: {
    label: 'avg SoC',
    compute: (t) => {
      const gauged = t.fixtures.filter((f) => f.soc !== 255)
      if (!gauged.length) return '—'
      return `${Math.round(gauged.reduce((a, f) => a + f.soc, 0) / gauged.length)}%`
    },
  },
  charging: {
    label: 'charging',
    compute: (t) => String(t.fixtures.filter((f) => f.battMa < 0).length),
  },
  lowSoc: {
    label: 'low batt',
    compute: (t) => String(t.fixtures.filter((f) => f.soc !== 255 && f.soc < 40).length),
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
