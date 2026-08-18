import { create } from 'zustand'
import type { LayoutDoc, MirrorCommand, PageDef, WidgetInstance } from './types'
import { getWidgetDef } from './registry'
import type { SeatMap } from './locate'

/** Sentinel tab id: the always-on constellation stage (no sheet open). */
export const TREE_TAB = 'tree'

/**
 * The layout document IS the interface. Everything the operator composes in
 * edit mode lives in this one JSON doc, persisted to localStorage and
 * exportable/importable as a file — the "no code changes" contract.
 */

// v2 keys orphaned the mock era; seats-v3 switched to world-metre coords.
const STORAGE_KEY = 'mirror-layout-v2'
const SOURCE_KEY = 'mirror-datasource-v2'
const SEATS_KEY = 'mirror-seats-v3'

/** Fix points only make sense ON the tree — anything outside this radius
 *  (e.g. accidental drags in the staging field) is not a seat. */
export const TREE_LIMIT_M = 16.5

function loadSeats(): SeatMap {
  try {
    const raw = localStorage.getItem(SEATS_KEY)
    if (raw) {
      const s = JSON.parse(raw) as SeatMap
      if (s && typeof s === 'object') {
        const clean: SeatMap = {}
        for (const [id, seat] of Object.entries(s)) {
          if (Math.hypot(seat.x, seat.y) <= TREE_LIMIT_M) clean[id] = seat
        }
        return clean
      }
    }
  } catch {
    /* fall through */
  }
  return {}
}

/** Real data only — the Mirror is the real-life listener. Default is the
 *  same-origin /bench proxy to a running net_bench_dashboard.py. There is no
 *  mock and there are no fake IDs anywhere in this app. */
export type DataSource = { url: string }

