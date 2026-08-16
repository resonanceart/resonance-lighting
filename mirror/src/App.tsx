import { useEffect, useState } from 'react'
import { TabBar } from './components/TabBar'
import { WidgetFrame } from './components/WidgetFrame'
import { EditPanel } from './components/EditPanel'
import { getWidgetDef } from './lib/registry'
import { useMirror } from './lib/store'
import { sampleTelemetry } from './lib/mock'
import type { Telemetry } from './lib/types'

export default function App() {
  const layout = useMirror((s) => s.layout)
  const activePageId = useMirror((s) => s.activePageId)
  const editMode = useMirror((s) => s.editMode)
  const send = useMirror((s) => s.send)
  const [telemetry, setTelemetry] = useState<Telemetry>(() => sampleTelemetry())

  // Mock feed at 1 Hz — the same cadence NB_CHOREO_STATE would give us.
  // Swapping this for the net_bench_dashboard /api/state adapter changes
  // nothing downstream: widgets only ever see the Telemetry shape.
  useEffect(() => {
    const t = setInterval(() => setTelemetry(sampleTelemetry()), 1000)
    return () => clearInterval(t)
  }, [])

  const page = layout.pages.find((p) => p.id === activePageId) ?? layout.pages[0]

  return (
    <div className="app">
      <main className="app-main">
        <div className="app-head">
          <h1>Resonance Mirror</h1>
          <span className="muted">
            {layout.name} · mock feed · {telemetry.fixtures.length} fixtures
          </span>
        </div>

        {editMode && page && <EditPanel pageId={page.id} />}

        {page && (
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
        )}
      </main>
      <TabBar />
    </div>
  )
}
