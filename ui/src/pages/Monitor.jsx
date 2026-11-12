// The server's services: how each is doing, start / stop / restart / kill, and
// their logs live — @xeplr/ui-monitor's page, on this app's API and sign-in.
// Who may see, control or change what is the roles' (migrations-auth/0006).
import { MonitorPage } from '@xeplr/ui-monitor'
import { monitor } from '../api/monitor.js'

export default function Monitor() {
  return <MonitorPage api={monitor} />
}
