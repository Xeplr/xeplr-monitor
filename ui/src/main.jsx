// The page @xeplr/monitor serves: @xeplr/ui-monitor's ready-made app, its API
// at ./api next to it (relative, so nginx can put the monitor under any path).
import { createRoot } from 'react-dom/client'
import { MonitorApp } from '@xeplr/ui-monitor'

createRoot(document.getElementById('root')).render(<MonitorApp base="api" />)
