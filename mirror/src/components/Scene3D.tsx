import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Box3, Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { solveTick, STAGE_POST, STAGE_MAX_R_M, type SolvedNode } from '../lib/locate'
import { useMirror } from '../lib/store'
import type { Telemetry } from '../lib/types'

/**
 * The 3-D stage — THE SAME ORBIT as the original controller, adopted
 * verbatim: Canvas camera [40, 30, 60] fov 45 near 0.1 far 5000, drei
 * OrbitControls makeDefault + enableDamping (App.tsx:95 / Scene.tsx:291 in
 * the twin). Drag to orbit, right-drag/two-finger to pan, wheel/pinch to
 * zoom — identical feel.
 *
 * Coordinates: designed data is Blender Z-up metres; three.js is Y-up. The
 * twin's conversion is [x, z, -y] and we use exactly that. Lights render as
 * neutral dots; the staging field's radius-is-real/bearing-is-layout honesty
 * is unchanged from the plan view.
 */

const BLENDER_TO_THREE = ([x, y, z]: number[]): [number, number, number] => [x, z, -y]

function TreeModel() {
  const { scene } = useGLTF('/tree-context.glb')
  // The twin's staleUnitsScale guard: a stray pre-rescale 10x GLB gets
  // scaled down instead of dwarfing the site.
  const scale = useMemo(() => {
    const size = new Box3().setFromObject(scene).getSize(new Vector3())
    return Math.max(size.x, size.y, size.z) > 30 ? 0.1 : 1
  }, [scene])
  return <primitive object={scene} scale={scale} />
}

function GroundRing({ r, color, opacity, dashed }: { r: number; color: string; opacity: number; dashed?: boolean }) {
  // Flat ring on the ground plane. (Dashed look approximated with segments
  // is not worth the complexity — opacity carries the hierarchy.)
  void dashed
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
      <ringGeometry args={[r - 0.06, r + 0.06, 160]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} />
    </mesh>
  )
}

interface SlotRec {
  id: string
  p: [number, number, number]
  stale: boolean
}

export function Scene3D({ telemetry }: { telemetry: Telemetry }) {
  const seats = useMirror((s) => s.seats)
  const unpinSeat = useMirror((s) => s.unpinSeat)
  const send = useMirror((s) => s.send)

  const [nodes, setNodes] = useState<SolvedNode[]>([])
  const [slots, setSlots] = useState<SlotRec[]>([])
  const [stations, setStations] = useState<[number, number, number][]>([])
  const [rings, setRings] = useState<{ light: number; rope: number } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const controls = useRef<OrbitControlsImpl>(null)
  const latest = useRef(telemetry)
  latest.current = telemetry

  useEffect(() => {
    fetch('/fixtures.json')
      .then((r) => r.json())
      .then((j: { fixtures: { fixture_id: string; role: string; position: number[] }[] }) => {
        setSlots(
          j.fixtures.map((f) => ({
            id: f.fixture_id,
            p: BLENDER_TO_THREE(f.position),
            stale: f.role === 'perimeter',
          })),
        )
      })
      .catch(() => setSlots([]))
    fetch('/tree_footprint.json')
      .then((r) => r.json())
      .then(
        (j: {
          worksite_rings: { light_ring: { r_m: number; stations_az_deg: number[] }; rope: { r_m: number } }
        }) => {
          const lr = j.worksite_rings.light_ring
          setRings({ light: lr.r_m, rope: j.worksite_rings.rope.r_m })
          setStations(
            lr.stations_az_deg.map((az) => {
              const a = (az * Math.PI) / 180
              return [lr.r_m * Math.cos(a), 0.05, -lr.r_m * Math.sin(a)] as [number, number, number]
            }),
          )
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

  const placed = nodes.filter((n) => n.placed)
  const staging = nodes.filter((n) => !n.placed)
  const pinnedN = nodes.filter((n) => n.pinned)
  const sel = selected ? telemetry.fixtures.find((f) => f.fixtureId === selected) : undefined
  const selNode = selected ? nodes.find((n) => n.id === selected) : undefined

  return (
    <div className="scene3d">
      <p className="stage-status mono small">
        {telemetry.fixtures.length} heard · {placed.length} placed · {staging.length} staging · {pinnedN.length} fixed
      </p>

      <Canvas camera={{ position: [40, 30, 60], fov: 45, near: 0.1, far: 5000 }}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[30, 50, 20]} intensity={0.8} />

        <Suspense fallback={null}>
          <TreeModel />
        </Suspense>

        {rings && (
          <>
            <GroundRing r={rings.light} color="#7b8aa3" opacity={0.5} />
            <GroundRing r={rings.rope} color="#7b8aa3" opacity={0.25} />
            {stations.map((p, i) => (
              <mesh key={i} position={p}>
                <sphereGeometry args={[0.22, 12, 12]} />
                <meshBasicMaterial color="#7b8aa3" transparent opacity={0.7} />
              </mesh>
            ))}
          </>
        )}

        {/* designed slots at their true 3-D positions */}
        {slots.map((s) => (
          <mesh key={s.id} position={s.p}>
            <sphereGeometry args={[0.11, 10, 10]} />
            <meshBasicMaterial color={s.stale ? '#ff5b6e' : '#7b8aa3'} transparent opacity={s.stale ? 0.25 : 0.5} />
          </mesh>
        ))}

        {/* the staging field's listening post + outer range ring */}
        {staging.length > 0 && (
          <group position={[STAGE_POST.x, 0, -STAGE_POST.y]}>
            <mesh position={[0, 0.35, 0]}>
              <cylinderGeometry args={[0.12, 0.12, 0.7, 10]} />
              <meshBasicMaterial color="#7b8aa3" />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
              <ringGeometry args={[STAGE_MAX_R_M - 0.04, STAGE_MAX_R_M + 0.04, 96]} />
              <meshBasicMaterial color="#7b8aa3" transparent opacity={0.25} />
            </mesh>
          </group>
        )}

        {/* heard lights — neutral dots, world plan (x,y) → three (x, h, -y) */}
        {nodes.map((n) => (
          <mesh
            key={n.id}
            position={[n.x, n.placed ? 0.6 : 0.25, -n.y]}
            onClick={(e) => {
              e.stopPropagation()
              setSelected(n.id === selected ? null : n.id)
            }}
          >
            <sphereGeometry args={[n.placed ? 0.32 : 0.24, 14, 14]} />
            <meshBasicMaterial
              color={selected === n.id ? '#5b8cff' : n.placed ? '#dbe4f0' : '#7b8aa3'}
            />
          </mesh>
        ))}

        <OrbitControls ref={controls} makeDefault enableDamping />
      </Canvas>

      <div className="nav-cluster" role="group" aria-label="Navigator">
        <button aria-label="Reset view" onClick={() => controls.current?.reset()}>⌂</button>
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
        </div>
      )}
    </div>
  )
}

useGLTF.preload('/tree-context.glb')
