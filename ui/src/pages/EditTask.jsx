// THE TASK FORM — and what the task screens do in the browser.
//
// The form itself is the "task_edit" screen, designed in Configure UI → Forms. This
// module holds its HOOKS, used by this page, by the Tasks list and by the
// popup the list opens.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FactoryScreen, FactoryHooks } from '@xeplr/ui-factory'
import { factory } from '../api/factory.js'

// ── WHAT THE TASK SCREENS DO IN THE BROWSER ──────────────────────────────
// Every method runs the default (super). Change the ones you need; leave the
// rest as they are.
//
//   before    change the input, then call super
//   after     call super, then use or change what it returns
//   override  do not call super
//
// ctx.screen says which screen is calling ("task_list" or "task_edit").
// Keep them as methods (save(values, ctx) { … }) — super does not work in
// arrow functions. Rules that must hold belong in a server function
// (api/functions/), named in the screen's events.
export class TaskHooks extends FactoryHooks {
  /** A list's rows (ctx.many), or the record Edit opens (ctx.id). */
  get(ctx) {
    return super.get(ctx)
  }

  /** The Save button — one AJAX call. Returns the saved record. */
  save(values, ctx) {
    return super.save(values, ctx)
  }

  /** A list row, after the person confirmed. */
  delete(record, ctx) {
    return super.delete(record, ctx)
  }

  /**
   * Before a stepper moves — Next, Back, or a click on the bar.
   *
   * Return false to stay where you are, or a step (its key or its number) to
   * go there instead. ctx.disable(['planning']) rules steps out — they stay on
   * the bar, struck through, and Next and Back pass over them; ctx.enable()
   * brings them all back. The step's own required fields are checked before
   * this runs, so this is for your rules, not theirs. For example:
   *
   *   if (ctx.from === 0 && ctx.values.priority === 'low') {
   *     ctx.disable(['planning'])
   *     return 'attachment'
   *   }
   *   ctx.enable()
   */
  step(ctx) {
    return super.step(ctx)
  }

  /** Extra row buttons beside Edit / Delete: [{ label, onClick: (record, ctx) => … }]. ctx.refresh() reloads. */
  actions(ctx) {
    return super.actions(ctx)
  }
}

export const taskHooks = new TaskHooks()

/**
 * The task form on a page of its own — /tasks/new, or /tasks/:id for a task
 * that exists. The list sends people here (its "Opens in" is a page).
 *
 * Nothing is written while typing. Save sends the task (one AJAX call, never
 * a form submit) and comes back to the list; Cancel comes back without
 * saving, asking first if anything is unsaved. Both go through onDone.
 */
export default function EditTask({ record }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [screen, setScreen] = useState(null)
  const [task, setTask] = useState(record || null)
  const [error, setError] = useState(null)

  useEffect(() => {
    factory.loadScreen('task_edit').then(setScreen, (e) => setError(e.message))
  }, [])

  // The record as it is NOW, through the server's events — not a copy the
  // list happened to have.
  useEffect(() => {
    if (record || !id || id === 'new') return
    factory.fetchRecord({ screen: 'task_edit', id }).then(setTask, (e) => setError(e.message))
  }, [id, record])

  if (error) return <div className="app-error">Could not load the task form — {error}</div>
  if (!screen || (id && id !== 'new' && !task)) return null
  return (
    <FactoryScreen
      document={screen}
      record={task}
      {...factory.screenProps}
      hooks={taskHooks}
      onDone={() => navigate('/tasks')}
    />
  )
}
