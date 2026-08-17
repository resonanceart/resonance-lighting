import type { ComponentType } from 'react'
import type { ConfigField, Tier, WidgetDataProps } from './types'

/**
 * The widget registry — the Mirror's block registry.
 *
 * DELIBERATELY EMPTY (Elliot, 2026-08-16): every feature stays blank until it
 * is pulled in one at a time, by name, from Ben's tested surfaces or the
 * original controller. Nothing appears in the palette that Elliot has not
 * explicitly asked for. Prior widget implementations live in git history and
 * return as individual reviewed commits when their turn comes.
 *
 * The fence remains structural: only READ and BLINK tier widgets may ever
 * register (the assert below throws at module load otherwise).
 */

export interface WidgetDef {
  type: string
  title: string
  icon: string
  tier: Tier
  description: string
  defaults: { span: 1 | 2; config: Record<string, unknown> }
  configFields: ConfigField[]
  component: ComponentType<WidgetDataProps>
}

const ALLOWED_TIERS: Tier[] = ['READ', 'BLINK']

const DEFS: WidgetDef[] = []

for (const d of DEFS) {
  if (!ALLOWED_TIERS.includes(d.tier)) {
    throw new Error(`Widget '${d.type}' has tier ${d.tier} — outside the v1 fence (READ/BLINK only)`)
  }
}

const BY_TYPE = new Map(DEFS.map((d) => [d.type, d]))

export function getWidgetDef(type: string): WidgetDef | undefined {
  return BY_TYPE.get(type)
}

export function allWidgetDefs(): WidgetDef[] {
  return DEFS
}
