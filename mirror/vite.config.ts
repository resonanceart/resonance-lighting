import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Stamped once when the dev server / build starts — the UpdateChip compares
// this against the branch head on GitHub so the app always SHOWS whether it
// is running the most recent code (Elliot 08-17). No background processes:
// the check lives in the browser while the app is open.
let commit = 'unknown'
try {
  commit = execSync('git rev-parse --short=8 HEAD', { encoding: 'utf-8' }).trim()
} catch {
  /* no git (e.g. bare deploy) — the chip renders 'unknown' honestly */
}

// Port 4180 — network-tester's mirror lane. 5173 belongs to the live twin,
// 4173 to the QA preview; never collide with either.
//
// /bench proxies to net_bench_dashboard.py so the browser reads it
// same-origin (the stdlib server sends no CORS headers). Same pattern the
// twin app uses for /cambium — and it keeps the macOS firewall story simple.
//
// 8765 = Ben's REAL dashboard (canonical, default). BENCH_PORT=8766 points
// the proxy at dev/bench_stub.py (replay harness) instead — explicit opt-in
// only, so the stub can never be mistaken for the fleet.
const bench = {
  target: `http://127.0.0.1:${process.env.BENCH_PORT ?? '8765'}`,
  changeOrigin: true,
  rewrite: (p: string) => p.replace(/^\/bench/, ''),
}

// /station → lighting-architect's flash-station.py (watch-only commissioning
// dashboard; name per memo 27 §6). Same same-origin story as /bench — but
// GET-only: the station's POST surface is bench-local and unauthenticated
// (contract §5 / C3 finding), so the Mirror must never be a path to it.
const station = {
  target: 'http://127.0.0.1:8940',
  changeOrigin: true,
  rewrite: (p: string) => p.replace(/^\/station/, ''),
  bypass: (req: { method?: string }) => (req.method !== 'GET' ? '/' : undefined),
}

export default defineConfig({
  define: { __MIRROR_COMMIT__: JSON.stringify(commit) },
  plugins: [react()],
  server: { proxy: { '/bench': bench, '/station': station } },
  preview: { proxy: { '/bench': bench, '/station': station } },
})
