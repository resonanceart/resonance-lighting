import { useState } from 'react'
import type { WidgetDataProps } from '../lib/types'

/**
 * The one BLINK-tier widget: NB_IDENTIFY per fixture or broadcast.
 * All emission goes through the store's command fence; in v1 there is no
 * radio behind it — the fence logs to the audit trail, proving the pattern.
 */
export function IdentifyButton({ telemetry, send }: WidgetDataProps) {
  const [target, setTarget] = useState<string>('all')
  const [flash, setFlash] = useState<string | null>(null)

  const emit = () => {
    send({ verb: 'NB_IDENTIFY', target })
    setFlash(target)
    setTimeout(() => setFlash(null), 1200)
  }

  return (
    <div className="identify">
      <div className="identify-row">
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Identify target">
          <option value="all">All fixtures (broadcast)</option>
          {telemetry.fixtures.slice(0, 20).map((f) => (
            <option key={f.fixtureId} value={f.fixtureId}>
              {f.fixtureId} · {f.cls}
            </option>
          ))}
        </select>
        <button className="btn-accent" onClick={emit}>
          Blink {target === 'all' ? 'all' : target}
        </button>
      </div>
      {flash && (
        <p className="ok-text small">
          NB_IDENTIFY → {flash} emitted through the fence (v1: logged, no radio)
        </p>
      )}
      <p className="muted small">BLINK tier — benign, self-expiring. The only sendable verb in Mirror v1.</p>
    </div>
  )
}
