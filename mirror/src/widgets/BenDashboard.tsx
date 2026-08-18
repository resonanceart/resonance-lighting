import type { WidgetDataProps } from '../lib/types'

/**
 * Ben's dashboard, embedded — Elliot, twice, verbatim intent: "It should be
 * BEN'S dashboard, inside the mirror app." Not a rebuild; his page, framed
 * (spec: LX 02132eca). The iframe is a WINDOW onto Ben's own UI: its fetches
 * are same-origin to :8765, no proxy/CORS involvement; the Mirror sends
 * nothing through it. location.hostname keeps localhost AND phone-on-LAN
 * working (the dashboard binds 0.0.0.0). Native widget adoption continues
 * underneath; this is the literal "running inside" today.
 */
export function BenDashboard({ telemetry }: WidgetDataProps) {
  // Feed health is the probe (we already consume /api/state): HTTP down →
  // honest full-tab message, never a dead grey iframe.
  if (telemetry.now === 0 || telemetry.fixtures.length === 0) {
    return (
      <p className="empty">
        BENCH DOWN — plug bridge E39A34; the waiter auto-starts Ben&apos;s dashboard.
      </p>
    )
  }
  return (
    <div className="ben-embed">
      <iframe src={`http://${location.hostname}:8765/`} title="Ben's bench dashboard (live)" />
      <p className="danger-text small ben-embed-caption">
        Ben&apos;s live bench — commands here are LIVE on the fleet
        {!telemetry.serialConnected ? ' · ⚠ serial ear down, data stale' : ''}
      </p>
    </div>
  )
}
