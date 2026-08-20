import type { WidgetDataProps } from '../lib/types'

/** soc=255 (view sentinel; wire is -1 at the /api/state layer, contract §2)
 *  means the gauge gave no reading: render 'n/a', never -1% / 255% / 0. */
function socText(soc: number): string {
  return soc === 255 ? 'n/a' : `${soc}%`
}

function socClass(soc: number): string {
  if (soc === 255) return ''
  if (soc < 25) return 'danger-text'
  if (soc < 40) return 'warn-text'
  return 'ok-text'
}

/** LedTier labels verbatim from Ben's dashboard (net_bench_dashboard.py:964);
 *  tier is telemetry-AUTHORITATIVE (LX ruling 442d8786) — never derived here.
 *  Emphasis mirrors the dashboard's critical rule (:1095): tier ≥2 = the
 *  power veto is suppressing the show. null = not reported → '—'. */
const TIER_LABEL: Record<number, string> = { 0: 'full', 1: 'dim', 2: 'LEDs off', 3: 'protect' }
const TIER_TITLE =
  'power_tier from fixture telemetry (LedTier). ADR 0046 ladder (post-0046): dim 3.15 V · LEDs-off 3.10 V · protect 3.05 V, load-compensated'

function tierClass(tier: number | null): string {
  if (tier === null) return ''
  if (tier >= 2) return 'danger-text'
  if (tier === 1) return 'warn-text'
  return 'ok-text'
}

export function BatteryGauge({ config, telemetry }: WidgetDataProps) {
  const sort = String(config.sort ?? 'soc')
  const rows = [...telemetry.fixtures].sort((a, b) =>
    sort === 'mv' ? a.battMv - b.battMv : (a.soc === 255 ? 101 : a.soc) - (b.soc === 255 ? 101 : b.soc),
  )
  return (
    <div className="scroll-x">
      {/* Same ear-down caveat the census carries — an empty/stale table with
          no words reads as broken, not honest (feed-down audit 2026-08-20). */}
      {!telemetry.serialConnected && (
        <p className="warn-text">⚠ bridge ear down — last-seen data, nothing here is live</p>
      )}
      {telemetry.fixtures.length === 0 && <p>no fixture rows in this feed</p>}
      <table className="data">
        <thead>
          <tr>
            <th>id</th>
            <th>mV</th>
            <th>mA</th>
            <th>SoC</th>
            <th title={TIER_TITLE}>tier</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((f) => (
            <tr key={f.fixtureId}>
              <td className="mono">{f.fixtureId}</td>
              <td className="mono">{f.battMv}</td>
              <td className="mono">{f.battMa < 0 ? <span className="ok-text">{f.battMa} ⚡</span> : f.battMa}</td>
              <td className={socClass(f.soc)}>{socText(f.soc)}</td>
              <td className={tierClass(f.powerTier)} title={TIER_TITLE}>
                {f.powerTier === null ? '—' : (TIER_LABEL[f.powerTier] ?? `tier ${f.powerTier}`)}
              </td>
              <td className="gauge-cell">
                {f.soc !== 255 && (
                  <div className="gauge">
                    <div
                      className={`gauge-fill ${f.soc < 25 ? 'danger' : f.soc < 40 ? 'warn' : ''}`}
                      style={{ width: `${f.soc}%` }}
                    />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
