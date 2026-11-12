// THE SAMPLE — a list of tasks. New and Edit open the task form on a PAGE of
// its own. Its Save button saves over AJAX (never a form submit) and comes
// back here; Cancel comes back without saving. (A list can open its form in a popup instead: Configure
// UI → Forms → the list → Opens in.)
//
// Nothing about tasks is written in this file. The list and the form are
// SCREENS, designed in Configure UI → Forms and stored by the API; this page only
// loads the published "task_list" and hands it the calls it needs — and the
// task hooks (EditTask.jsx), which the popup uses too.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FactoryScreen } from '@xeplr/ui-factory'
import { factory } from '../api/factory.js'
import TasksHelp from './TasksHelp.jsx'
import { taskHooks } from './EditTask.jsx'

export default function Tasks() {
  const [screen, setScreen] = useState(null)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    factory.loadScreen('task_list').then(setScreen, (e) => setError(e.message))
  }, [])

  return (
    <div className="app-page app-page-split">
      <div className="app-page-main">
        {error && <div className="app-error">Could not load the task list — {error}</div>}
        {/* loadScreen lets the list's Edit / New fetch "task_edit" when first opened. */}
        {screen && (
          <FactoryScreen
            document={screen}
            {...factory.screenProps}
            hooks={taskHooks}
            // The list opens records on a page, so it asks this app where to go.
            onOpenRecord={({ id }) => navigate(id ? `/tasks/${id}` : '/tasks/new')}
          />
        )}
      </div>
      <TasksHelp />
    </div>
  )
}
