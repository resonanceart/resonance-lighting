import { useEffect, useState } from 'react'
import type { WidgetDataProps } from '../lib/types'

/**
 * Ben's dashboard, embedded — Elliot, twice, verbatim intent: "It should be
 * BEN'S dashboard, inside the mirror app." Not a rebuild; his page, framed
 * (spec: LX 02132eca). The iframe is a WINDOW onto Ben's own UI: its fetches
 * are same-origin to :8765, no proxy/CORS involvement; the Mirror sends
 * nothing through it. location.hostname keeps localhost AND phone-on-LAN
 * working (the dashboard binds 0.0.0.0). Native widget adoption continues
 * underneath; this is the literal "running inside" today.
 *
 * Full-screen: Elliot live at the fleet (LX fe37ed4f): "I want the fleet
 * dashboard to be full screen when I click." Explicit ⛶ control (a bare
 * panel click stays unambiguous for future in-panel interactions), ✕/ESC to
 * exit; the LIVE-state chip + live-commands caption stay visible expanded —
 * his page, unmodified, just bigger.
 */
export function BenDashboard({ config, telemetry }: WidgetDataProps) {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  // Feed health is the probe (we already consume /api/state): HTTP down →
  // honest full-tab message, never a dead grey iframe.
  if (telemetry.now === 0 || telemetry.fixtures.length === 0) {
    return (
      <p className="empty">
        BENCH DOWN — plug bridge E39A34; the waiter auto-starts Ben&apos;s dashboard.
      </p>
    )
  }

  const live = telemetry.serialConnected
  const confirmed = typeof config._confirmed === 'string'
  const src = `http://${location.hostname}:8765/`
  const caption = (
    <>
      Ben&apos;s live bench — commands here are LIVE on the fleet
      {!live ? ' · ⚠ serial ear down, data stale' : ''}
    </>
  )

  if (expanded) {
    return (
      <div className="ben-full" role="dialog" aria-label="Ben's bench dashboard, full screen">
        <div className="ben-full-bar">
          {confirmed ? (
            <span className="live-chip">LIVE</span>
          ) : (
            <span className="beta-chip">{live ? 'LIVE' : 'STALE'} · unconfirmed</span>
          )}
          <p className="danger-text small ben-full-caption">{caption}</p>
          <button className="ben-full-close" onClick={() => setExpanded(false)} aria-label="Exit full screen (Esc)">
            ✕
          </button>
        </div>
        <iframe src={src} title="Ben's bench dashboard (live, full screen)" />
      </div>
    )
  }

  return (
    <div className="ben-embed">
      <iframe src={src} title="Ben's bench dashboard (live)" />
      <div className="ben-embed-foot">
        <p className="danger-text small ben-embed-caption">{caption}</p>
        <button className="ben-expand" onClick={() => setExpanded(true)} aria-label="Full screen">
          ⛶ full screen
        </button>
      </div>
    </div>
  )
}
