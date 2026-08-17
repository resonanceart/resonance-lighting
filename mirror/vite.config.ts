import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/bench': bench } },
  preview: { proxy: { '/bench': bench } },
})
