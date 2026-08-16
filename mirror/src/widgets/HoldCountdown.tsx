import type { WidgetDataProps } from '../lib/types'

/** Flash Station pattern: post-PASS hold — visible countdown before unplug is safe. */
export function HoldCountdown({ config, telemetry }: WidgetDataProps) {
  const holdS = Number(config.holdS) || 90
  const holding = telemetry.fixtures.filter((f) => f.usb?.state === 'PASS' && f.usb.holdRemainingS !== undefined)
  if (!holding.length) return <p className="empty">No post-PASS holds running.</p>
  return (
    <div className="hold-list">
      {holding.map((f) => {
        const remaining = f.usb!.holdRemainingS!
        const pct = Math.max(0, Math.min(100, (remaining / holdS) * 100))
        const done = remaining === 0
        return (
          <div key={f.fixtureId} className="hold-row">
            <span className="mono">{f.fixtureId}</span>
            <div className="hold-bar" role="progressbar" aria-valuenow={remaining} aria-valuemax={holdS}>
              <div className={`hold-fill ${done ? 'ok' : ''}`} style={{ width: `${done ? 100 : pct}%` }} />
            </div>
            <span className={done ? 'ok-text' : 'warn-text'}>{done ? 'safe to unplug' : `${remaining}s`}</span>
          </div>
        )
      })}
    </div>
  )
}
