import type { WidgetDataProps } from '../lib/types'

function barCount(rssi: number): number {
  if (rssi >= -55) return 4
  if (rssi >= -65) return 3
  if (rssi >= -75) return 2
  if (rssi >= -85) return 1
  return 0
}

/** Downlink signal per fixture — bridge-side RSSI (text mode gives no
 *  per-packet RSSI; this renders whatever the feed can honestly provide). */
export function RssiSignal({ config, telemetry }: WidgetDataProps) {
  const worstFirst = Boolean(config.worstFirst ?? true)
  const rows = [...telemetry.fixtures]
    .filter((f) => f.rssi !== 0)
    .sort((a, b) => (worstFirst ? a.rssi - b.rssi : b.rssi - a.rssi))
  if (!rows.length) return <p className="empty">No RSSI in this feed (text-mode bridge reports none per-packet).</p>
  return (
    <div className="rssi-grid">
      {rows.slice(0, 18).map((f) => {
        const bars = barCount(f.rssi)
        return (
          <div key={f.fixtureId} className="rssi-cell">
            <span className="mono small">{f.fixtureId}</span>
            <span className={`rssi-bars b${bars}`} aria-label={`${f.rssi} dBm`}>
              {[1, 2, 3, 4].map((n) => (
                <i key={n} className={n <= bars ? 'on' : ''} style={{ height: 3 + n * 3 }} />
              ))}
            </span>
            <span className="muted mono small">{f.rssi}</span>
          </div>
        )
      })}
    </div>
  )
}
