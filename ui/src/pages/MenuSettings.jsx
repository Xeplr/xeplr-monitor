// THE SIDE RAIL'S ITEMS (Configure UI → Menu) — rename, reorder, hide.
//
// Each item has a KEY, which the code matches on and which never changes here,
// and a LABEL, which is what people read. Leave the label empty to show the key.
// Saved for everyone at once; your own rail updates straight away.
import { useCallback, useEffect, useState } from 'react'
import { listMenuItems, saveMenuItems, useAccess } from '@xeplr/ui-account'
import { webOnlyMenus } from '@xeplr/ui-factory'
import { APP_MENU_KEYS, FORM_MENU_PREFIX } from '../menu.js'
import pages from '../../pages.json'

// Items whose page is hand-written for the browser (ui/pages.json "webOnly"):
// tagged, so whoever arranges the menu knows they will not be in a phone app.
const WEB_ONLY = webOnlyMenus(pages)

// The app's own items (ui/src/menu.js) and forms added to the menu. The rest —
// sign-in's pages (Login, Register …) and admin screens — only with "Show all".
const isAppItem = (name) => APP_MENU_KEYS.includes(name) || name.startsWith(FORM_MENU_PREFIX)

export default function MenuSettings() {
  const { refreshAccess } = useAccess()
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(() => {
    listMenuItems().then((rows) => { setItems(rows.map((r) => ({ ...r, label: r.label || '' }))); setError(null) }, (e) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const shown = (it) => showAll || isAppItem(it.name)
  const change = (name, patch) => setItems((list) => list.map((it) => (it.name === name ? { ...it, ...patch } : it)))
  // Swap with the next row ON SCREEN — entries filtered out keep their places.
  const move = (name, by) => setItems((list) => {
    const visible = list.filter(shown).map((it) => it.name)
    const k = visible.indexOf(name) + by
    if (k < 0 || k >= visible.length) return list
    const a = list.findIndex((it) => it.name === name)
    const b = list.findIndex((it) => it.name === visible[k])
    const next = [...list]
    ;[next[a], next[b]] = [next[b], next[a]]
    return next
  })

  const save = async () => {
    setSaving(true)
    setNotice(null)
    try {
      // The order on screen becomes the order in the rail.
      await saveMenuItems(items.map((it, i) => ({ name: it.name, label: it.label, sortOrder: i, isHidden: it.isHidden })))
      await refreshAccess()
      setNotice('Saved — the menu shows it now')
      setError(null)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app-menu-settings">
      <p className="app-page-lead">
        What the side rail and the settings menu show, and in what order. Add a form to the menu from the Forms tab.
      </p>
      <label className="app-menu-shown">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all menu entries, including sign-in and admin pages
      </label>
      {error && <div className="app-error">{error}</div>}
      {notice && <div className="app-notice">{notice}</div>}
      {items && (
        <table className="app-table">
          <thead>
            <tr><th>Order</th><th>Label</th><th>Key</th><th>Shown</th></tr>
          </thead>
          <tbody>
            {items.filter(shown).map((it, i, visible) => (
              <tr key={it.name} className={it.isHidden ? 'app-menu-hidden' : undefined}>
                <td className="app-row-actions">
                  <button type="button" className="app-btn app-btn-quiet" aria-label={'Move ' + it.shown + ' up'} disabled={i === 0} onClick={() => move(it.name, -1)}>↑</button>
                  <button type="button" className="app-btn app-btn-quiet" aria-label={'Move ' + it.shown + ' down'} disabled={i === visible.length - 1} onClick={() => move(it.name, 1)}>↓</button>
                </td>
                <td>
                  <input className="app-menu-label" value={it.label} placeholder={it.name} aria-label={'Label for ' + it.name} onChange={(e) => change(it.name, { label: e.target.value })} />
                </td>
                <td>
                  <code>{it.name}</code>
                  {WEB_ONLY[it.name] && <span className="app-web-only" title={WEB_ONLY[it.name]}>Web only</span>}
                </td>
                <td>
                  <label className="app-menu-shown">
                    <input type="checkbox" checked={!it.isHidden} onChange={(e) => change(it.name, { isHidden: !e.target.checked })} /> Shown
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {items && (
        <button type="button" className="app-btn" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save menu'}</button>
      )}
    </div>
  )
}
