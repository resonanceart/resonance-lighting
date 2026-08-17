import { useEffect, useRef, useState } from 'react'
import { solveTick, STAGE_POST, STAGE_MAX_R_M, type SolvedNode } from '../lib/locate'
import { useMirror, TREE_LIMIT_M } from '../lib/store'
import type { Telemetry } from '../lib/types'

/**
 * The stage — a WORLD in metres, tree axis at (0,0), always visible behind
 * the sheets. Navigator: drag empty space to pan, wheel or pinch to zoom,
 * +/−/⌂ buttons for touch. The world is larger than the tree so the staging
 * field (y ≈ +18 m, outside the perimeter) is a real place you can fly to.
 *
 * Lights render as neutral dots — no invented colors or classes; per-light
 * info arrives from the Resonance Fleet data as we get it.
 */

interface Slot {
  id: string
  x: number
  y: number
  role: string
  stale: boolean
}

/** Parsed tree_footprint.json (resonance.tree-footprint/0.1.0) — the real
 *  tree's plan-view shape, vertex-exact from the worksite model. */
interface Footprint {
  canopy: string
  trunk: string
  rootLobes: string[]
  lightRingR: number
  stationsAz: number[]
  ropeR: number
  doorsAz: number[]
}

/** 72-bin radial profile (5° azimuth, az 0 = +x, CCW) → SVG polygon points. */
function polyPoints(rs: number[]): string {
  return rs
    .map((r, i) => {
      const a = (i * 5 * Math.PI) / 180
      return `${(r * Math.cos(a)).toFixed(3)},${(r * Math.sin(a)).toFixed(3)}`
    })
    .join(' ')
}

/** Roots come as one 72-bin array with 0.0 = empty bins; split into lobes
 *  (contiguous non-zero runs, wrap-aware). */
function rootLobes(rs: number[]): string[] {
  const n = rs.length
  let start = rs.findIndex((r) => r === 0)
  if (start === -1) return [polyPoints(rs)]
  const lobes: string[] = []
  let run: string[] = []
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n
    if (rs[i] > 0) {
      const a = (i * 5 * Math.PI) / 180
      run.push(`${(rs[i] * Math.cos(a)).toFixed(3)},${(rs[i] * Math.sin(a)).toFixed(3)}`)
    } else if (run.length) {
      lobes.push(run.join(' '))
      run = []
    }
  }
  if (run.length) lobes.push(run.join(' '))
  return lobes
}

const SNAP_M = 0.9
const PERIMETER_R_M = 15.07 // Elliot's worksite spec (2026-08-16)
const HOME = { cx: 0, cy: 6, span: 48 }

