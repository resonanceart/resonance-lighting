import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Box3, Mesh, MeshStandardMaterial, Vector3 } from 'three'
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

const fmtAge = (ms: number): string => (ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 1000)}s`)

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

function ChandelierModel() {
  // chandelier.glb — true-metre cut (1.50 m span, re-verified at copy time).
  // Ed's worksite export does not carry the chandelier; it is its own asset,
  // anchored on the chandelier fixtures' centroid from fixtures.json — the
  // same convention as the twin app, so both worlds hang it in one place.
  const { scene } = useGLTF('/chandelier.glb')
  const [at, setAt] = useState<[number, number, number] | null>(null)
  useEffect(() => {
    fetch('/fixtures.json')
      .then((r) => r.json())
      .then((j: { fixtures?: { role?: string; position: number[] }[] }) => {
        const ch = (j.fixtures ?? []).filter((f) => f.role === 'chandelier')
        if (ch.length === 0) return
        const s = ch.reduce((a, f) => [a[0] + f.position[0], a[1] + f.position[1], a[2] + f.position[2]], [0, 0, 0])
        setAt(BLENDER_TO_THREE([s[0] / ch.length, s[1] / ch.length, s[2] / ch.length]))
      })
      .catch(() => setAt(null))
  }, [])
  // 10x-stale-units guard, same spirit as TreeModel's: the chandelier is a
  // ~1.5 m object; >5 m means an old 10x export slipped back in.
  const scale = useMemo(() => {
    const size = new Box3().setFromObject(scene).getSize(new Vector3())
    return Math.max(size.x, size.y, size.z) > 5 ? 0.1 : 1
  }, [scene])
  // Amber, the twin's chandelier convention — inside the gray trunk lattice
  // an unstyled gray mesh reads as more structure and disappears.
  const styled = useMemo(() => {
    const s = scene.clone(true)
    const mat = new MeshStandardMaterial({ color: '#c08a3e', roughness: 0.65, metalness: 0.35 })
    s.traverse((o) => {
      if ((o as Mesh).isMesh) (o as Mesh).material = mat
    })
    return s
  }, [scene])
  if (!at) return null
  return <primitive object={styled} position={at} scale={scale} />
}

/** Exposes the three scene on window for the stage regression's scene-graph
 *  assertions (position/scale checks that pixel screenshots can't make). */
function DebugSceneHandle() {
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>
    w.__mirrorScene = scene
    w.__mirrorCamera = camera
    w.__mirrorControls = controls
  }, [scene, camera, controls])
  return null
}

function GroundRing({ r, opacity }: { r: number; opacity: number }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
      <ringGeometry args={[r - 0.06, r + 0.06, 160]} />
      <meshBasicMaterial color="#7b8aa3" transparent opacity={opacity} />
    </mesh>
  )
}

/** An assignable seat in the world — a worksite perimeter slot (PL-NN-A/B)
 *  or a designed fixture seat from fixtures.json (F-ids, 130 total).
 *  Every seat is a tap target — Elliot's standing rule (bf18a5c1). */
interface SeatDef {
  id: string
  station: string
  kind: 'worksite' | 'fixture'
  plan: { x: number; y: number }
  p: [number, number, number]
}

/** F106-F129 (fixtures.json perimeter class) render-gate: their move to the
 *  r 15.07 worksite ring awaits Elliot's ruling (perimeter_id_map.json).
 *  Until then the PL-NN-A/B worksite slots represent the perimeter and the
 *  F-seats stay hidden — flip this ONE line when the ruling lands. */
const SHOW_FIXTURE_PERIMETER_SEATS = false

export function Scene3D({ telemetry }: { telemetry: Telemetry }) {
  const seats = useMirror((s) => s.seats)
  const pinSeat = useMirror((s) => s.pinSeat)
  const unpinSeat = useMirror((s) => s.unpinSeat)
  const toggleTag = useMirror((s) => s.toggleTag)
  const activeTags = useMirror((s) => s.activeTags)

  const [nodes, setNodes] = useState<SolvedNode[]>([])
  const [plSlots, setPlSlots] = useState<SeatDef[]>([])
  const [fxSeats, setFxSeats] = useState<SeatDef[]>([])
  const [rings, setRings] = useState<{ light: number; rope: number } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [slotSel, setSlotSel] = useState<string | null>(null)
  const [seatPick, setSeatPick] = useState<string>('')
  const controls = useRef<OrbitControlsImpl>(null)
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null)
  const latest = useRef(telemetry)
  latest.current = telemetry

  // The listen window the census cites (adapter.listenWindowS). The bench
  // dashboard NEVER prunes peers (state.peers[pid] accumulates for the whole
  // bench session), so the Mirror must enforce the window it claims — a light
  // silent for an hour is not "heard".
  const windowMs = telemetry.listenWindowS * 1000
  const heard = useMemo(
    () => telemetry.fixtures.filter((f) => f.lastHeardMs < windowMs),
    [telemetry, windowMs],
  )
  const heardIds = useMemo(() => new Set(heard.map((f) => f.fixtureId)), [heard])
  // TAG TRUTH: a light renders green from its OWN telemetry (ledG), never
  // from our send intent — the tab's activeTags only labels buttons.
  const greenIds = useMemo(
    () => new Set(heard.filter((f) => (f.ledG ?? 0) > 0).map((f) => f.fixtureId)),
    [heard],
  )

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
            kind: 'worksite' as const,
            plan: { x: s.pos_m[0], y: s.pos_m[1] },
            p: BLENDER_TO_THREE(s.pos_m),
          })),
        )
      })
      .catch(() => setPlSlots([]))
    // Designed fixture seats — every seat is a tap target (Elliot's standing
    // rule). Perimeter F-seats are gated on the F106-F129 ruling (see const).
    fetch('/fixtures.json')
      .then((r) => r.json())
      .then((j: { fixtures?: { fixture_id: string; role: string; position: number[] }[] }) => {
        setFxSeats(
          (j.fixtures ?? [])
            .filter((f) => SHOW_FIXTURE_PERIMETER_SEATS || f.role !== 'perimeter')
            .map((f) => ({
              id: f.fixture_id,
              station: f.role,
              kind: 'fixture' as const,
              plan: { x: f.position[0], y: f.position[1] },
              p: BLENDER_TO_THREE(f.position),
            })),
        )
      })
      .catch(() => setFxSeats([]))
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
      // Solve over the listen window only — a stale peer must not hold a
      // phantom spring or a phantom dot.
      const tel = latest.current
      const win = tel.listenWindowS * 1000
      setNodes(
        solveTick(
          { ...tel, fixtures: tel.fixtures.filter((f) => f.lastHeardMs < win) },
          useMirror.getState().seats,
        ),
      )
    }, 250)
    return () => clearInterval(t)
  }, [])

  const allSeats = useMemo(() => [...plSlots, ...fxSeats], [plSlots, fxSeats])
  const zBySlot = useMemo(() => new Map(allSeats.map((s) => [s.id, s.p[1]])), [allSeats])
  const macBySlot = useMemo(() => {
    const m = new Map<string, string>()
    for (const [mac, seat] of Object.entries(seats)) if (seat.slot) m.set(seat.slot, mac)
    return m
  }, [seats])

  // A seat is a fact about the WORLD (a human hung that light there); the
  // radio going quiet does not un-hang it. Seated counts come from the seat
  // map, and a silent seat renders muted — visible, never identical to live.
  const seatedTotal = Object.keys(seats).length
  const silentSeats = Object.entries(seats).filter(([id]) => !heardIds.has(id))
  const located = nodes.filter((n) => n.placed && !n.pinned)
  const unlocated = Math.max(0, heard.length - nodes.length)
  // Card lookup searches ALL fixtures (stale rows included) so a silent
  // light's card can still cite "last heard Ns ago" from the dashboard row.
  const sel = selected ? telemetry.fixtures.find((f) => f.fixtureId === selected) : undefined
  const selSeat = selected ? seats[selected] : undefined
  const selNode = selected ? nodes.find((n) => n.id === selected) : undefined
  const slot = slotSel ? allSeats.find((s) => s.id === slotSel) : undefined
  const slotMac = slot ? macBySlot.get(slot.id) : undefined
  // Strongest RSSI first: the light in the installer's hand is usually the
  // loudest one the bridge hears — it belongs at the top of the picker.
  const unseatedHeard = heard
    .filter((f) => !seats[f.fixtureId])
    .sort((a, b) => (b.rssi || -999) - (a.rssi || -999))

  const seatIt = () => {
    if (!slot || !seatPick) return
    pinSeat(seatPick, slot.plan.x, slot.plan.y, slot.id)
    setSeatPick('')
    setSlotSel(null)
  }

  return (
    <div className="scene3d">
      <p className="stage-status mono small">
        {heard.length} heard · {unlocated} not yet located · {located.length} self-located ·{' '}
        {seatedTotal} seated{silentSeats.length > 0 ? ` (${silentSeats.length} silent)` : ''}
      </p>

      <Canvas
        camera={{ position: [40, 30, 60], fov: 45, near: 0.1, far: 5000 }}
        onPointerDown={(e) => {
          pointerDownAt.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerMissed={(e) => {
          // Browser 'click' fires even after a long orbit drag; only a real
          // tap on empty space dismisses the selection.
          const d = pointerDownAt.current
          const moved = d ? Math.hypot(e.clientX - d.x, e.clientY - d.y) : 0
          if (moved < 8) {
            setSelected(null)
            setSlotSel(null)
          }
        }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[30, 50, 20]} intensity={0.8} />

        <DebugSceneHandle />
        <Suspense fallback={null}>
          <TreeModel />
          <ChandelierModel />
        </Suspense>

        {/* Rings only — no station markers: the pole structures are in the
            model itself, and extra spheres read as lights (Elliot). */}
        {rings && (
          <>
            <GroundRing r={rings.light} opacity={0.5} />
            <GroundRing r={rings.rope} opacity={0.25} />
          </>
        )}

        {/* assignable seats — SOCKETS, not lights: empty = hollow ring;
            occupied = no marker (the seated light itself renders). Worksite
            PL slots draw large on the open ring; fixture seats draw small
            (they sit dense in the canopy). Every seat is a tap target. */}
        {allSeats.map((s) => {
          const occupied = macBySlot.has(s.id)
          const big = s.kind === 'worksite'
          return (
            <group key={s.id} position={s.p}>
              {!occupied && (
                <mesh rotation-x={-Math.PI / 2}>
                  <torusGeometry args={[big ? 0.24 : 0.13, big ? 0.045 : 0.03, 8, 24]} />
                  <meshBasicMaterial
                    color={slotSel === s.id ? '#5b8cff' : '#7b8aa3'}
                    transparent
                    opacity={slotSel === s.id ? 1 : big ? 0.7 : 0.45}
                  />
                </mesh>
              )}
              <mesh
                onClick={(e) => {
                  e.stopPropagation()
                  if (e.delta > 8) return // orbit drag, not a tap
                  setSelected(null)
                  setSlotSel(s.id === slotSel ? null : s.id)
                }}
              >
                <sphereGeometry args={[big ? 0.9 : 0.45, 8, 8]} />
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
                <meshBasicMaterial
                  color={greenIds.has(n.id) ? '#38d97a' : selected === n.id ? '#5b8cff' : '#dbe4f0'}
                />
              </mesh>
              <mesh
                onClick={(e) => {
                  e.stopPropagation()
                  if (e.delta > 8) return // orbit drag, not a tap
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

        {/* seated-but-silent lights — the seat is a fact (a human hung it
            there); the quiet radio renders MUTED, never identical to live */}
        {silentSeats.map(([id, seat]) => {
          const h = seat.slot ? (zBySlot.get(seat.slot) ?? 0.6) : 0.6
          return (
            <group key={id} position={[seat.x, h, -seat.y]}>
              <mesh>
                <sphereGeometry args={[0.32, 14, 14]} />
                <meshBasicMaterial
                  color={selected === id ? '#5b8cff' : '#55617a'}
                  transparent
                  opacity={0.45}
                />
              </mesh>
              <mesh
                onClick={(e) => {
                  e.stopPropagation()
                  if (e.delta > 8) return // orbit drag, not a tap
                  setSlotSel(null)
                  setSelected(id === selected ? null : id)
                }}
              >
                <sphereGeometry args={[0.8, 8, 8]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            </group>
          )
        })}

        <OrbitControls
          ref={controls}
          makeDefault
          enableDamping
          minDistance={2}
          maxDistance={160}
          maxPolarAngle={Math.PI * 0.495}
        />
      </Canvas>

      <div className="nav-cluster" role="group" aria-label="Navigator">
        <button aria-label="Reset view" onClick={() => controls.current?.reset()}>⌂</button>
      </div>

      {slot && (
        <div className="light-card">
          <div className="light-card-head">
            <span className="mono">{slot.id}</span>
            <span className="muted small">
              {slot.kind === 'worksite'
                ? `station ${slot.station} · ${slot.id.endsWith('A') ? 'CCW' : 'CW'} pole side`
                : `${slot.station} seat`}
            </span>
          </div>
          {slotMac ? (
            <>
              <p className="muted small">
                Seated: <span className="mono">{slotMac}</span>
                {!heardIds.has(slotMac) ? ' · silent' : ''}
              </p>
              <div className="row-gap">
                {heardIds.has(slotMac) && (
                  <button
                    className="btn-line"
                    onClick={() => toggleTag(slotMac)}
                    title="Steady-green tag this light in the real world"
                  >
                    {activeTags[slotMac] ? 'Untag' : 'Tag'}
                  </button>
                )}
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
                  {unseatedHeard.map((f) => (
                    <option key={f.fixtureId} value={f.fixtureId}>
                      {f.fixtureId}
                      {f.rssi !== 0 ? ` · ${f.rssi} dBm` : ''}
                    </option>
                  ))}
                </select>
                <button
                  className="btn-line"
                  onClick={() => toggleTag(seatPick)}
                  disabled={!seatPick}
                  title="Steady-green tag the picked light so you can confirm it is the one in your hand"
                >
                  {seatPick && activeTags[seatPick] ? 'Untag' : 'Tag'}
                </button>
                <button className="btn-accent" onClick={seatIt} disabled={!seatPick}>
                  Seat
                </button>
              </div>
              <p className="muted small">{unseatedHeard.length} heard lights not yet seated · strongest first.</p>
              <div className="row-gap">
                <button className="btn-line" onClick={() => setSlotSel(null)}>Close</button>
              </div>
            </>
          )}
        </div>
      )}

      {selected && !slot && (sel || selSeat) && (
        <div className="light-card">
          <div className="light-card-head">
            <span className="mono">{selected}</span>
            <span className="muted small">
              {selSeat?.slot ? `seated at ${selSeat.slot}` : selSeat ? 'seated' : 'self-located'}
              {!heardIds.has(selected) ? ' · silent' : ''}
            </span>
          </div>
          <p className="muted small">
            {sel && sel.rssi !== 0 ? `${sel.rssi} dBm · ` : ''}
            {sel?.fwRev ?? '—'}
            {sel && !heardIds.has(selected) ? ` · last heard ${fmtAge(sel.lastHeardMs)} ago` : ''}
          </p>
          <div className="row-gap">
            {heardIds.has(selected) && (
              <button
                className="btn-line"
                onClick={() => toggleTag(selected)}
                title="Steady-green tag this light in the real world"
              >
                {activeTags[selected] ? 'Untag' : 'Tag'}
              </button>
            )}
            {(selSeat || selNode?.pinned) && (
              <button
                className="btn-line"
                onClick={() => {
                  unpinSeat(selected)
                  setSelected(null) // the unseated light loses its position — nothing to point at
                }}
              >
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
useGLTF.preload('/chandelier.glb')
