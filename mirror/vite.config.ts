import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Port 4180 — network-tester's mirror lane. 5173 belongs to the live twin,
// 4173 to the QA preview; never collide with either.
export default defineConfig({
  plugins: [react()],
})
