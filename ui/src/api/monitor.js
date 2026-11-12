// The monitor is at /api/monitor — this app's own API (api/routes/monitor.js).
// authFetch and authEventStream carry the same sign-in as every other call.
import { authFetch, authEventStream } from '@xeplr/ui-account'
import { createMonitorApi } from '@xeplr/ui-monitor'

export const monitor = createMonitorApi({ fetch: authFetch, stream: authEventStream, base: '/api/monitor' })
