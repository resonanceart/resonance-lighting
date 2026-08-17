import { useEffect, useState } from 'react'
import type { WidgetDataProps } from '../lib/types'

/**
 * Flash Station mirror — lighting-architect's tools/flash-station.py, adopted
 * by name (Elliot 2026-08-17: "bring in the flash as well"). Watch-only: this
 * widget READS the station's /state (same-origin /flash proxy → :8940); the
 * station itself owns every serial/USB action. The feed is the browser's own
 * poll while the widget is visible — no background processes.
 */

interface PortRow {
  present: boolean
  excluded: boolean
  flashing: boolean
  usb?: { fixture_hint?: string; name?: string }
}
interface ResultRow {
  verdict: string
  fixture_id?: string | null
  row_at?: string
}
interface RosterRow {
  fixture_id: string
  flashed: boolean
  fw: string | null
  first_pass_at: string | null
  last_verdict: string | null
}
interface StationState {
  ports: Record<string, PortRow>
  results: Record<string, ResultRow>
  roster: Record<string, RosterRow>
  expect: number
  artifact: string
  artifacts?: Record<string, { label?: string }>
}

const HOLD_S = 90

function chipClass(v: string): string {
  if (v === 'PASS') return 'ok-text'
  if (v === 'FAIL') return 'danger-text'
  if (v === 'FLASHING' || v === 'UPLOADED') return 'warn-text'
  return ''
}

function portVerdict(port: string, p: PortRow, results: Record<string, ResultRow>): string {
  if (p.flashing) return 'FLASHING'
  return results[port]?.verdict ?? 'CONNECTED'
}

export function FlashStation(_props: WidgetDataProps) {
  const [st, setSt] = useState<StationState | null>(null)
  const [err, setErr] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let alive = true
    const poll = () =>
      fetch('/flash/state')
        .then((r) => r.json())
        .then((j: StationState) => {
          if (!alive) return
          setSt(j)
          setErr(false)
          setNow(Date.now())
        })
        .catch(() => alive && setErr(true))
    poll()
    const t = setInterval(poll, 2000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  if (err) return <p className="empty">Flash station unreachable on /flash — is flash-station.py running on :8940?</p>
  if (!st) return <p className="empty">Listening for the flash station…</p>

  const roster = Object.values(st.roster ?? {})
  const flashed = roster.filter((r) => r.flashed).length
  const present = Object.entries(st.ports ?? {}).filter(([, p]) => p.present && !p.excluded)
  const holds = roster
    .map((r) => ({ r, left: r.first_pass_at ? HOLD_S - (now - Date.parse(r.first_pass_at)) / 1000 : -1 }))
    .filter((h) => h.left > 0)

  return (
    <div>
      <p className="muted small census-line">
        {flashed} of {st.expect} flashed · artifact <span className="mono">{st.artifact}</span>
        {st.artifacts?.[st.artifact]?.label ? ` (${st.artifacts[st.artifact].label})` : ''}
      </p>

      {present.length === 0 && <p className="empty">No fixtures on USB — plug one in at the bench.</p>}
      {present.map(([port, p]) => {
        const v = portVerdict(port, p, st.results ?? {})
        return (
          <div key={port} className="prog-row">
            <span className="mono small">{p.usb?.fixture_hint ?? port.split('/').pop()}</span>
            <span className="muted small">{p.usb?.name ?? ''}</span>
            <span className={`mono ${chipClass(v)}`}>{v}</span>
          </div>
        )
      })}

      {holds.length > 0 && (
        <div className="hold-list">
          {holds.map(({ r, left }) => (
            <div key={r.fixture_id} className="hold-row">
              <span className="mono small">{r.fixture_id}</span>
              <div className="hold-bar">
                <div className="hold-fill ok" style={{ width: `${(left / HOLD_S) * 100}%` }} />
              </div>
              <span className="muted mono small">don’t unplug · {Math.ceil(left)}s</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
