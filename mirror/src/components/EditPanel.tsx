import { useRef } from 'react'
import { allWidgetDefs } from '../lib/registry'
import { useMirror } from '../lib/store'
import type { LayoutDoc } from '../lib/types'

/** Edit-mode palette: add widgets, manage pages, export/import the layout doc. */
export function EditPanel({ pageId }: { pageId: string }) {
  const addWidget = useMirror((s) => s.addWidget)
  const addPage = useMirror((s) => s.addPage)
  const removePage = useMirror((s) => s.removePage)
  const renamePage = useMirror((s) => s.renamePage)
  const resetLayout = useMirror((s) => s.resetLayout)
  const importLayout = useMirror((s) => s.importLayout)
  const layout = useMirror((s) => s.layout)
  const page = layout.pages.find((p) => p.id === pageId)
  const fileRef = useRef<HTMLInputElement>(null)

  const exportDoc = () => {
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${layout.name.replace(/\s+/g, '-').toLowerCase()}.mirror.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const onImport = async (file: File) => {
    try {
      const doc = JSON.parse(await file.text()) as LayoutDoc
      if (doc.version !== 1 || !Array.isArray(doc.pages)) throw new Error('not a v1 layout doc')
      importLayout(doc)
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : 'unreadable file'}`)
    }
  }

  if (!page) return null

  return (
    <aside className="edit-panel">
      <h2>Components</h2>
      {allWidgetDefs().length === 0 ? (
        <p className="muted small">
          None adopted yet — features are pulled in one at a time, by name, from Ben's tested tools and the
          original controller. Ask for one and it appears here.
        </p>
      ) : (
        <div className="palette">
          {allWidgetDefs().map((d) => (
            <button key={d.type} className="palette-item" onClick={() => addWidget(pageId, d.type)}>
              <span className="palette-head">
                <span aria-hidden>{d.icon}</span> {d.title}
                <span className={`tier tier-${d.tier.toLowerCase()}`}>{d.tier}</span>
              </span>
              <span className="muted small">{d.description}</span>
            </button>
          ))}
        </div>
      )}

      <h2>This page</h2>
      <div className="page-controls">
        <label>
          <span>Label</span>
          <input value={page.label} onChange={(e) => renamePage(pageId, e.target.value, page.icon)} />
        </label>
        <label>
          <span>Icon</span>
          <input value={page.icon} onChange={(e) => renamePage(pageId, page.label, e.target.value)} />
        </label>
        <div className="row-gap">
          <button className="btn-line" onClick={addPage}>
            + New page
          </button>
          <button className="btn-line danger-text" onClick={() => removePage(pageId)}>
            Delete page
          </button>
        </div>
      </div>

      <h2>Layout document</h2>
      <div className="row-gap">
        <button className="btn-line" onClick={exportDoc}>
          Export JSON
        </button>
        <button className="btn-line" onClick={() => fileRef.current?.click()}>
          Import JSON
        </button>
        <button className="btn-line" onClick={resetLayout}>
          Reset
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
        />
      </div>
      <p className="muted small">
        The whole console is this one JSON document — share it, version it, load someone else's. No code changes.
      </p>
    </aside>
  )
}
