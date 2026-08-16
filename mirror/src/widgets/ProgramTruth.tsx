import type { WidgetDataProps } from '../lib/types'

/** Distribution of active programs across the fleet. Honesty note is part of
 *  the widget: in text-bridge mode program truth is only as fresh as the 60 s
 *  full heartbeat (the core of PRD Q1). */
export function ProgramTruth({ telemetry }: WidgetDataProps) {
  const counts = new Map<string, number>()
  for (const f of telemetry.fixtures) {
    const key = f.lifeState !== null ? `(${f.lifeState})` : f.activeProgram
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const total = telemetry.fixtures.length || 1
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return (
    <div>
      <div className="prog-list">
        {rows.map(([prog, n]) => (
          <div key={prog} className="prog-row">
            <span className="mono">{prog}</span>
            <div className="prog-bar">
              <div className="prog-fill" style={{ width: `${(n / total) * 100}%` }} />
            </div>
            <span className="muted mono small">{n}</span>
          </div>
        ))}
      </div>
      <p className="muted small">Program truth may be up to 60 s stale on a text-mode bridge.</p>
    </div>
  )
}
