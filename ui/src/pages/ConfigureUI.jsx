// CONFIGURE UI — Super Admin, from the settings menu (top right).
//
//   Forms  every UI in the app: make one, design it, publish it, open it, add it
//          to the side rail
//   Masters the lists the rest of the app points at — departments, statuses,
//          countries. Ordinary forms with a flag, gathered in one place because
//          that is what they are: reference data, not daily work
//   Menu   the side rail's items: rename, reorder, hide
//   Flows  forms one after another — what is filled in decides the next; run by
//          Xeplr Workflow, and says how to connect it until it is
//
// Configuration lives here, not in the side rail — the rail is for the pages
// people use.
import { useSearchParams } from 'react-router-dom'
import Forms from './Forms.jsx'
import Masters from './Masters.jsx'
import MenuSettings from './MenuSettings.jsx'
import Flows from './Flows.jsx'

const TABS = [
  { id: 'forms', label: 'Forms', Page: Forms },
  { id: 'masters', label: 'Masters', Page: Masters },
  { id: 'flows', label: 'Flows', Page: Flows },
  { id: 'menu', label: 'Menu', Page: MenuSettings }
]

export default function ConfigureUI() {
  const [params, setParams] = useSearchParams()
  const current = TABS.find((t) => t.id === params.get('tab')) || TABS[0]

  return (
    <div className="app-page app-configure">
      <h1>Configure UI</h1>
      <div className="app-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === current.id}
            className={'app-tab' + (t.id === current.id ? ' is-active' : '')}
            onClick={() => setParams({ tab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <current.Page />
    </div>
  )
}
