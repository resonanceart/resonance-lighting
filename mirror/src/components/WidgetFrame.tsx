import { useState } from 'react'
import type { ReactNode } from 'react'
import type { WidgetInstance } from '../lib/types'
import { getWidgetDef } from '../lib/registry'
import { useMirror } from '../lib/store'

/** Card chrome around every widget; grows edit controls in edit mode. */
export function WidgetFrame({
  pageId,
  widget,
  children,
}: {
  pageId: string
  widget: WidgetInstance
  children: ReactNode
}) {
  const editMode = useMirror((s) => s.editMode)
  const removeWidget = useMirror((s) => s.removeWidget)
  const moveWidget = useMirror((s) => s.moveWidget)
  const updateWidget = useMirror((s) => s.updateWidget)
  const updateConfig = useMirror((s) => s.updateConfig)
  // Elliot's protocol (contract §0.3): every widget ships BETA and stays BETA
  // until Elliot confirms it working in the app itself — the ✔ RED pattern.
  // Two taps (arm, then confirm) so a stray tap can't clear the flag; the
  // confirmation persists into the layout doc via config._confirmed.
  const confirmed = typeof widget.config._confirmed === 'string'
  const [arming, setArming] = useState(false)
  const def = getWidgetDef(widget.type)
  if (!def) {
    return (
      <div className={`widget span-${widget.span}`}>
        <p className="danger-text">Unknown widget type '{widget.type}' — removed from registry?</p>
      </div>
    )
  }

  return (
    <section className={`widget span-${widget.span}`} aria-label={widget.label ?? def.title}>
      <header className="widget-head">
        <h3>
          <span aria-hidden>{def.icon}</span> {widget.label ?? def.title}
          <span className={`tier tier-${def.tier.toLowerCase()}`}>{def.tier}</span>
          {!confirmed &&
            (arming ? (
              <button
                className="beta-chip beta-arm"
                onClick={() => {
                  updateConfig(pageId, widget.id, '_confirmed', new Date().toISOString())
                  setArming(false)
                }}
              >
                ✔ Elliot confirms
              </button>
            ) : (
              <button className="beta-chip" title="BETA until Elliot confirms in-app" onClick={() => setArming(true)}>
                BETA
              </button>
            ))}
        </h3>
        {editMode && (
          <div className="widget-tools">
            <button aria-label="Move up" onClick={() => moveWidget(pageId, widget.id, -1)}>
              ↑
            </button>
            <button aria-label="Move down" onClick={() => moveWidget(pageId, widget.id, 1)}>
              ↓
            </button>
            <button
              aria-label="Toggle width"
              onClick={() => updateWidget(pageId, widget.id, { span: widget.span === 1 ? 2 : 1 })}
            >
              ⇔
            </button>
            <button aria-label="Remove widget" className="danger-text" onClick={() => removeWidget(pageId, widget.id)}>
              ✕
            </button>
          </div>
        )}
      </header>

      {editMode && def.configFields.length > 0 && (
        <div className="widget-config">
          {def.configFields.map((f) => {
            const value = widget.config[f.key]
            switch (f.kind) {
              case 'select':
                return (
                  <label key={f.key}>
                    <span>{f.label}</span>
                    <select value={String(value ?? '')} onChange={(e) => updateConfig(pageId, widget.id, f.key, e.target.value)}>
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              case 'number':
                return (
                  <label key={f.key}>
                    <span>{f.label}</span>
                    <input
                      type="number"
                      min={f.min}
                      max={f.max}
                      value={Number(value ?? 0)}
                      onChange={(e) => updateConfig(pageId, widget.id, f.key, Number(e.target.value))}
                    />
                  </label>
                )
              case 'toggle':
                return (
                  <label key={f.key} className="toggle-row">
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(e) => updateConfig(pageId, widget.id, f.key, e.target.checked)}
                    />
                    <span>{f.label}</span>
                  </label>
                )
              case 'text':
                return (
                  <label key={f.key}>
                    <span>{f.label}</span>
                    <input
                      type="text"
                      placeholder={f.placeholder}
                      value={String(value ?? '')}
                      onChange={(e) => updateConfig(pageId, widget.id, f.key, e.target.value)}
                    />
                  </label>
                )
            }
          })}
        </div>
      )}

      <div className="widget-body">{children}</div>
    </section>
  )
}
