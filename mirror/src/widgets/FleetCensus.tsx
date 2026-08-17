import type { WidgetDataProps } from '../lib/types'
import { isHeard, liveness } from '../lib/adapter'

function lastHeard(ms: number): string {
  if (ms < 6000) return 'now'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)}m ⚠`
}

/** Census honesty: the count line always cites the listen window, and an
 *  ear-down feed is called out — never rendered as if it were live. */
export function FleetCensus({ config, telemetry }: WidgetDataProps) {
  const cls = String(config.cls ?? 'all')
  const rows = telemetry.fixtures.filter((f) => cls === 'all' || f.cls === cls)
  const alive = rows.filter((f) => isHeard(telemetry, f)).length
  return (
    <div>
      {!telemetry.serialConnected && (
        <p className="danger-text small census-line">⚠ bridge ear down — last-seen data, nothing here is live</p>
      )}
      <p className="muted small census-line">
        {alive} of {rows.length} heard in the last {telemetry.listenWindowS}s window
      </p>
      <div className="scroll-x">
        <table className="data">
          <thead>
            <tr>
              <th>id</th>
              <th>heard</th>
              <th>class</th>
              <th>fw</th>
              <th>prog</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.fixtureId} className={!isHeard(telemetry, f) ? 'row-stale' : ''}>
                <td className="mono">{f.fixtureId}</td>
                <td>{liveness(telemetry, f) === 'ghost' ? 'ghost' : lastHeard(f.lastHeardMs)}</td>
                <td>{f.cls}</td>
                <td className="mono small">{f.fwRev}</td>
                <td>{f.lifeState === null ? f.activeProgram : <span className="muted">{f.lifeState}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
