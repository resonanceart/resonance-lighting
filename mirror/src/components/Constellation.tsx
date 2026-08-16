import { useEffect, useRef, useState } from 'react'
import { solveTick, type SolvedNode } from '../lib/locate'
import { useMirror } from '../lib/store'
import type { Telemetry } from '../lib/types'

/**
 * The stage — Mirror v1's core surface, always visible behind the sheets
 * (TouchConsole's "tree above the controls"). Heard lights materialize, place
 * themselves in proportion to each other, and snap to the fix points you give
 * them by dragging. Unplaceable lights wait in the staging halo along the
 * bottom edge — honest, never guessed.
 */

/** Day Zero's signature color, replicated: the physical light blinks this hue. */
function signatureColor(id: string): string {
  const b = [0, 1, 2].map((i) => parseInt(id.slice(i * 2, i * 2 + 2), 16) || 0)
  const h = (b[0] * 7 + b[1] * 13 + b[2] * 31) % 12
  return `hsl(${h * 30}, 72%, 62%)`
}

/** A designed slot from fixtures.json (ADR-0032-exact, metres → normalized). */
interface Slot {
  id: string
  x: number
  y: number
  role: string
}

const SNAP_R = 0.035

export function Constellation({ telemetry }: { telemetry: Telemetry }) {
  const pinSeat = useMirror((s) => s.pinSeat)
  const unpinSeat = useMirror((s) => s.unpinSeat)
  const seats = useMirror((s) => s.seats)
  const send = useMirror((s) => s.send)

  const [nodes, setNodes] = useState<SolvedNode[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ id: string; moved: boolean } | null>(null)
  const latest = useRef(telemetry)
  latest.current = telemetry

  // The prescriptive tree: Blender lane's designed geometry (130 slots).
  useEffect(() => {
    fetch('/fixtures.json')
      .then((r) => r.json())
      .then((j: { fixtures: { fixture_id: string; role: string; position: number[] }[] }) => {
        setSlots(
          j.fixtures.map((f) => ({
            id: f.fixture_id,
            role: f.role,
            x: (f.position[0] + 5.5) / 11,
            y: (f.position[1] + 5.5) / 11,
          })),
        )
      })
      .catch(() => setSlots([])) // geometry missing = no slot layer, never a crash
  }, [])

  // Solver runs at 4 Hz on the freshest snapshot — smooth drift, no rework
  // when the live feed replaces the mock.
  useEffect(() => {
    const t = setInterval(() => {
      setNodes(solveTick(latest.current, useMirror.getState().seats))
    }, 250)
    return () => clearInterval(t)
  }, [])

  const toSvg = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current
    if (!svg) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const p = pt.matrixTransform(ctm.inverse())
    return { x: Math.min(0.98, Math.max(0.02, p.x / 100)), y: Math.min(0.98, Math.max(0.02, p.y / 100)) }
  }

  const onPointerDown = (id: string) => (e: React.PointerEvent) => {
    drag.current = { id, moved: false }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const p = toSvg(e.clientX, e.clientY)
    if (!p) return
    drag.current.moved = true
    pinSeat(drag.current.id, p.x, p.y) // dragging IS pinning — a fix point
  }
  const onPointerUp = () => {
    if (drag.current && !drag.current.moved) {
      setSelected(drag.current.id === selected ? null : drag.current.id)
    } else if (drag.current) {
      // Release near a designed slot → seat exactly there (MAC↔slot binding).
      const id = drag.current.id
      const seat = useMirror.getState().seats[id]
      if (seat) {
        let best: Slot | null = null
        let bestD = SNAP_R
        for (const s of slots) {
          const d = Math.hypot(s.x - seat.x, s.y - seat.y)
          if (d < bestD) {
            best = s
            bestD = d
          }
        }
        if (best) pinSeat(id, best.x, best.y, best.id)
      }
    }
    drag.current = null
  }

  const placed = nodes.filter((n) => n.placed)
  const staging = nodes.filter((n) => !n.placed)
  const pinned = nodes.filter((n) => n.pinned)
  const sel = selected ? telemetry.fixtures.find((f) => f.fixtureId === selected) : undefined
  const selNode = selected ? nodes.find((n) => n.id === selected) : undefined

  return (
    <div className="constellation">
      <p className="stage-status mono small">
        {telemetry.fixtures.length} heard · {placed.length} placed · {staging.length} staging · {pinned.length} fixed
      </p>

      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="application"
        aria-label="Light constellation — drag a light to pin it as a fix point"
      >
        {/* perimeter reference ring */}
        <circle cx={50} cy={50} r={46} className="ring" />

        {/* the designed tree: prescriptive slot positions, faint until seated */}
        {slots.map((s) => (
          <circle key={s.id} cx={s.x * 100} cy={s.y * 100} r={1.05} className="slot" />
        ))}

        {staging.length > 0 && <text x={50} y={99} className="halo-label">staging</text>}

        {nodes.map((n) => (
          <g key={n.id} transform={`translate(${n.x * 100} ${n.y * 100})`}>
            {n.pinned && <circle r={4.4} className="pin-ring" />}
            <circle
              r={n.placed ? 2.6 : 1.9}
              fill={signatureColor(n.id)}
              opacity={n.placed ? 1 : 0.65}
              className={selected === n.id ? 'node selected' : 'node'}
            />
            {/* generous invisible hit target (~44px at phone width) */}
            <circle r={6} fill="transparent" onPointerDown={onPointerDown(n.id)} style={{ cursor: 'grab' }} />
          </g>
        ))}
      </svg>

      {sel && selNode && (
        <div className="light-card">
          <div className="light-card-head">
            <i className="dot" style={{ background: signatureColor(sel.fixtureId) }} />
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
            {sel.soc === 255 ? 'SoC —' : `SoC ${sel.soc}%`} · {sel.battMv} mV · {sel.rssi} dBm · {sel.fwRev}
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
