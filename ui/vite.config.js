// Builds the page into ../public, which the package ships and bin/server.js serves.
//
// XEPLR_UI_MONITOR_SRC=<path to xeplr-ui-monitor/src/index.js> builds from a
// local checkout instead of the installed package — to try a change to both
// before either is released. React is deduped so the checkout's copy is not used.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const local = process.env.XEPLR_UI_MONITOR_SRC
export default defineConfig({
  root: path.resolve(import.meta.dirname),
  base: './',
  plugins: [react()],
  resolve: {
    alias: local ? { '@xeplr/ui-monitor': path.resolve(local) } : {},
    dedupe: ['react', 'react-dom']
  },
  build: { outDir: path.resolve(import.meta.dirname, '../public'), emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:' + (process.env.MONITOR_PORT || 19400) } }
})
