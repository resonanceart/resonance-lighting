import type { ComponentType } from 'react'
import type { ConfigField, Tier, WidgetDataProps } from './types'
import { StatTile } from '../widgets/StatTile'
import { FleetCensus } from '../widgets/FleetCensus'
import { RssiSignal } from '../widgets/RssiSignal'
import { BatteryGauge } from '../widgets/BatteryGauge'
import { ProgramTruth } from '../widgets/ProgramTruth'
import { FlashStation } from '../widgets/FlashStation'
import { BenDashboard } from '../widgets/BenDashboard'

/**
 * The widget registry — the Mirror's block registry.
 *
 * The palette starts BLANK and grows only by name (Elliot, 2026-08-16): every
 * entry below exists because Elliot asked for it. 2026-08-17: "bring Ben's
 * dashboard into the Mirror as the fleet screen" — the five dashboard widgets
 * (census, stat tiles, signal, battery, program truth) restored from git
 * history as that named adoption. Everything else stays in history until its
 * turn comes.
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

const DEFS: WidgetDef[] = [
  {
    type: 'stat-tile',
    title: 'Stat tile',
    icon: '▣',
    tier: 'READ',
    description: 'One number that matters, with label.',
    defaults: { span: 1, config: { metric: 'alive' } },
    configFields: [
      {
        key: 'metric',
        label: 'Metric',
        kind: 'select',
        options: [
          { value: 'alive', label: 'Lights heard (in window)' },
          { value: 'stale', label: 'Stale (unheard past window)' },
        ],
      },
    ],
    component: StatTile,
  },
  {
    type: 'fleet-census',
    title: 'Fleet census',
    icon: '≡',
    tier: 'READ',
    description: 'Every light actually heard, with last-heard honesty windows.',
    defaults: { span: 2, config: { cls: 'all' } },
    configFields: [],
    component: FleetCensus,
  },
  {
    type: 'rssi-signal',
    title: 'Signal strength',
    icon: '📶',
    tier: 'READ',
    description: 'Bars per light, worst first; honest empty on text-mode feeds.',
    defaults: { span: 2, config: { worstFirst: true } },
    configFields: [{ key: 'worstFirst', label: 'Worst signal first', kind: 'toggle' }],
    component: RssiSignal,
  },
  {
    type: 'battery-gauge',
    title: 'Battery health',
    icon: '🔋',
    tier: 'READ',
    description: 'mV · mA · SoC rows; soc=255 renders “—”, never 0; charging = negative mA.',
    defaults: { span: 2, config: { sort: 'soc' } },
    configFields: [
      {
        key: 'sort',
        label: 'Sort by',
        kind: 'select',
        options: [
          { value: 'soc', label: 'State of charge' },
          { value: 'mv', label: 'Voltage' },
        ],
      },
    ],
    component: BatteryGauge,
  },
  {
    type: 'ben-dashboard',
    title: "Ben's bench (embedded)",
    icon: '🖥',
    tier: 'READ',
    description:
      "Ben's dashboard page itself, framed live — a window onto his UI, not a Mirror send surface. His command buttons are REAL; the caption says so.",
    defaults: { span: 2, config: {} },
    configFields: [],
    component: BenDashboard,
  },
  {
    type: 'flash-station',
    title: 'Flash station',
    icon: '⚡',
    tier: 'READ',
    description: 'Bench commissioning mirror — port cards, verdicts, post-PASS hold. Watch-only.',
    defaults: { span: 2, config: {} },
    configFields: [],
    component: FlashStation,
  },
  {
    type: 'program-truth',
    title: 'Program truth',
    icon: '🎚',
    tier: 'READ',
    description: 'Fleet distribution bar with its own staleness caveat.',
    defaults: { span: 2, config: {} },
    configFields: [],
    component: ProgramTruth,
  },
]

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
