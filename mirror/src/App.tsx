import { useEffect, useState } from 'react'
import { TabBar } from './components/TabBar'
import { UpdateChip } from './components/UpdateChip'
import { WidgetFrame } from './components/WidgetFrame'
import { EditPanel } from './components/EditPanel'
import { Scene3D } from './components/Scene3D'
import { getWidgetDef } from './lib/registry'
import { useMirror, TREE_TAB } from './lib/store'
import { connectDashboard, tagCapable, type FeedStatus } from './lib/adapter'
import type { Telemetry } from './lib/types'

/**
 * REAL DATA ONLY. The Mirror is the real-life listener: its single input is a
 * running net_bench_dashboard.py (same-origin /bench proxy by default). No
 * mock, no fake IDs, no background processes — the live feed is the browser's
 * own EventSource, gone when the tab closes. An empty stage means nothing is
 * being heard, and that is the truth.
 */
function useTelemetry(): { telemetry: Telemetry; status: FeedStatus } {
  const dataSource = useMirror((s) => s.dataSource)
  const [telemetry, setTelemetry] = useState<Telemetry>({
    now: 0,
    listenWindowS: 60,
    serialConnected: false,
    serialError: null,
    bridgeFwRev: null,
    fixtures: [],
  })
  const [status, setStatus] = useState<FeedStatus>('connecting')

  useEffect(
    () =>
      connectDashboard(
        dataSource.url,
        (t) => {
          setTelemetry(t)
          // Verb-capability truth for the store fence + BLD's button disables.
          if (useMirror.getState().bridgeFw !== t.bridgeFwRev) {
            const capable = tagCapable(t.bridgeFwRev)
            useMirror.setState({
              bridgeFw: t.bridgeFwRev,
              tagCapable: capable,
              tagRefusalReason: capable
                ? null
                : `bridge fw ${t.bridgeFwRev ?? 'unknown'} — tags need >= cores3-bridge-2026-08-16.1, reflash pending Elliot`,
            })
          }
        },
        setStatus,
      ),
    [dataSource.url],
  )

  return { telemetry, status }
}

const STATUS_DOT: Record<FeedStatus, string> = {
  connecting: 'var(--warn)',
  live: 'var(--ok)',
  error: 'var(--danger)',
}

export default function App() {
  const layout = useMirror((s) => s.layout)
  const activePageId = useMirror((s) => s.activePageId)
  const editMode = useMirror((s) => s.editMode)
  const send = useMirror((s) => s.send)
  const { telemetry, status } = useTelemetry()

  const page = activePageId === TREE_TAB ? undefined : layout.pages.find((p) => p.id === activePageId)

  return (
    <div className="app">
      {/* The stage is ALWAYS mounted — TouchConsole's "tree above the controls".
          The 3-D orbit is the original controller's, adopted verbatim. */}
      <div className="stage">
        <Scene3D telemetry={telemetry} />
      </div>

      <header className="app-head">
        <h1>Resonance Mirror</h1>
        {/* triple-rule: an HTTP-live feed with the serial ear down is STALE
            data, and the chip must say so (never quietly "listening") */}
        <span className="source-chip" title={telemetry.serialError ?? 'Feed status'}>
          <i
            className="dot"
            style={{ background: status === 'live' && !telemetry.serialConnected ? 'var(--danger)' : STATUS_DOT[status] }}
          />
          {status === 'live' ? (telemetry.serialConnected ? 'listening' : 'ear down — stale') : status}
        </span>
        <UpdateChip />
      </header>

      {page && (
        <div className="sheet" role="dialog" aria-label={page.label}>
          <div className="sheet-grab" aria-hidden />
          {editMode && <EditPanel pageId={page.id} />}
          <div className="page-grid">
            {page.widgets
              .filter((w) => w.visible)
              .map((w) => {
                const def = getWidgetDef(w.type)
                const Body = def?.component
                return (
                  <WidgetFrame
                    key={w.id}
                    pageId={page.id}
                    widget={w}
                    live={status === 'live' && telemetry.serialConnected}
                  >
                    {Body ? <Body config={w.config} telemetry={telemetry} send={send} /> : null}
                  </WidgetFrame>
                )
              })}
            {page.widgets.length === 0 && (
              <p className="empty span-2">Blank canvas — hit Edit and build this page from the widget palette.</p>
            )}
          </div>
        </div>
      )}

      <TabBar />
    </div>
  )
}
