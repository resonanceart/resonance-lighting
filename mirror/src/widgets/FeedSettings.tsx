import { useState } from 'react'
import type { WidgetDataProps } from '../lib/types'
import { useMirror } from '../lib/store'

/** Where the Mirror listens. Default is the same-origin /bench proxy to a
 *  running net_bench_dashboard.py; change it to reach a remote bench. */
export function FeedSettings({ telemetry }: WidgetDataProps) {
  const dataSource = useMirror((s) => s.dataSource)
  const setDataSource = useMirror((s) => s.setDataSource)
  const [url, setUrl] = useState(dataSource.url)

  return (
    <div className="feed-settings">
      <div className="source-live">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/bench" aria-label="Feed URL" />
        <button className="btn-line" onClick={() => setDataSource({ url })}>
          Apply
        </button>
      </div>
      <p className="muted small">
        Listening at <span className="mono">{dataSource.url}</span> · {telemetry.fixtures.length} lights heard. The
        Mirror is a read-only consumer of the bench dashboard — real data only, no processes of its own.
      </p>
    </div>
  )
}
