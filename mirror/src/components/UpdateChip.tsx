import { useEffect, useState } from 'react'

/**
 * "Are we running the most recent code?" — visible in the app, always
 * (Elliot 08-17). The browser itself asks GitHub for the branch head once an
 * hour while the tab is open; no background processes, no tokens (the repo is
 * public). Green ✓ = this build IS the branch head; amber = a newer commit
 * exists (pull qa/mirror-ui-lib + restart dev); muted = check unreachable.
 */

const REPO_API = 'https://api.github.com/repos/resonanceart/resonance-lighting/commits/qa%2Fmirror-ui-lib'
const HOUR_MS = 3_600_000

type Check = { state: 'checking' | 'current' | 'behind' | 'offline'; latest?: string }

export function UpdateChip() {
  const [check, setCheck] = useState<Check>({ state: 'checking' })

  useEffect(() => {
    let alive = true
    const run = () =>
      fetch(REPO_API, { headers: { Accept: 'application/vnd.github+json' } })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((j: { sha: string }) => {
          if (!alive) return
          const latest = j.sha.slice(0, 8)
          setCheck(latest.startsWith(__MIRROR_COMMIT__) || __MIRROR_COMMIT__.startsWith(latest)
            ? { state: 'current', latest }
            : { state: 'behind', latest })
        })
        .catch(() => alive && setCheck({ state: 'offline' }))
    run()
    const t = setInterval(run, HOUR_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  // Honesty (LX 484f1d0e ④): under `npm run dev`, hot-reload serves the LIVE
  // working tree while __MIRROR_COMMIT__ is only the SHA at server boot — the
  // "behind" arrow would claim you are NOT running code you visibly ARE. A
  // status chip must not be able to lie: in dev, label the SHA as the boot
  // commit and never render the pull-and-restart arrow.
  const dev = import.meta.env.DEV
  return (
    <span
      className={`source-chip mono small ${!dev && check.state === 'behind' ? 'warn-text' : ''}`}
      title={
        dev
          ? `Dev server: hot-reload serves the current working tree; ${__MIRROR_COMMIT__} is only the SHA when the server booted${check.latest ? ` (branch head: ${check.latest})` : ''}`
          : check.state === 'behind'
            ? `Newer code on qa/mirror-ui-lib (${check.latest}) — pull + restart to update`
            : 'Running code vs branch head on GitHub, checked hourly'
      }
    >
      {dev ? `boot ${__MIRROR_COMMIT__} · live tree` : __MIRROR_COMMIT__}
      {!dev && check.state === 'current' && ' ✓'}
      {!dev && check.state === 'behind' && ` → ${check.latest} available`}
      {check.state === 'offline' && ' · check offline'}
      {check.state === 'checking' && ' · checking…'}
    </span>
  )
}
