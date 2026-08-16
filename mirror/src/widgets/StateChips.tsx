import type { WidgetDataProps } from '../lib/types'

const STATE_CLASS: Record<string, string> = {
  CONNECTED: 'chip-accent',
  PASS: 'chip-ok',
  FAIL: 'chip-danger',
  UNPLUGGED: 'chip-muted',
}

/** Flash Station pattern: one card per USB-attached device, state as chip. */
export function StateChips({ config, telemetry }: WidgetDataProps) {
  const rows = telemetry.fixtures.filter((f) => f.usb)
  if (!rows.length) return <p className="empty">No devices on USB.</p>
  return (
    <div className="chip-grid">
      {rows.map((f) => (
        <div key={f.fixtureId} className="chip-card">
          <div className="chip-card-head">
            <span className="mono">{f.fixtureId}</span>
            <span className={`chip ${STATE_CLASS[f.usb!.state]}`}>{f.usb!.state}</span>
          </div>
          {Boolean(config.showPort) && <span className="muted mono small">{f.usb!.port}</span>}
        </div>
      ))}
    </div>
  )
}
