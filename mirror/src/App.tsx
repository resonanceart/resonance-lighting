import { useEffect, useState } from 'react'
import { TabBar } from './components/TabBar'
import { WidgetFrame } from './components/WidgetFrame'
import { EditPanel } from './components/EditPanel'
import { Constellation } from './components/Constellation'
import { getWidgetDef } from './lib/registry'
import { useMirror, TREE_TAB } from './lib/store'
import { sampleTelemetry } from './lib/mock'
import { connectDashboard, type FeedStatus } from './lib/adapter'
import type { Telemetry } from './lib/types'

/** No background processes anywhere: the mock feed is an in-page interval,
 *  the live feed is the browser's own EventSource to Ben's dashboard. Close
 *  the tab and nothing of the Mirror keeps running. */
function useTelemetry(): { telemetry: Telemetry; status: FeedStatus | 'mock' } {
  const dataSource = useMirror((s) => s.dataSource)
  const [telemetry, setTelemetry] = useState<Telemetry>(() => sampleTelemetry())
  const [status, setStatus] = useState<FeedStatus | 'mock'>('mock')

  useEffect(() => {
    if (dataSource.kind === 'mock') {
      setStatus('mock')
      const t = setInterval(() => setTelemetry(sampleTelemetry()), 1000)
      return () => clearInterval(t)
    }
    return connectDashboard(dataSource.url, setTelemetry, setStatus)
  }, [dataSource])

  return { telemetry, status }
}

const STATUS_DOT: Record<string, string> = {
  mock: 'var(--muted)',
  connecting: 'var(--warn)',
  live: 'var(--ok)',
  error: 'var(--danger)',
}

function SourceControl({ status }: { status: string }) {
  const dataSource = useMirror((s) => s.dataSource)
  const setDataSource = useMirror((s) => s.setDataSource)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(dataSource.kind === 'dashboard' ? dataSource.url : 'http://127.0.0.1:8765')

  return (
    <div className="source">
      <button className="source-chip" onClick={() => setOpen(!open)} aria-expanded={open}>
        <i className="dot" style={{ background: STATUS_DOT[status] ?? 'var(--muted)' }} />
        {dataSource.kind === 'mock' ? 'mock feed' : `bench ${status}`}
      </button>
      {open && (
        <div className="source-pop">
          <button
            className={`btn-line ${dataSource.kind === 'mock' ? 'ok-text' : ''}`}
            onClick={() => {
              setDataSource({ kind: 'mock' })
              setOpen(false)
            }}
          >
            Mock feed
          </button>
          <div className="source-live">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://127.0.0.1:8765"
              aria-label="Dashboard URL"
            />
            <button
              className="btn-line"
              onClick={() => {
                setDataSource({ kind: 'dashboard', url })
                setOpen(false)
              }}
            >
              Connect
            </button>
          </div>
          <p className="muted small">
            Point at a running net_bench_dashboard.py (:8765). The Mirror is a second read-only consumer — no
            processes of its own.
          </p>
        </div>
      )}
    </div>
  )
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
      {/* The stage is ALWAYS mounted — TouchConsole's "tree above the controls". */}
      <div className="stage">
        <Constellation telemetry={telemetry} />
      </div>

      <header className="app-head">
        <h1>Resonance Mirror</h1>
        <SourceControl status={status} />
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
                  <WidgetFrame key={w.id} pageId={page.id} widget={w}>
                    {Body ? <Body config={w.config} telemetry={telemetry} send={send} /> : null}
                  </WidgetFrame>
                )
              })}
            {page.widgets.length === 0 && (
              <p className="empty span-2">Empty page — hit Edit and add widgets from the palette.</p>
            )}
          </div>
        </div>
      )}

      <TabBar />
    </div>
  )
}
