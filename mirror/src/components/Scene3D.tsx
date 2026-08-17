import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Box3, Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { solveTick, type SolvedNode } from '../lib/locate'
import { useMirror } from '../lib/store'
import type { Telemetry } from '../lib/types'

/**
 * The 3-D stage — the original controller's orbit, verbatim (camera
 * [40,30,60] fov 45, drei OrbitControls makeDefault enableDamping).
 *
 * TRUTH RULE (Elliot, 2026-08-17): a light appears in the world ONLY when it
 * has a legitimate position — seated by a human onto a slot, or (future,
 * packet 22) genuinely self-located. Heard-but-unlocated lights are a COUNT
 * in the status line, never dots in space. There is no staging blob.
 *
 * Seating is slot-first per Elliot's directive: each perimeter pole station
 * carries TWO assignable slots (PL-NN-A/B). Tap a slot → pick which heard
 * light hangs there. The MAC↔slot bindings are the Mirror's own layer
 * (localStorage), outside the LX gate; a future F-id re-key is a rename.
 */

const BLENDER_TO_THREE = ([x, y, z]: number[]): [number, number, number] => [x, z, -y]

function TreeModel() {
  // worksite-tree.glb — Ed's model, source-fixed true metres (a6f5483).
  const { scene } = useGLTF('/worksite-tree.glb')
  // Units guard, measured against the known 40.18 m worksite span:
  // >90 m → 10x-stale export ×0.1 · <5 m → inch-wrapper double-applied ×39.37.
  // Dormant on the fixed asset; kept as defense.
  const scale = useMemo(() => {
    const size = new Box3().setFromObject(scene).getSize(new Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    if (maxDim > 90) return 0.1
    if (maxDim < 5) return 39.37
    return 1
  }, [scene])
  return <primitive object={scene} scale={scale} />
}

function GroundRing({ r, opacity }: { r: number; opacity: number }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
      <ringGeometry args={[r - 0.06, r + 0.06, 160]} />
      <meshBasicMaterial color="#7b8aa3" transparent opacity={opacity} />
    </mesh>
  )
}

/** Assignable perimeter slot (Elliot: two per pole station). */
interface PlSlot {
  id: string
  station: string
  plan: { x: number; y: number }
  p: [number, number, number]
}

