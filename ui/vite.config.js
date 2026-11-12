// Builds the page into ../public, which the package ships and bin/server.js serves.
//
// XEPLR_UI_MONITOR_SRC=<path to xeplr-ui-monitor/src/index.js> builds from a
// local checkout instead of the installed package — to try a change to both
// before either is released. The checkout's own imports (@xeplr/ui-utils,
// @xeplr/ui-table, react-router-dom) resolve from its node_modules; React is
// deduped so only one copy runs.
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
