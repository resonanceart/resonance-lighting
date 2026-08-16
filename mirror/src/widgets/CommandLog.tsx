import type { WidgetDataProps } from '../lib/types'
import { useMirror } from '../lib/store'

/** The fence's audit trail: every command that passed the allowlist, newest
 *  first. Empty is the healthy default — the Mirror mostly listens. */
export function CommandLog(_props: WidgetDataProps) {
  const log = useMirror((s) => s.commandLog)
  if (!log.length) return <p className="empty">No commands emitted this session. (Good — the Mirror listens.)</p>
  return (
    <ul className="cmd-log">
      {log.map((e) => (
        <li key={e.at}>
          <span className="mono small muted">{new Date(e.at).toLocaleTimeString()}</span>{' '}
          <span className="mono">{e.cmd.verb}</span> → <span className="mono">{e.cmd.target}</span>
        </li>
      ))}
    </ul>
  )
}
