// CONFIGURE UI → FLOWS — every journey across the app's forms.
//
// A flow is what someone is walked through: screens one after another. For
// each screen it says what runs around its records (its events — this app's
// functions, picked by name) and where the journey goes once it is saved: a
// screen, a function that decides, or the end. @xeplr/workflow-api runs it,
// inside this app's API, so a journey can be left and picked up later.
//
// A flow is addressed by a key made from its name — /configure/flows/<key> to
// design it, /journey/<key> to walk it.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { flowKey } from '@xeplr/ui-factory'
import { flows } from '../api/flows.js'

export default function Flows() {
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const [offline, setOffline] = useState(null)   // API_NOT_RESTARTED
  const [name, setName] = useState('')
  const navigate = useNavigate()

  const load = () => flows.listFlows().then(setList, (e) => {
    const off = flowsOffline(e)
    if (off) setOffline(off)
    else setError(e.message)
  })
  useEffect(() => { load() }, [])

  const create = async (e) => {
    e.preventDefault()
    const label = name.trim()
    if (!label) return
    try {
      // No steps yet: the designer is where those come from, and it opens on
      // the flow this creates. `key` is what every link to it uses from here on.
      const made = await flows.createFlow({ key: flowKey(label), name: label })
      navigate(`/configure/flows/${made.key}`)
    } catch (err) {
      setError(err.message)
    }
  }

  if (offline) return <NotConnected offline={offline} />

  return (
    <div className="app-forms">
      <p className="app-page-lead">
        A flow is your forms, one after another. For each one, pick what runs around its records and
        where the journey goes next — a screen, one of the app’s functions, or the end.
      </p>
      {error && <div className="app-error">{error}</div>}

      <form className="app-forms-new" onSubmit={create}>
        <label className="app-forms-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Employee registration" />
        </label>
        <button type="submit" className="app-btn" disabled={!name.trim()}>New flow</button>
      </form>

      {list && list.length === 0 && <p className="app-sub">No flows yet.</p>}
      {list && list.length > 0 && (
        <table className="app-table">
          <thead><tr><th>Flow</th><th>Key</th><th>Status</th><th>Screens</th><th /></tr></thead>
          <tbody>
            {list.map((f) => (
              <tr key={f.key}>
                <td><strong>{f.name}</strong></td>
                <td className="app-sub">{f.key}</td>
                <td>{f.status}</td>
                <td>{typeof f.steps === 'number' ? f.steps : (f.steps || []).length}</td>
                <td className="app-row-actions">
                  <Link to={`/configure/flows/${f.key}`}>Design</Link>
                  {f.status === 'published' && <Link to={`/journey/${f.key}`}>Open</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * Why flows cannot run right now, or null when the error is something else.
 * Workflow runs inside this app's API, so there is one such case: an API
 * started before flows existed (404 on /api/workflow) — restart it.
 */
export function flowsOffline(err) {
  if (err && err.status === 404) return { code: 'API_NOT_RESTARTED', message: 'This app\'s API does not have the flows route yet.' }
  return null
}

/** Flows before the API has been restarted with them. */
export function NotConnected({ offline }) {
  return (
    <div className="app-forms">
      <div className="app-connect">
        <h2>Restart the API to use flows</h2>
        <p>{offline.message} It was started before flows were added — restart it, then reload this page.</p>
      </div>
    </div>
  )
}
