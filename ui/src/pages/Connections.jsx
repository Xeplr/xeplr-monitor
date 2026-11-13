// The logins the backup jobs use — database servers and the S3 bucket —
// @xeplr/ui-monitor's ConnectionsPage, on this app's API and sign-in.
// Passwords and keys go in and never come back.
import { ConnectionsPage } from '@xeplr/ui-monitor'
import { monitor } from '../api/monitor.js'

export default function Connections() {
  return <ConnectionsPage api={monitor} />
}
