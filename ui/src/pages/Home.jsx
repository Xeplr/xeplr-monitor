// The server itself: memory in GB, CPU, disks and uptime — @xeplr/ui-monitor's
// ServerPage, on this app's API and sign-in. The page you land on.
import { ServerPage } from '@xeplr/ui-monitor'
import { monitor } from '../api/monitor.js'

export default function Home() {
  return <ServerPage api={monitor} />
}
