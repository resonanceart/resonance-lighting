import type { WidgetDataProps } from '../lib/types'
import { darkCapable, locateCapable, sleepAware, surveyCapable, tagCapable } from '../lib/adapter'

/** Bridge-OS banner — the bridge's own fw identity + which verbs it is KNOWN
 *  to forward (LX spec M1, Elliot directive 2026-08-20). Chips derive from
 *  telemetry alone, so a reflash flips them capable with zero code changes;
 *  an incapable chip carries its reason in hand (the Tag-button pattern).
 *  Unknown fw = every verb incapable — fail closed, never optimistic. */

const GATES: { label: string; capable: (fw: string | null) => boolean; min: string }[] = [
  { label: 'T tag', capable: tagCapable, min: '2026-08-17.1' },
  { label: 'i locate', capable: locateCapable, min: '2026-08-17.1' },
  { label: 'B dark', capable: darkCapable, min: '2026-08-17.1' },
  { label: 'L survey', capable: surveyCapable, min: '2026-08-17.2' },
  { label: 'Q sleep', capable: sleepAware, min: '2026-08-17.2' },
]

export function BridgeOs({ telemetry }: WidgetDataProps) {
  const fw = telemetry.bridgeFwRev
  return (
    <div>
      <p className="mono small">
        bridge OS:{' '}
        {fw ?? <span className="muted">UNKNOWN — waiting for the bridge&apos;s first master line</span>}
      </p>
      <div className="cap-row">
        {GATES.map((g) => {
          const ok = g.capable(fw)
          const reason = fw === null ? 'bridge fw unknown' : `needs ≥ ${g.min}`
          return (
            <span
              key={g.label}
              className={`chip ${ok ? 'chip-ok' : 'chip-muted'}`}
              title={ok ? 'forwarded by this bridge' : reason}
            >
              {g.label} {ok ? '✓' : `✕ ${reason}`}
            </span>
          )
        })}
      </div>
      <p className="muted small">
        Old bridges swallow unknown opcodes silently while the dashboard prints “Sent” — a verb only
        unlocks when this bridge&apos;s firmware is known to forward it.
      </p>
    </div>
  )
}
