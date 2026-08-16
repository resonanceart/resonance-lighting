import { create } from 'zustand'
import type { LayoutDoc, MirrorCommand, PageDef, WidgetInstance } from './types'
import { getWidgetDef } from './registry'

/**
 * The layout document IS the interface. Everything the operator composes in
 * edit mode lives in this one JSON doc, persisted to localStorage and
 * exportable/importable as a file — the "no code changes" contract.
 */

const STORAGE_KEY = 'mirror-layout-v1'

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

/** Starter layout: one page per console mode, seeded with sensible widgets. */
export function defaultLayout(): LayoutDoc {
  const w = (type: string, config: Record<string, unknown> = {}, span: 1 | 2 = 1): WidgetInstance => ({
    id: uid('w'),
    type,
    span,
    visible: true,
    config,
  })
  return {
    version: 1,
    name: 'Default console',
    pages: [
      {
        id: uid('p'),
        label: 'Fleet',
        icon: '🌳',
        widgets: [
          w('stat-tile', { metric: 'alive' }),
          w('stat-tile', { metric: 'avgSoc' }),
          w('fleet-census', {}, 2),
        ],
      },
      {
        id: uid('p'),
        label: 'Power',
        icon: '🔋',
        widgets: [w('stat-tile', { metric: 'charging' }), w('stat-tile', { metric: 'lowSoc' }), w('battery-gauge', {}, 2)],
      },
      {
        id: uid('p'),
        label: 'Flash',
        icon: '⚡',
        widgets: [w('state-chips', {}, 2), w('hold-countdown', {}, 2)],
      },
      {
        id: uid('p'),
        label: 'Locate',
        icon: '📍',
        widgets: [w('identify', {}, 2)],
      },
    ],
  }
}

function load(): LayoutDoc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const doc = JSON.parse(raw) as LayoutDoc
      if (doc.version === 1 && Array.isArray(doc.pages)) return doc
    }
  } catch {
    /* corrupted doc falls through to default */
  }
  return defaultLayout()
}

interface MirrorStore {
  layout: LayoutDoc
  activePageId: string
  editMode: boolean
  /** Log of fenced command emissions (v1 has no radio — this is the audit trail). */
  commandLog: { at: number; cmd: MirrorCommand }[]

  setActivePage: (id: string) => void
  toggleEdit: () => void
  addWidget: (pageId: string, type: string) => void
  removeWidget: (pageId: string, widgetId: string) => void
  moveWidget: (pageId: string, widgetId: string, dir: -1 | 1) => void
  updateWidget: (pageId: string, widgetId: string, patch: Partial<WidgetInstance>) => void
  updateConfig: (pageId: string, widgetId: string, key: string, value: unknown) => void
  addPage: () => void
  removePage: (pageId: string) => void
  renamePage: (pageId: string, label: string, icon: string) => void
  resetLayout: () => void
  importLayout: (doc: LayoutDoc) => void
  send: (cmd: MirrorCommand) => void
}

function persist(layout: LayoutDoc) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    /* storage full/blocked: the in-memory doc still works */
  }
}

function mutPage(layout: LayoutDoc, pageId: string, fn: (p: PageDef) => PageDef): LayoutDoc {
  const next = { ...layout, pages: layout.pages.map((p) => (p.id === pageId ? fn(p) : p)) }
  persist(next)
  return next
}

export const useMirror = create<MirrorStore>((set) => ({
  layout: load(),
  activePageId: load().pages[0]?.id ?? '',
  editMode: false,
  commandLog: [],

  setActivePage: (id) => set({ activePageId: id }),
  toggleEdit: () => set((s) => ({ editMode: !s.editMode })),

  addWidget: (pageId, type) => {
    const def = getWidgetDef(type)
    if (!def) return
    set((s) => ({
      layout: mutPage(s.layout, pageId, (p) => ({
        ...p,
        widgets: [
          ...p.widgets,
          { id: uid('w'), type, span: def.defaults.span, visible: true, config: { ...def.defaults.config } },
        ],
      })),
    }))
  },

  removeWidget: (pageId, widgetId) =>
    set((s) => ({
      layout: mutPage(s.layout, pageId, (p) => ({ ...p, widgets: p.widgets.filter((w) => w.id !== widgetId) })),
    })),

  moveWidget: (pageId, widgetId, dir) =>
    set((s) => ({
      layout: mutPage(s.layout, pageId, (p) => {
        const i = p.widgets.findIndex((w) => w.id === widgetId)
        const j = i + dir
        if (i < 0 || j < 0 || j >= p.widgets.length) return p
        const widgets = [...p.widgets]
        ;[widgets[i], widgets[j]] = [widgets[j], widgets[i]]
        return { ...p, widgets }
      }),
    })),

  updateWidget: (pageId, widgetId, patch) =>
    set((s) => ({
      layout: mutPage(s.layout, pageId, (p) => ({
        ...p,
        widgets: p.widgets.map((w) => (w.id === widgetId ? { ...w, ...patch } : w)),
      })),
    })),

  updateConfig: (pageId, widgetId, key, value) =>
    set((s) => ({
      layout: mutPage(s.layout, pageId, (p) => ({
        ...p,
        widgets: p.widgets.map((w) => (w.id === widgetId ? { ...w, config: { ...w.config, [key]: value } } : w)),
      })),
    })),

  addPage: () =>
    set((s) => {
      const page: PageDef = { id: uid('p'), label: 'New page', icon: '▦', widgets: [] }
      const next = { ...s.layout, pages: [...s.layout.pages, page] }
      persist(next)
      return { layout: next, activePageId: page.id }
    }),

  removePage: (pageId) =>
    set((s) => {
      if (s.layout.pages.length <= 1) return s
      const next = { ...s.layout, pages: s.layout.pages.filter((p) => p.id !== pageId) }
      persist(next)
      return { layout: next, activePageId: next.pages[0].id }
    }),

  renamePage: (pageId, label, icon) =>
    set((s) => ({ layout: mutPage(s.layout, pageId, (p) => ({ ...p, label, icon })) })),

  resetLayout: () =>
    set(() => {
      const next = defaultLayout()
      persist(next)
      return { layout: next, activePageId: next.pages[0].id }
    }),

  importLayout: (doc) =>
    set(() => {
      persist(doc)
      return { layout: doc, activePageId: doc.pages[0]?.id ?? '' }
    }),

  /** THE COMMAND FENCE. v1 allowlist is exactly NB_IDENTIFY — the same
   *  precedent as net_bench_dashboard's vetted panel. Anything else throws. */
  send: (cmd) => {
    if (cmd.verb !== 'NB_IDENTIFY') {
      throw new Error(`Command fence: ${String((cmd as { verb: string }).verb)} is not in the v1 allowlist`)
    }
    console.info('[mirror:fence] emit', cmd)
    set((s) => ({ commandLog: [{ at: Date.now(), cmd }, ...s.commandLog].slice(0, 50) }))
  },
}))