function loadSource(): DataSource {
  try {
    const raw = localStorage.getItem(SOURCE_KEY)
    if (raw) {
      const s = JSON.parse(raw) as DataSource
      if (typeof s.url === 'string' && s.url.length > 0) return s
    }
  } catch {
    /* fall through */
  }
  return { url: '/bench' }
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

/** The one exception to blank-canvas: Elliot-named adoptions ship pre-seeded
 *  (2026-08-17: "bring Ben's dashboard into the Mirror as the fleet screen").
 *  Stable id so load() can heal layouts saved before the page existed. */
function fleetPage(): PageDef {
  const w = (type: string, span: 1 | 2, config: Record<string, unknown> = {}): WidgetInstance => ({
    id: uid('w'),
    type,
    span,
    visible: true,
    config,
  })
  return {
    id: 'fleet',
    label: 'Fleet',
    icon: '💡',
    widgets: [
      w('stat-tile', 1, { metric: 'alive' }),
      w('stat-tile', 1, { metric: 'stale' }),
      w('fleet-census', 2, { cls: 'all' }),
      w('rssi-signal', 2, { worstFirst: true }),
      w('battery-gauge', 2, { sort: 'soc' }),
      w('program-truth', 2),
    ],
  }
}

/** Elliot-named adoption #2 (2026-08-17: "bring in the flash as well"). */
function flashPage(): PageDef {
  return {
    id: 'flash',
    label: 'Flash',
    icon: '⚡',
    widgets: [{ id: uid('w'), type: 'flash-station', span: 2, visible: true, config: {} }],
  }
}

/** Starter layout: the Fleet screen (Elliot-named), then Elliot's tab set
 *  shipped EMPTY on purpose — every other dashboard is built by the operator
 *  from the widget palette in Edit mode. The library is the product; the
 *  pages are canvases. */
export function defaultLayout(): LayoutDoc {
  const page = (label: string, icon: string): PageDef => ({ id: uid('p'), label, icon, widgets: [] })
  return {
    version: 1,
    name: 'Console',
    pages: [
      fleetPage(),
      flashPage(),
      page('Locate', '🔎'),
      page('Command', '🎛'),
      page('Lightshow', '🎬'),
      page('Settings', '⚙️'),
    ],
  }
}

function load(): LayoutDoc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const doc = JSON.parse(raw) as LayoutDoc
      if (doc.version === 1 && Array.isArray(doc.pages)) {
        if (!doc.pages.some((p) => p.id === 'flash')) doc.pages.unshift(flashPage())
        if (!doc.pages.some((p) => p.id === 'fleet')) doc.pages.unshift(fleetPage())
        return doc
      }
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
  dataSource: DataSource
  /** Fix points: human-pinned positions, the locate solver's anchors. */
  seats: SeatMap
  /** Log of every fenced command emission — the audit trail. */
  commandLog: { at: number; cmd: MirrorCommand }[]
  /** Tags this tab currently holds (id → lease-expiry ms). Renewal rides
   *  ensureTagRenewer; the WORLD's tag truth is the fixture's own led_g. */
  activeTags: Record<string, number>

  setDataSource: (s: DataSource) => void
  pinSeat: (id: string, x: number, y: number, slot?: string) => void
  unpinSeat: (id: string) => void

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
  /** Click-to-control C0: toggle the steady-green tag on one light. */
  toggleTag: (id: string) => void
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

export const useMirror = create<MirrorStore>((set, get) => ({
  layout: load(),
  activePageId: TREE_TAB,
  editMode: false,
  dataSource: loadSource(),
  seats: loadSeats(),
  commandLog: [],
  activeTags: {},

  pinSeat: (id, x, y, slot) =>
    set((s) => {
      const seats = { ...s.seats, [id]: slot ? { x, y, slot } : { x, y } }
      try {
        localStorage.setItem(SEATS_KEY, JSON.stringify(seats))
      } catch {
        /* in-memory only */
      }
      return { seats }
    }),

  unpinSeat: (id) =>
    set((s) => {
      const seats = { ...s.seats }
      delete seats[id]
      try {
        localStorage.setItem(SEATS_KEY, JSON.stringify(seats))
      } catch {
        /* in-memory only */
      }
      return { seats }
    }),

  setDataSource: (s) => {
    try {
      localStorage.setItem(SOURCE_KEY, JSON.stringify(s))
    } catch {
      /* in-memory only */
    }
    set({ dataSource: s })
  },

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

  /** THE COMMAND FENCE. Allowlist (design 28 @ 8b5fb0c, comms-owner
   *  sanctioned, Elliot-directed): NB_IDENTIFY ('i<MAC6>'/'I' — pixel-
   *  INVISIBLE on today's fleet, kept for wire tests) and TAG ('T<id>:1|0'
   *  — the VISIBLE green instrument, 255s RAM-only lease). Anything else
   *  throws. All sends ride the dashboard's own vetted POST /api/cmd,
   *  re-validated server-side — the dashboard stays the ONLY serial writer
   *  (rate discipline, memo 28). Fire-and-forget: UI never blocks on radio. */
  send: (cmd) => {
    if (cmd.verb !== 'NB_IDENTIFY' && cmd.verb !== 'TAG') {
      throw new Error(`Command fence: ${String((cmd as { verb: string }).verb)} is not in the allowlist`)
    }
    const wire =
      cmd.verb === 'NB_IDENTIFY'
        ? cmd.target === 'all'
          ? 'I'
          : `i${cmd.target.toUpperCase()}`
        : `T${cmd.target.toUpperCase()}:${cmd.on ? 1 : 0}`
    console.info('[mirror:fence] emit', wire)
    set((s) => ({ commandLog: [{ at: Date.now(), cmd }, ...s.commandLog].slice(0, 50) }))
    fetch(`${get().dataSource.url.replace(/\/+$/, '')}/api/cmd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: wire, label: `${cmd.verb} ${cmd.target}` }),
    })
      .then((r) => r.json())
      .then((j) => console.info('[mirror:fence] dashboard ack', j))
      .catch((e) => console.warn('[mirror:fence] emit failed (feed down?)', e))
  },

  toggleTag: (id) => {
    const on = !(id in get().activeTags)
    get().send({ verb: 'TAG', target: id, on })
    set((s) => {
      const activeTags = { ...s.activeTags }
      if (on) activeTags[id] = Date.now() + 255_000
      else delete activeTags[id]
      return { activeTags }
    })
    ensureTagRenewer()
  },
}))

/** Tag leases are 255s RAM-only on the fixture; the dashboard renews its own
 *  at 120s. Same discipline here: re-send every 110s while this tab holds
 *  tags; the interval dissolves when the last tag clears. A dead tab
 *  self-heals — the fixture lease simply expires. Browser-runtime only. */
let renewTimer: ReturnType<typeof setInterval> | null = null
function ensureTagRenewer() {
  if (renewTimer) return
  renewTimer = setInterval(() => {
    const s = useMirror.getState()
    const ids = Object.keys(s.activeTags)
    if (!ids.length) {
      clearInterval(renewTimer!)
      renewTimer = null
      return
    }
    for (const id of ids) s.send({ verb: 'TAG', target: id, on: true })
    useMirror.setState({ activeTags: Object.fromEntries(ids.map((id) => [id, Date.now() + 255_000])) })
  }, 110_000)
}
