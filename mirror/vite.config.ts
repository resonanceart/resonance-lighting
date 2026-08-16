import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Port 4180 — network-tester's mirror lane. 5173 belongs to the live twin,
// 4173 to the QA preview; never collide with either.
//
// /bench proxies to net_bench_dashboard.py so the browser reads it
// same-origin (the stdlib server sends no CORS headers). Same pattern the
// twin app uses for /cambium — and it keeps the macOS firewall story simple.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/bench': { target: 'http://127.0.0.1:8765', changeOrigin: true, rewrite: (p) => p.replace(/^\/bench/, '') },
    },
  },
  preview: {
    proxy: {
      '/bench': { target: 'http://127.0.0.1:8765', changeOrigin: true, rewrite: (p) => p.replace(/^\/bench/, '') },
    },
  },
})