export function Scene3D({ telemetry }: { telemetry: Telemetry }) {
  const seats = useMirror((s) => s.seats)
  const pinSeat = useMirror((s) => s.pinSeat)
  const unpinSeat = useMirror((s) => s.unpinSeat)

  const [nodes, setNodes] = useState<SolvedNode[]>([])
  const [plSlots, setPlSlots] = useState<PlSlot[]>([])
  const [rings, setRings] = useState<{ light: number; rope: number } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [slotSel, setSlotSel] = useState<string | null>(null)
  const [seatPick, setSeatPick] = useState<string>('')
  const controls = useRef<OrbitControlsImpl>(null)
  const latest = useRef(telemetry)
  latest.current = telemetry

  // Assignable perimeter slots — worksite table, perimeter class only
  // (the rest of the table is LX-gated and not shipped).
  useEffect(() => {
    fetch('/perimeter_slots.json')
      .then((r) => r.json())
      .then((j: { slots: { id: string; pos_m: number[] }[] }) => {
        setPlSlots(
          j.slots.map((s) => ({
            id: s.id,
            station: s.id.slice(0, 5), // PL-NN
            plan: { x: s.pos_m[0], y: s.pos_m[1] },
            p: BLENDER_TO_THREE(s.pos_m),
          })),
        )
      })
      .catch(() => setPlSlots([]))
    fetch('/tree_footprint.json')
      .then((r) => r.json())
      .then(
        (j: {
          worksite_rings: { light_ring: { r_m: number }; rope: { r_m: number } }
        }) => {
          setRings({ light: j.worksite_rings.light_ring.r_m, rope: j.worksite_rings.rope.r_m })
        },
      )
      .catch(() => setRings(null))
  }, [])

  useEffect(() => {
    const t = setInterval(() => {
      setNodes(solveTick(latest.current, useMirror.getState().seats))
    }, 250)
    return () => clearInterval(t)
  }, [])

  const zBySlot = useMemo(() => new Map(plSlots.map((s) => [s.id, s.p[1]])), [plSlots])
  const macBySlot = useMemo(() => {
    const m = new Map<string, string>()
    for (const [mac, seat] of Object.entries(seats)) if (seat.slot) m.set(seat.slot, mac)
    return m
  }, [seats])

  const seated = nodes.filter((n) => n.pinned)
  const located = nodes.filter((n) => n.placed && !n.pinned)
  const unlocated = telemetry.fixtures.length - nodes.length
  const sel = selected ? telemetry.fixtures.find((f) => f.fixtureId === selected) : undefined
  const selNode = selected ? nodes.find((n) => n.id === selected) : undefined
  const slot = slotSel ? plSlots.find((s) => s.id === slotSel) : undefined
  const slotMac = slot ? macBySlot.get(slot.id) : undefined
  const unseatedHeard = telemetry.fixtures.filter((f) => !seats[f.fixtureId]).map((f) => f.fixtureId)

  const seatIt = () => {
    if (!slot || !seatPick) return
    pinSeat(seatPick, slot.plan.x, slot.plan.y, slot.id)
    setSeatPick('')
    setSlotSel(null)
  }

  return (
    <div className="scene3d">
      <p className="stage-status mono small">
        {telemetry.fixtures.length} heard · {unlocated} not yet located · {located.length} self-located ·{' '}
        {seated.length} seated
      </p>

      <Canvas camera={{ position: [40, 30, 60], fov: 45, near: 0.1, far: 5000 }}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[30, 50, 20]} intensity={0.8} />

        <Suspense fallback={null}>
          <TreeModel />
        </Suspense>

        {/* Rings only — no station markers: the pole structures are in the
            model itself, and extra spheres read as lights (Elliot). */}
        {rings && (
          <>
            <GroundRing r={rings.light} opacity={0.5} />
            <GroundRing r={rings.rope} opacity={0.25} />
          </>
        )}

        {/* assignable perimeter slots — SOCKETS, not lights: empty = hollow
            ring; occupied = no marker (the seated light itself renders) */}
        {plSlots.map((s) => {
          const occupied = macBySlot.has(s.id)
          return (
            <group key={s.id} position={s.p}>
              {!occupied && (
                <mesh rotation-x={-Math.PI / 2}>
                  <torusGeometry args={[0.24, 0.045, 8, 24]} />
                  <meshBasicMaterial
                    color={slotSel === s.id ? '#5b8cff' : '#7b8aa3'}
                    transparent
                    opacity={slotSel === s.id ? 1 : 0.7}
                  />
                </mesh>
              )}
              <mesh
                onClick={(e) => {
                  e.stopPropagation()
                  setSelected(null)
                  setSlotSel(s.id === slotSel ? null : s.id)
                }}
              >
                <sphereGeometry args={[0.9, 8, 8]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            </group>
          )
        })}

        {/* lights with legitimate positions only (seated / self-located) */}
        {nodes.map((n) => {
          const h = seats[n.id]?.slot ? (zBySlot.get(seats[n.id].slot!) ?? 0.6) : 0.6
          return (
            <group key={n.id} position={[n.x, h, -n.y]}>
              <mesh>
                <sphereGeometry args={[0.32, 14, 14]} />
                <meshBasicMaterial color={selected === n.id ? '#5b8cff' : '#dbe4f0'} />
              </mesh>
              <mesh
                onClick={(e) => {
                  e.stopPropagation()
                  setSlotSel(null)
                  setSelected(n.id === selected ? null : n.id)
                }}
              >
                <sphereGeometry args={[0.8, 8, 8]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            </group>
          )
        })}

        <OrbitControls ref={controls} makeDefault enableDamping />
      </Canvas>

      <div className="nav-cluster" role="group" aria-label="Navigator">
        <button aria-label="Reset view" onClick={() => controls.current?.reset()}>⌂</button>
      </div>

      {slot && (
        <div className="light-card">
          <div className="light-card-head">
            <span className="mono">{slot.id}</span>
            <span className="muted small">station {slot.station} · {slot.id.endsWith('A') ? 'CCW' : 'CW'} pole side</span>
          </div>
          {slotMac ? (
            <>
              <p className="muted small">
                Seated: <span className="mono">{slotMac}</span>
              </p>
              <div className="row-gap">
                <button className="btn-line danger-text" onClick={() => { unpinSeat(slotMac); setSlotSel(null) }}>
                  Unseat
                </button>
                <button className="btn-line" onClick={() => setSlotSel(null)}>Close</button>
              </div>
            </>
          ) : (
            <>
              <div className="source-live">
                <select value={seatPick} onChange={(e) => setSeatPick(e.target.value)} aria-label="Pick a heard light">
                  <option value="">Pick a heard light…</option>
                  {unseatedHeard.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
                <button className="btn-accent" onClick={seatIt} disabled={!seatPick}>
                  Seat
                </button>
              </div>
              <p className="muted small">{unseatedHeard.length} heard lights not yet seated.</p>
              <div className="row-gap">
                <button className="btn-line" onClick={() => setSlotSel(null)}>Close</button>
              </div>
            </>
          )}
        </div>
      )}

      {sel && selNode && !slot && (
        <div className="light-card">
          <div className="light-card-head">
            <span className="mono">{sel.fixtureId}</span>
            <span className="muted small">
              {seats[sel.fixtureId]?.slot ? `seated at ${seats[sel.fixtureId].slot}` : 'self-located'}
            </span>
          </div>
          <p className="muted small">
            {sel.rssi !== 0 ? `${sel.rssi} dBm · ` : ''}
            {sel.fwRev}
          </p>
          <div className="row-gap">
            {selNode.pinned && (
              <button className="btn-line" onClick={() => unpinSeat(sel.fixtureId)}>
                Unseat
              </button>
            )}
            <button className="btn-line" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

useGLTF.preload('/worksite-tree.glb')
