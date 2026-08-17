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

export function BatteryGauge({ config, telemetry }: WidgetDataProps) {
  const sort = String(config.sort ?? 'soc')
  const rows = [...telemetry.fixtures].sort((a, b) =>
    sort === 'mv' ? a.battMv - b.battMv : (a.soc === 255 ? 101 : a.soc) - (b.soc === 255 ? 101 : b.soc),
  )
  return (
    <div className="scroll-x">
      <table className="data">
        <thead>
          <tr>
            <th>id</th>
            <th>mV</th>
            <th>mA</th>
            <th>SoC</th>
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
