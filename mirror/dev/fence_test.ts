/**
 * Fence + capability-gate regression (M5, LX spec 1d84f934 · Elliot directive
 * 2026-08-20). Run: `npx tsx dev/fence_test.ts` from mirror/. Headless, no
 * browser, NO RADIO: fetch is stubbed before the store loads, so even an
 * allowlisted emission lands in `posts`, never on the wire.
 *
 * Pins two hazard classes the fence must refuse forever:
 *   - Q<hours> — HTTP-ACCEPTED rails-off multi-day sleep (contract §1)
 *   - bare S / B<sec> — confirm-free fleet sleep verbs on Ben's own page
 * and the capability truth table backing the Bridge-OS banner's "flips
 * capable on reflash with zero code changes" claim.
 */

// Shims FIRST — store.ts touches localStorage at module scope, send() calls fetch.
const posts: { url: string; body: string }[] = []
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}
;(globalThis as Record<string, unknown>).fetch = async (url: unknown, init?: { body?: string }) => {
  posts.push({ url: String(url), body: init?.body ?? '' })
  return { json: async () => ({ ok: true }) }
}

let failures = 0
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

const { tagCapable, darkCapable, locateCapable, surveyCapable, sleepAware } = await import('../src/lib/adapter')
const { useMirror } = await import('../src/lib/store')

// ── capability truth table (contract §1 @ bc815a2a) ─────────────────────
const FW = {
  v151: 'cores3-bridge-2026-08-15.1',
  v161: 'cores3-bridge-2026-08-16.1',
  v171: 'cores3-bridge-2026-08-17.1',
  v172: 'cores3-bridge-2026-08-17.2',
  v1710: 'cores3-bridge-2026-08-17.10', // '.10' must not sort before '.2'
}
const TABLE: [string, (fw: string | null) => boolean, string | null, boolean][] = [
  ['tag', tagCapable, FW.v151, false],
  ['tag', tagCapable, FW.v161, false], // contract moved tag off the 08-16.1 lore pin
  ['tag', tagCapable, FW.v171, true],
  ['tag', tagCapable, FW.v172, true],
  ['tag', tagCapable, null, false],
  ['dark', darkCapable, FW.v151, false],
  ['dark', darkCapable, FW.v171, true],
  ['dark', darkCapable, null, false],
  ['locate', locateCapable, FW.v151, false],
  ['locate', locateCapable, FW.v171, true],
  ['locate', locateCapable, null, false],
  ['survey', surveyCapable, FW.v171, false], // L lands in .2, not .1
  ['survey', surveyCapable, FW.v172, true],
  ['survey', surveyCapable, FW.v1710, true],
  ['survey', surveyCapable, null, false],
  ['sleep', sleepAware, FW.v171, false],
  ['sleep', sleepAware, FW.v172, true],
  ['sleep', sleepAware, FW.v1710, true],
  ['sleep', sleepAware, null, false],
]
for (const [name, fn, fw, want] of TABLE) {
  check(`${name}(${fw ?? 'null'})`, fn(fw), want)
}

// ── the command fence: pinned hazards throw and never reach the wire ────
const send = useMirror.getState().send as (c: unknown) => void
for (const verb of ['Q', 'S', 'B', 'L', 'STRIKE', 'DARK']) {
  let threw = false
  try {
    send({ verb, target: 'ABC123' })
  } catch {
    threw = true
  }
  check(`fence throws on verb '${verb}'`, threw, true)
}
check('hazard attempts reached the wire 0 times', posts.length, 0)

// TAG while incapable (boot state: bridge fw unknown) — refused, audited, no wire
send({ verb: 'TAG', target: 'ABC123', on: true })
check('TAG pre-capability: zero posts', posts.length, 0)
check('TAG refusal audited in commandLog', useMirror.getState().commandLog[0]?.refused, true)

// NB_IDENTIFY is allowlisted — exactly one (stubbed) post, exact wire shape
send({ verb: 'NB_IDENTIFY', target: 'abc123' })
check('identify emits exactly once', posts.length, 1)
check('identify wire shape', (JSON.parse(posts[0].body) as { cmd: string }).cmd, 'iABC123')

// ── LOCATE (M3, BLD): capability gate + wire shape + clamps ─────────────
const lastCmd = () => (JSON.parse(posts[posts.length - 1].body) as { cmd: string }).cmd
// boot state: locateCapable=false → refused, audited, no wire
send({ verb: 'LOCATE', target: 'abc123', seconds: 5 })
check('LOCATE pre-capability: zero new posts', posts.length, 1)
check('LOCATE refusal audited in commandLog', useMirror.getState().commandLog[0]?.refused, true)
// capable → exact wire, uppercased, seconds clamped to the contract's 1-255
useMirror.setState({ locateCapable: true, locateRefusalReason: null })
send({ verb: 'LOCATE', target: 'abc123', seconds: 5 })
check('LOCATE wire shape', lastCmd(), 'iABC123:5')
send({ verb: 'LOCATE', target: 'abc123', seconds: 9999 })
check('LOCATE seconds clamp high (255)', lastCmd(), 'iABC123:255')
send({ verb: 'LOCATE', target: 'abc123', seconds: 0 })
check('LOCATE seconds clamp low (1)', lastCmd(), 'iABC123:1')
check('LOCATE never emits bare identify by accident', lastCmd().includes(':'), true)

// ── adapter mapping pins (8d0b20ca power_tier · 157df36a replay) ────────
// power_tier is telemetry-AUTHORITATIVE (LX 442d8786): absent must map to
// null (renders '—'), NEVER 0/full. replay: the confession must survive the
// adapter — a stub-fed window was misread as live once (2026-08-20).
const { mapState } = await import('../src/lib/adapter')
const mkPeer = (extra: Record<string, unknown>) => ({
  peers: { ABC123: { battery_v: 3.2, age_ms: 100, ...extra } },
  serial: { connected: true },
  master: {},
})
check('power_tier 3 maps through', mapState(mkPeer({ power_tier: 3 })).fixtures[0].powerTier, 3)
check('power_tier 0 maps through (0 ≠ null)', mapState(mkPeer({ power_tier: 0 })).fixtures[0].powerTier, 0)
check('power_tier absent → null, never 0', mapState(mkPeer({})).fixtures[0].powerTier, null)
check(
  'replay confession maps through',
  mapState({ ...mkPeer({}), replay: { stub: true, capture: 'cap.json', capture_ts_utc: '2026-08-17T23:20:33Z' } }).replay,
  { capture: 'cap.json', captureTsUtc: '2026-08-17T23:20:33Z' },
)
check('no replay field → null (real dashboard)', mapState(mkPeer({})).replay, null)
check('replay without stub:true → null', mapState({ ...mkPeer({}), replay: { capture: 'x' } }).replay, null)

console.log(failures ? `\n${failures} FAILURE(S)` : '\nfence + capability gates: ALL GREEN')
process.exit(failures ? 1 : 0)
