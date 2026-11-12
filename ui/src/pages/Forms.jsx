// FORMS — every UI in the app (Configure UI → Forms). Make one, design it,
// publish it, open it, add it to the side rail.
//
// A form is two screens: a LIST of its records, and the add / edit FORM the list
// opens in a popup. Its KEY (farming_department) names the screens and the table
// (farming_departments) and cannot change once published; its LABEL is what
// people see, renamed any time in its design.
//
// Claude can make forms too — see "Create a new UI" in CLAUDE.md.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listMenuItems, addMenuItem, removeMenuItem, useAccess, getUsers } from '@xeplr/ui-account'
import { deleteForm } from '@xeplr/ui-factory'
// THE APP'S OWN DIALOGS. window.confirm cannot say which button is the
// dangerous one and looks like a different piece of software appearing over
// this one; a red box pinned to the page stays there until something else
// replaces it, long after it has been read.
import { raiseConfirm, raiseSnackbar } from '@xeplr/ui-utils'
import { factory } from '../api/factory.js'
import { FORM_MENU_PREFIX } from '../menu.js'

/**
 * listScreens rows → one entry per form.
 *
 * `description` and `createdBy` travel with it because of the thing that
 * happens once more than a handful of people can make forms: three of them
 * are called "Inspection", and the fields say what each HOLDS, never what it
 * was for or whose it is. Deciding which to keep is otherwise guesswork.
 */