export function Constellation({ telemetry }: { telemetry: Telemetry }) {
  const pinSeat = useMirror((s) => s.pinSeat)
  const unpinSeat = useMirror((s) => s.unpinSeat)
  const seats = useMirror((s) => s.seats)
  const send = useMirror((s) => s.send)

  const [nodes, setNodes] = useState<SolvedNode[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [fp, setFp] = useState<Footprint | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [cam, setCam] = useState(HOME)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ id: string; moved: boolean } | null>(null)
  const pan = useRef<{ x: number; y: number } | null>(null)
  const pinchD = useRef<number | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const latest = useRef(telemetry)
  latest.current = telemetry

  // The prescriptive tree geometry (designed slots, world metres).
  useEffect(() => {
    fetch('/fixtures.json')
      .then((r) => r.json())
      .then((j: { fixtures: { fixture_id: string; role: string; position: number[] }[] }) => {
        setSlots(
          j.fixtures.map((f) => ({
            id: f.fixture_id,
            role: f.role,
            x: f.position[0],
            y: f.position[1],
            stale: f.role === 'perimeter', // superseded: real ring is at r 15.07 m
          })),
        )
      })
      .catch(() => setSlots([]))
  }, [])

  // The real tree's shape (blender lane, vertex-exact, same datum).
  useEffect(() => {
    fetch('/tree_footprint.json')
      .then((r) => r.json())
      .then(
        (j: {
          profiles_r_by_azimuth: { canopy: number[]; trunk: number[]; roots: number[] }
          worksite_rings: { light_ring: { r_m: number; stations_az_deg: number[] }; rope: { r_m: number } }
          doors_az_deg: number[]
        }) => {
          setFp({
            canopy: polyPoints(j.profiles_r_by_azimuth.canopy),
            trunk: polyPoints(j.profiles_r_by_azimuth.trunk),
            rootLobes: rootLobes(j.profiles_r_by_azimuth.roots),
            lightRingR: j.worksite_rings.light_ring.r_m,
            stationsAz: j.worksite_rings.light_ring.stations_az_deg,
            ropeR: j.worksite_rings.rope.r_m,
            doorsAz: j.doors_az_deg,
          })
        },
      )
      .catch(() => setFp(null)) // footprint missing = plain rings, never a crash
  }, [])

  // Solver at 4 Hz on the freshest snapshot.
  useEffect(() => {
    const t = setInterval(() => {
      setNodes(solveTick(latest.current, useMirror.getState().seats))
    }, 250)
    return () => clearInterval(t)
  }, [])

  const toWorld = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current
    if (!svg) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const p = pt.matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  const zoomBy = (factor: number) =>
    setCam((c) => ({ ...c, span: Math.min(90, Math.max(5, c.span * factor)) }))

  // ── node drag (pin) ──────────────────────────────────────────────
  const onNodeDown = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation()
    drag.current = { id, moved: false }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  // ── background pan / pinch ───────────────────────────────────────
  const onBgDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) pan.current = { x: e.clientX, y: e.clientY }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchD.current = Math.hypot(a.x - b.x, a.y - b.y)
      pan.current = null
    }
  }

  const onMove = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (drag.current) {
      const p = toWorld(e.clientX, e.clientY)
      if (!p) return
      drag.current.moved = true
      pinSeat(drag.current.id, Math.max(-23, Math.min(23, p.x)), Math.max(-23, Math.min(23, p.y)))
      return
    }
    if (pointers.current.size === 2 && pinchD.current !== null) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d > 0) {
        zoomBy(pinchD.current / d)
        pinchD.current = d
      }
      return
    }
    if (pan.current) {
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const unitsPerPx = cam.span / Math.min(rect.width, rect.height)
      setCam((c) => ({
        ...c,
        cx: c.cx - (e.clientX - pan.current!.x) * unitsPerPx,
        cy: c.cy - (e.clientY - pan.current!.y) * unitsPerPx,
      }))
      pan.current = { x: e.clientX, y: e.clientY }
    }
  }

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchD.current = null
    if (pointers.current.size === 0) pan.current = null

    if (drag.current) {
      if (!drag.current.moved) {
        setSelected(drag.current.id === selected ? null : drag.current.id)
      } else {
        const id = drag.current.id
        const seat = useMirror.getState().seats[id]
        if (seat) {
          if (Math.hypot(seat.x, seat.y) > TREE_LIMIT_M) {
            // Fix points only exist on the tree: released outside → no pin,
            // the light returns to its self-located staging position.
            unpinSeat(id)
          } else {
            // Release near a live designed slot → seat exactly there (MAC↔slot).
            let best: Slot | null = null
            let bestD = SNAP_M
            for (const s of slots) {
              if (s.stale) continue // never seat onto superseded geometry
              const d = Math.hypot(s.x - seat.x, s.y - seat.y)
              if (d < bestD) {
                best = s
                bestD = d
              }
            }
            if (best) pinSeat(id, best.x, best.y, best.id)
          }
        }
      }
      drag.current = null
    }
  }

  const onWheel = (e: React.WheelEvent) => zoomBy(e.deltaY > 0 ? 1.12 : 0.89)

  const placed = nodes.filter((n) => n.placed)
  const staging = nodes.filter((n) => !n.placed)
  const pinnedN = nodes.filter((n) => n.pinned)
  const sel = selected ? telemetry.fixtures.find((f) => f.fixtureId === selected) : undefined
  const selNode = selected ? nodes.find((n) => n.id === selected) : undefined

  // Screen-constant sizes: world radius scales with the visible span.
  const u = cam.span / 100
  const half = cam.span / 2
  const viewBox = `${cam.cx - half} ${cam.cy - half} ${cam.span} ${cam.span}`

  return (
    <div className="constellation">
      <p className="stage-status mono small">
        {telemetry.fixtures.length} heard · {placed.length} placed · {staging.length} staging · {pinnedN.length} fixed
      </p>

      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onBgDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
        role="application"
        aria-label="World view — drag empty space to move around the tree, pinch or scroll to zoom, drag a light to pin it"
      >
        {/* the real tree (worksite footprint) or plain rings as fallback */}
        {fp ? (
          <g className="footprint">
            <circle cx={0} cy={0} r={fp.ropeR} className="ring rope" />
            {fp.doorsAz.map((az) => {
              const a = (az * Math.PI) / 180
              return (
                <line
                  key={az}
                  x1={(fp.ropeR - 1) * Math.cos(a)}
                  y1={(fp.ropeR - 1) * Math.sin(a)}
                  x2={(fp.ropeR + 1) * Math.cos(a)}
                  y2={(fp.ropeR + 1) * Math.sin(a)}
                  className="door"
                  strokeWidth={u * 0.6}
                />
              )
            })}
            <circle cx={0} cy={0} r={fp.lightRingR} className="ring" />
            {fp.stationsAz.map((az) => {
              const a = (az * Math.PI) / 180
              return (
                <circle
                  key={az}
                  cx={fp.lightRingR * Math.cos(a)}
                  cy={fp.lightRingR * Math.sin(a)}
                  r={u * 1.1}
                  className="station"
                />
              )
            })}
            {fp.rootLobes.map((pts, i) => (
              <polygon key={i} points={pts} className="fp-roots" />
            ))}
            <polygon points={fp.canopy} className="fp-canopy" />
            <polygon points={fp.trunk} className="fp-trunk" />
          </g>
        ) : (
          <g>
            <circle cx={0} cy={0} r={PERIMETER_R_M} className="ring" />
            <circle cx={0} cy={0} r={5.05} className="ring ring-inner" />
          </g>
        )}

        {/* designed slots; stale perimeter ghosts excluded from seating */}
        {slots.map((s) => (
          <circle key={s.id} cx={s.x} cy={s.y} r={u * 0.9} className={s.stale ? 'slot stale' : 'slot'} />
        ))}

        {staging.length > 0 && (
          <g>
            <text x={STAGE_POST.x} y={STAGE_POST.y - STAGE_MAX_R_M - 1.2} className="halo-label" style={{ fontSize: u * 2.4 }}>
              staging · range from bridge
            </text>
            {/* the listening post + real range rings */}
            <circle cx={STAGE_POST.x} cy={STAGE_POST.y} r={u * 1.4} className="post" />
            {[2, 4].map((r) => (
              <circle key={r} cx={STAGE_POST.x} cy={STAGE_POST.y} r={r} className="range-ring" />
            ))}
            <circle cx={STAGE_POST.x} cy={STAGE_POST.y} r={STAGE_MAX_R_M} className="range-ring outer" />
          </g>
        )}

        {nodes.map((n) => (
          <g key={n.id} transform={`translate(${n.x} ${n.y})`}>
            {n.pinned && <circle r={u * 3.4} className="pin-ring" strokeWidth={u * 0.45} />}
            <circle
              r={n.placed ? u * 2.1 : u * 1.6}
              className={`node ${n.placed ? 'node-placed' : 'node-staging'} ${selected === n.id ? 'selected' : ''}`}
              strokeWidth={u * 0.6}
            />
            <circle r={u * 5} fill="transparent" onPointerDown={onNodeDown(n.id)} style={{ cursor: 'grab' }} />
          </g>
        ))}
      </svg>

      <div className="nav-cluster" role="group" aria-label="Navigator">
        <button aria-label="Zoom in" onClick={() => zoomBy(0.72)}>+</button>
        <button aria-label="Zoom out" onClick={() => zoomBy(1.38)}>−</button>
        <button aria-label="Fit world" onClick={() => setCam(HOME)}>⌂</button>
      </div>

      {sel && selNode && (
        <div className="light-card">
          <div className="light-card-head">
            <span className="mono">{sel.fixtureId}</span>
            <span className="muted small">
              {seats[sel.fixtureId]?.slot
                ? `seated at ${seats[sel.fixtureId].slot}`
                : selNode.placed
                  ? selNode.pinned
                    ? 'fixed point'
                    : 'self-placed'
                  : 'staging'}
            </span>
          </div>
          <p className="muted small">
            {sel.rssi !== 0 ? `${sel.rssi} dBm · ` : ''}
            {sel.fwRev}
          </p>
          <div className="row-gap">
            <button className="btn-accent" onClick={() => send({ verb: 'NB_IDENTIFY', target: sel.fixtureId })}>
              Blink it
            </button>
            {selNode.pinned && (
              <button className="btn-line" onClick={() => unpinSeat(sel.fixtureId)}>
                Unpin
              </button>
            )}
            <button className="btn-line" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <p className="muted small">Blink → find it on the tree → drag its dot to where it really hangs.</p>
        </div>
      )}
    </div>
  )
}
