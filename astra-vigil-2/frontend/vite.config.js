import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The production build goes straight into the Python package so `python run.py`
// serves everything from one place, offline.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../backend/astra/static',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
})
