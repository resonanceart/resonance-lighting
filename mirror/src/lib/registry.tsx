import type { ComponentType } from 'react'
import type { ConfigField, Tier, WidgetDataProps } from './types'
import { StatTile } from '../widgets/StatTile'
import { FleetCensus } from '../widgets/FleetCensus'
import { IdentifyButton } from '../widgets/IdentifyButton'
import { CommandLog } from '../widgets/CommandLog'
import { FeedSettings } from '../widgets/FeedSettings'

/**
 * The widget registry — the Mirror's block registry. A widget registers once
 * here and is immediately available in the edit-mode palette.
 *
 * SCOPE RULE (Elliot, 2026-08-16): features are pulled in ONE AT A TIME from
 * Ben's dashboard only. The palette holds exactly what has been deliberately
 * adopted — nothing anticipatory. (Battery, program truth, RSSI grids, flash
 * station live in git history; each returns as its own reviewed commit when
 * its turn comes.)
 *
 * v1 fence: only READ and BLINK tier widgets may register — enforced by the
 * assert below, so the build-nothing-new line is structural.
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
          { value: 'stale', label: 'Stale (>60 s unheard)' },
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
    type: 'feed-settings',
    title: 'Feed settings',
    icon: '📡',
    tier: 'READ',
    description: 'Where the Mirror listens — the bench dashboard URL.',
    defaults: { span: 2, config: {} },
    configFields: [],
    component: FeedSettings,
  },
  {
    type: 'command-log',
    title: 'Command audit trail',
    icon: '📜',
    tier: 'READ',
    description: 'Every command that passed the fence, newest first. Empty = healthy.',
    defaults: { span: 2, config: {} },
    configFields: [],
    component: CommandLog,
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
