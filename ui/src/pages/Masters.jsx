// CONFIGURE UI → MASTERS — the lists the rest of the app points at.
//
// Departments, statuses, countries, categories: small tables that other forms
// choose from. They are ordinary forms with a flag (Design → This is a
// master), so they have a table, a list, an edit screen and permissions like
// anything else — a master is a fact about a form, not a kind of form.
//
// They are gathered HERE rather than scattered through the side rail because
// that is what they are: reference data somebody maintains occasionally, not
// pages people work in daily. The rail stays for the work.
//
// Which forms are masters is @xeplr/ui-factory's answer (`useScreenSource`),
// not this app's — grouping two screens into a form and reading the flag is
// the same code in every app, and a copy here could never be fixed centrally.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useScreenSource, createMaster, possibleParents, FactoryBuilder } from '@xeplr/ui-factory'
import { factory } from '../api/factory.js'

export default function Masters() {
  const { masters, loading, reload } = useScreenSource(factory, { Builder: FactoryBuilder })
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // MADE, NOT DESIGNED. A master is a name, an order and what it belongs to —
  // the same three things every time — so it is created outright and the
  // builder is for the day one needs a fourth field.
  const create = async (e) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const owner = masters.find((m) => m.key === parent)
      await createMaster(factory, {
        name: name.trim(),
        parent: owner ? { table: owner.source, label: owner.name } : null
      })
      setName('')
      setParent('')
      setError(null)
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="app-sub">Loading…</p>

  return (
    <div className="app-forms">
      <p className="app-page-lead">
        The lists the rest of the app chooses from. A master is a name, an order of your own,
        and — when it belongs to one — the master above it.
      </p>

      {error && <div className="app-error">{error}</div>}

      <form className="app-forms-new" onSubmit={create}>
        <label className="app-forms-field">
          <span>New master</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Departments" />
        </label>
        {/* Only worth asking once there is something to belong to. */}
        {masters.length > 0 && (
          <label className="app-forms-field">
            <span>Belongs to</span>
            <select value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">— nothing —</option>
              {possibleParents(masters).map((m) => (
                <option key={m.key} value={m.key}>{m.name}</option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="app-btn" disabled={!name.trim() || busy}>
          {busy ? 'Making it…' : 'Make the master'}
        </button>
      </form>

      {masters.length === 0 && (
        <p className="app-sub">
          No masters yet. Departments, statuses, countries — anything other forms point at.
        </p>
      )}

      {masters.length > 0 && (
        <table className="app-table">
          <thead><tr><th>Master</th><th>Shown as</th><th>Table</th><th /></tr></thead>
          <tbody>
            {masters.map((m) => (
              <tr key={m.key}>
                <td><strong>{m.name}</strong></td>
                {/* What a picker shows for one of its records — said once on
                    the master, not again on every dropdown pointing at it. */}
                <td className="app-sub">{m.labelField || '—'}</td>
                <td className="app-sub">{m.source || '—'}</td>
                <td className="app-row-actions">
                  {/* Its records: the list screen is what looking at a master
                      means. Its design is where the flag was set. */}
                  <Link to={`/forms/${m.key}`}>Open</Link>
                  <Link to={`/configure/forms/${m.key}/design/form`}>Design</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