function groupForms(rows) {
  const byKey = new Map()
  rows.forEach((row) => {
    const m = /^(.*)_(list|edit)$/.exec(row.screenKey)
    const key = m ? m[1] : row.screenKey
    const entry = byKey.get(key) || {
      key, name: null, source: null, list: null, edit: null,
      description: null, createdBy: null, createdDate: null
    }
    if (m) entry[m[2]] = row
    else entry.edit = row
    if (m && m[2] === 'list') entry.name = row.name
    entry.name = entry.name || row.name
    entry.source = entry.source || row.source
    entry.description = entry.description || row.description
    // The form's own half is the one that speaks for it; a list screen is
    // only consulted when there is no other answer.
    if (m && m[2] === 'edit') { entry.createdBy = row.createdBy; entry.createdDate = row.createdDate }
    entry.createdBy = entry.createdBy || row.createdBy
    entry.createdDate = entry.createdDate || row.createdDate
    byKey.set(key, entry)
  })
  return [...byKey.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

/** "3 Feb 2026" — enough to tell two forms apart, no more. */
function madeOn(when) {
  if (!when) return null
  const d = new Date(when)
  return isNaN(d) ? null : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function state(screen) {
  if (!screen) return { label: '—', unpublished: false }
  if (screen.version === null) return { label: 'Not published yet', unpublished: true }
  return { label: 'v' + screen.version + (screen.hasDraft ? ' · unpublished changes' : ''), unpublished: screen.hasDraft }
}

/** "Farming departments" → "farming_department": a suggestion, editable. */
function suggestKey(label) {
  const words = String(label).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
  if (!words.length) return ''
  const last = words[words.length - 1]
  words[words.length - 1] = /ies$/.test(last) ? last.slice(0, -3) + 'y' : /(ss|us)$/.test(last) ? last : last.replace(/s$/, '')
  const key = words.join('_')
  return /^[a-z]/.test(key) ? key : 'form_' + key
}

export default function Forms() {
  const navigate = useNavigate()
  const { refreshAccess } = useAccess()
  const [forms, setForms] = useState(null)
  // WHO MADE EACH ONE. The screens table keeps the maker's id; the names live
  // in the sign-in service, so they are fetched once here and matched up.
  // Failing to get them is not an error worth showing — the date alone still
  // tells two forms of the same name apart.
  const [people, setPeople] = useState({})
  const [inMenu, setInMenu] = useState(new Set())
  const [label, setLabel] = useState('')
  const [key, setKey] = useState('')
  const [keyEdited, setKeyEdited] = useState(false)
  const [busy, setBusy] = useState(null)

  const load = useCallback(() => {
    factory.listScreens().then((rows) => setForms(groupForms(rows)), (e) => raiseSnackbar(e.message, { design: 'error' }))
    listMenuItems().then(
      (items) => setInMenu(new Set(items.filter((m) => m.name.startsWith(FORM_MENU_PREFIX) && !m.isHidden).map((m) => m.name.slice(FORM_MENU_PREFIX.length)))),
      () => {}
    )
  }, [])
  useEffect(load, [load])

  // Once. A name per row would be one request per form, and these change far
  // more slowly than the page is opened.
  useEffect(() => {
    let cancelled = false
    getUsers()
      .then((rows) => {
        if (cancelled) return
        const by = {}
        ;(rows || []).forEach((u) => { by[u.id] = u.name || u.email || u.id })
        setPeople(by)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const onLabel = (value) => {
    setLabel(value)
    if (!keyEdited) setKey(suggestKey(value))
  }

  const create = async (e) => {
    e.preventDefault()
    setBusy('new')
    try {
      const made = await factory.createEntity({ key: key.trim(), label: label.trim() })
      navigate('/configure/forms/' + made.key + '/design/form')
    } catch (err) {
      raiseSnackbar(err.message, { design: 'error' })
      setBusy(null)
    }
  }

  // The form first — publishing it creates or changes the table — then the list.
  /**
   * Delete a form. Asked first, in the words of what will actually happen
   * rather than "are you sure": the design goes, and the records do not
   * unless there are none.
   */
  const remove = async (form) => {
    const ok = await raiseConfirm(
      'Its design goes. Its table and any records in it are kept unless the table is empty.',
      {
        title: 'Delete "' + (form.name || form.key) + '"?',
        confirmLabel: 'Delete',
        // Red, because it cannot be undone from here.
        danger: true
      }
    )
    if (!ok) return
    setBusy(form.key)
    try {
      const out = await deleteForm(factory, form)
      // Said plainly: somebody deleting a form expects all of it to go, and a
      // table left behind is worth knowing about rather than discovering.
      if (out && out.records > 0) {
        raiseSnackbar('"' + (form.name || form.key) + '" is gone. Its table "' + out.table + '" was kept — it still holds ' +
          out.records + ' record' + (out.records === 1 ? '' : 's') + '.', { design: 'info' })
      } else if (out && out.tableDropped) {
        raiseSnackbar('"' + (form.name || form.key) + '" and its empty table are gone.', { design: 'success' })
      } else {
        raiseSnackbar('"' + (form.name || form.key) + '" is gone.', { design: 'success' })
      }
      load()
    } catch (err) {
      raiseSnackbar(err.message, { design: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const publish = async (form) => {
    setBusy(form.key)
    try {
      for (const screen of [form.edit, form.list]) {
        if (!screen || (screen.version !== null && !screen.hasDraft)) continue
        const row = await factory.loadDraft(screen.screenKey)
        await factory.publish(row.document)
      }
      raiseSnackbar('Published "' + form.name + '"', { design: 'success' })
      load()
    } catch (err) {
      raiseSnackbar(err.confirm
        ? 'Publishing "' + form.name + '" would remove columns and their data — open Design form and publish there to see what, and confirm.'
        : err.message, { design: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const toggleMenu = async (form) => {
    setBusy(form.key)
    try {
      if (inMenu.has(form.key)) await removeMenuItem(FORM_MENU_PREFIX + form.key)
      else await addMenuItem({ name: FORM_MENU_PREFIX + form.key, label: form.name })
      await refreshAccess()
      raiseSnackbar(inMenu.has(form.key) ? 'Removed "' + form.name + '" from the menu' : 'Added "' + form.name + '" to the menu — rename or move it in the Menu tab', { design: 'success' })
      load()
    } catch (err) {
      raiseSnackbar(err.message, { design: 'error' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="app-forms">
      <p className="app-page-lead">
        Every UI in the app. A new one starts with a Name field — add the rest in its design, then publish to create its table.
      </p>

      <form className="app-forms-new" onSubmit={create}>
        <label className="app-forms-field">
          <span>Label — what people see</span>
          <input value={label} onChange={(e) => onLabel(e.target.value)} placeholder="Farming departments" />
        </label>
        <label className="app-forms-field">
          <span>Key — names its table; fixed once published</span>
          <input value={key} onChange={(e) => { setKey(e.target.value); setKeyEdited(true) }} placeholder="farming_department" />
        </label>
        <button type="submit" className="app-btn" disabled={!key.trim() || busy === 'new'}>
          {busy === 'new' ? 'Creating…' : 'New form'}
        </button>
      </form>


      {forms && forms.length === 0 && <p className="app-sub">No forms yet.</p>}
      {forms && forms.length > 0 && (
        <table className="app-table">
          <thead>
            <tr><th>Label</th><th>Table</th><th>Form</th><th>List</th><th /></tr>
          </thead>
          <tbody>
            {forms.map((form) => {
              const edit = state(form.edit)
              const list = state(form.list)
              const canOpen = form.list && form.list.version !== null
              return (
                <tr key={form.key}>
                  <td>
                    <strong>{form.name || form.key}</strong>
                    <div className="app-sub">{form.key}</div>
                    {/* WHAT IT IS FOR, and whose it is — the two things that
                        tell three forms of the same name apart. The date
                        stands alone when the names cannot be fetched. */}
                    {form.description && <div className="app-sub">{form.description}</div>}
                    {(form.createdBy || form.createdDate) && (
                      <div className="app-sub">
                        {[people[form.createdBy], madeOn(form.createdDate)].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td><code>{form.source || '—'}</code></td>
                  <td className={edit.unpublished ? 'app-forms-pending' : undefined}>{edit.label}</td>
                  <td className={list.unpublished ? 'app-forms-pending' : undefined}>{list.label}</td>
                  <td className="app-row-actions">
                    <button className="app-btn app-btn-quiet" disabled={!canOpen} title={canOpen ? '' : 'Publish it first'} onClick={() => navigate('/forms/' + form.key)}>Open</button>
                    {form.edit && <button className="app-btn app-btn-quiet" onClick={() => navigate('/configure/forms/' + form.key + '/design/form')}>Design form</button>}
                    {form.list && <button className="app-btn app-btn-quiet" onClick={() => navigate('/configure/forms/' + form.key + '/design/list')}>Design list</button>}
                    <button className="app-btn app-btn-quiet" disabled={!canOpen || busy === form.key} title={canOpen ? '' : 'Publish it first'} onClick={() => toggleMenu(form)}>
                      {inMenu.has(form.key) ? 'Remove from menu' : 'Add to menu'}
                    </button>
                    {(edit.unpublished || list.unpublished) && (
                      <button className="app-btn" disabled={busy === form.key} onClick={() => publish(form)}>
                        {busy === form.key ? 'Publishing…' : 'Publish'}
                      </button>
                    )}
                    {/* The design always goes; the TABLE only when it is empty
                        and nothing else describes it. Records are never lost
                        to a click — @xeplr/factory refuses to drop a table
                        with rows in it and says how many kept it. */}
                    <button
                      className="app-btn app-btn-quiet app-btn-danger"
                      disabled={busy === form.key}
                      onClick={() => remove(form)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
