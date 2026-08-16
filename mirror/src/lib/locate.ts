import type { Telemetry } from './types'

/**
 * The locate solver — the Mirror's copy-and-strip of the twin's selfmap idea:
 * heard lights place themselves in proportion to each other (pairwise RSSI →
 * distance springs) and to the fix points a human gives them (pinned seats are
 * immovable anchors). Pure incremental force relaxation; a few hundred ticks
 * converge and it runs happily at telemetry cadence.
 *
 * Honesty: a light with no pin and no usable neighbor links does NOT get a
 * guessed position — it goes to the staging halo at the edge until data or a
 * human places it.
 */

export interface SeatMap {
  /** Pinned fix point; `slot` present when snapped onto a designed slot
   *  (F000–F129) — this map IS the missing MAC↔slot binding, born here. */
  [id: string]: { x: number; y: number; slot?: string }
}

export interface SolvedNode {
  id: string
  x: number
  y: number
  pinned: boolean
  /** false = staging halo (no basis for a position yet) */
  placed: boolean
}

/** Log-distance path loss, tuned loose: -40 dBm ≈ 1 m, clamped to scene scale. */
export function rssiToMeters(rssi: number): number {
  return Math.min(SCENE_METERS, Math.max(0.5, Math.pow(10, (-40 - rssi) / 25)))
}

const SCENE_METERS = 14 // ~tree + perimeter ring diameter; normalizes to 0..1

interface P {
  x: number
  y: number
  vx: number
  vy: number
}

// Positions persist across ticks so the constellation drifts, never teleports.
const pos = new Map<string, P>()

function seeded(id: string, salt: number): number {
  let h = salt
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h % 1000) / 1000
}

export function solveTick(telemetry: Telemetry, seats: SeatMap): SolvedNode[] {
  const heard = telemetry.fixtures
  const ids = new Set(heard.map((f) => f.fixtureId))

  // Springs: only pairs where both ends are currently heard.
  const springs: { a: string; b: string; dNorm: number }[] = []
  for (const f of heard) {
    for (const n of f.neighbors ?? []) {
      if (ids.has(n.id) && f.fixtureId < n.id) {
        springs.push({ a: f.fixtureId, b: n.id, dNorm: rssiToMeters(n.rssi) / SCENE_METERS })
      }
    }
  }
  const linkCount = new Map<string, number>()
  for (const s of springs) {
    linkCount.set(s.a, (linkCount.get(s.a) ?? 0) + 1)
    linkCount.set(s.b, (linkCount.get(s.b) ?? 0) + 1)
  }

  // A node is placeable if pinned, or if it has ≥2 links into the placeable set
  // (transitively — anchors and well-linked nodes carry their neighbors).
  const placeable = new Set<string>()
  for (const f of heard) if (seats[f.fixtureId]) placeable.add(f.fixtureId)
  let grew = true
  while (grew) {
    grew = false
    for (const f of heard) {
      if (placeable.has(f.fixtureId)) continue
      const links = (f.neighbors ?? []).filter((n) => placeable.has(n.id) || ids.has(n.id)).length
      if ((linkCount.get(f.fixtureId) ?? 0) >= 2 && links >= 2) {
        placeable.add(f.fixtureId)
        grew = true
      }
    }
  }

  // Ensure solver state exists for every placeable node.
  for (const id of placeable) {
    if (!pos.has(id)) {
      pos.set(id, { x: 0.3 + 0.4 * seeded(id, 7), y: 0.3 + 0.4 * seeded(id, 13), vx: 0, vy: 0 })
    }
  }

  // Pinned seats override solver state hard.
  for (const [id, seat] of Object.entries(seats)) {
    const p = pos.get(id) ?? { x: seat.x, y: seat.y, vx: 0, vy: 0 }
    p.x = seat.x
    p.y = seat.y
    p.vx = 0
    p.vy = 0
    pos.set(id, p)
  }

  // Relax: springs toward target distance + gentle centering, damped.
  const STEPS = 10
  const K = 0.4
  const CENTER = 0.003
  const DAMP = 0.72
  for (let step = 0; step < STEPS; step++) {
    for (const s of springs) {
      if (!placeable.has(s.a) || !placeable.has(s.b)) continue
      const pa = pos.get(s.a)!
      const pb = pos.get(s.b)!
      const dx = pb.x - pa.x
      const dy = pb.y - pa.y
      const d = Math.max(0.001, Math.hypot(dx, dy))
      const f = K * (d - s.dNorm)
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      if (!seats[s.a]) {
        pa.vx += fx
        pa.vy += fy
      }
      if (!seats[s.b]) {
        pb.vx -= fx
        pb.vy -= fy
      }
    }
    // Short-range repulsion between placeable nodes keeps the constellation
    // from collapsing when only local neighbor springs exist (pre-anchor state).
    const list = [...placeable]
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const pa = pos.get(list[i])!
        const pb = pos.get(list[j])!
        const dx = pb.x - pa.x
        const dy = pb.y - pa.y
        const d = Math.max(0.005, Math.hypot(dx, dy))
        if (d < 0.09) {
          const f = 0.02 * (0.09 - d) / d
          if (!seats[list[i]]) {
            pa.vx -= dx * f
            pa.vy -= dy * f
          }
          if (!seats[list[j]]) {
            pb.vx += dx * f
            pb.vy += dy * f
          }
        }
      }
    }
    for (const id of placeable) {
      if (seats[id]) continue
      const p = pos.get(id)!
      p.vx += (0.5 - p.x) * CENTER
      p.vy += (0.5 - p.y) * CENTER
      p.vx *= DAMP
      p.vy *= DAMP
      p.x = Math.min(0.98, Math.max(0.02, p.x + p.vx * 0.5))
      p.y = Math.min(0.98, Math.max(0.02, p.y + p.vy * 0.5))
    }
  }

  // Emit: placeable nodes at solved positions; the rest wrap into staging
  // rows along the bottom edge (a real fleet can park 40+ lights there).
  const out: SolvedNode[] = []
  let halo = 0
  const PER_ROW = 12
  for (const f of heard) {
    const id = f.fixtureId
    if (placeable.has(id)) {
      const p = pos.get(id)!
      out.push({ id, x: p.x, y: p.y, pinned: Boolean(seats[id]), placed: true })
    } else {
      const col = halo % PER_ROW
      const row = Math.floor(halo / PER_ROW)
      out.push({ id, x: 0.08 + col * 0.076, y: 0.955 - row * 0.05, pinned: false, placed: false })
      halo++
    }
  }
  return out
}

/** Test hook: drop all solver momentum (used after layout import/reset). */
export function resetSolver(): void {
  pos.clear()
}
