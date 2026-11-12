// FLOWS — the side-rail page: the journeys people can start, one click each.
//
// Always in the rail. Flows are run by @xeplr/workflow inside this app's own
// API, so they are simply there. Designing them is Configure UI → Flows.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccess } from '@xeplr/ui-account'
import { flows } from '../api/flows.js'
import { NotConnected, flowsOffline } from './Flows.jsx'

export default function FlowsHome() {
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const [offline, setOffline] = useState(null)
  const navigate = useNavigate()
  const { access } = useAccess()
  // Whoever may open Configure UI may design flows and connect Workflow.
  const admin = ((access && access.menus) || []).includes('Configure UI')

  useEffect(() => {
    flows.listFlows().then(setList, (e) => {
      const off = flowsOffline(e)
      if (off) setOffline(off)
      else setError(e.message)
    })
  }, [])

  const published = (list || []).filter((f) => f.status === 'published')

  return (
    <div className="app-page">
      <h1>Flows</h1>
      <p className="app-page-lead">
        Forms one after another — what you fill in on one decides which comes next. A journey you
        leave is kept, and picks up where it stopped.
      </p>
      {offline && <NotConnected offline={offline} />}
      {error && <div className="app-error">{error}</div>}
      {list && published.length === 0 && (
        <p className="app-sub">
          No flows to start yet.{admin && <> <Link to="/configure?tab=flows">Design one</Link> in Configure UI.</>}
        </p>
      )}
      {published.length > 0 && (
        <table className="app-table">
          <thead><tr><th>Flow</th><th>Screens</th><th /></tr></thead>
          <tbody>
            {published.map((f) => (
              <tr key={f.key}>
                <td><strong>{f.name}</strong></td>
                <td>{typeof f.steps === 'number' ? f.steps : (f.steps || []).length}</td>
                <td className="app-row-actions">
                  <button type="button" className="app-btn" onClick={() => navigate(`/journey/${f.key}`)}>Start</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {admin && list && published.length > 0 && (
        <p className="app-sub" style={{ marginTop: 16 }}><Link to="/configure?tab=flows">Design flows</Link> in Configure UI.</p>
      )}
    </div>
  )
}
