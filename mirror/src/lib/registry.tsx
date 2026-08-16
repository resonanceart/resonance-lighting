import type { ComponentType } from 'react'
import type { ConfigField, Tier, WidgetDataProps } from './types'
import { StatTile } from '../widgets/StatTile'
import { StateChips } from '../widgets/StateChips'
import { HoldCountdown } from '../widgets/HoldCountdown'
import { FleetCensus } from '../widgets/FleetCensus'
import { BatteryGauge } from '../widgets/BatteryGauge'
import { IdentifyButton } from '../widgets/IdentifyButton'

/**
 * The widget registry — the Mirror's equivalent of the Network builder's
 * block registry. A widget registers once here and is immediately available
 * in the edit-mode palette; pages reference it by `type` string only.
 *
 * v1 fence: only READ and BLINK tier widgets may register. Registering a
 * CONFIG/OPS widget is a build-time error by construction (see assert below),
 * matching the inventory's build-nothing-new line.
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
    description: 'One number that matters, with label. Pick the metric.',
    defaults: { span: 1, config: { metric: 'alive' } },
    configFields: [
      {
        key: 'metric',
        label: 'Metric',
        kind: 'select',
        options: [
          { value: 'alive', label: 'Fixtures alive (in window)' },
          { value: 'avgSoc', label: 'Average SoC (gauged only)' },
          { value: 'charging', label: 'Charging now' },
          { value: 'lowSoc', label: 'Low battery (<40%)' },
          { value: 'stale', label: 'Stale (>60 s unheard)' },
        ],
      },
    ],
    component: StatTile,
  },
  {
    type: 'state-chips',
    title: 'State-chip cards',
    icon: '🎛',
    tier: 'READ',
    description: 'Flash Station pattern: per-device CONNECTED / PASS / FAIL / UNPLUGGED cards.',
    defaults: { span: 2, config: { showPort: true } },
    configFields: [{ key: 'showPort', label: 'Show USB port', kind: 'toggle' }],
    component: StateChips,
  },
  {
    type: 'hold-countdown',
    title: 'Hold countdown',
    icon: '⏱',
    tier: 'READ',
    description: 'Flash Station pattern: post-PASS hold timers (do not unplug yet).',
    defaults: { span: 2, config: { holdS: 90 } },
    configFields: [{ key: 'holdS', label: 'Hold seconds', kind: 'number', min: 10, max: 300 }],
    component: HoldCountdown,
  },
  {
    type: 'fleet-census',
    title: 'Fleet census',
    icon: '≡',
    tier: 'READ',
    description: 'Every living light with last-heard honesty windows. Counts always cite the window.',
    defaults: { span: 2, config: { cls: 'all' } },
    configFields: [
      {
        key: 'cls',
        label: 'Class filter',
        kind: 'select',
        options: [
          { value: 'all', label: 'All classes' },
          { value: 'downlight', label: 'Downlights' },
          { value: 'perimeter', label: 'Perimeter' },
          { value: 'chandelier', label: 'Chandelier' },
          { value: 'trunk', label: 'Trunk / uplight' },
        ],
      },
    ],
    component: FleetCensus,
  },
  {
    type: 'battery-gauge',
    title: 'Battery health',
    icon: '🔋',
    tier: 'READ',
    description: 'mV / mA / SoC per light. soc=255 renders as — (no gauge), never 0.',
    defaults: { span: 2, config: { sort: 'soc' } },
    configFields: [
      {
        key: 'sort',
        label: 'Sort by',
        kind: 'select',
        options: [
          { value: 'soc', label: 'SoC (worst first)' },
          { value: 'mv', label: 'Voltage (lowest first)' },
        ],
      },
    ],
    component: BatteryGauge,
  },
  {
    type: 'identify',
    title: 'Identify blink',
    icon: '📍',
    tier: 'BLINK',
    description: 'The one sendable verb in v1: NB_IDENTIFY, per-fixture or all. Benign, self-expiring.',
    defaults: { span: 2, config: {} },
    configFields: [],
    component: IdentifyButton,
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
