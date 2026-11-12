import { useState } from 'react'

// The panel beside the sample. It is here so the first thing anybody builds is
// explained where they are looking, rather than in a document they have to go
// and find.

// The same prompt as in CLAUDE.md. Replace the form and its fields.
const PROMPT = 'Create a new UI for farming departments. One record is a farming department with: Name (required), Region (dropdown: North, South, East, West), Area in acres (number, at least 0), Started on (date), Certifications (choose several: Organic, Fair trade, Rainforest), Inspection at (date and time), Licence (file: .pdf or .jpg), Notes (long text). Show Name, Region and Area in the list. Follow "Create a new UI" in CLAUDE.md.'

export default function TasksHelp() {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(PROMPT).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }, () => {})
  }

  return (
    <aside className="app-help">
      <div className="app-help-badge">Sample</div>
      <h2>Create your own UI with Claude</h2>
      <p>
        Open Claude in this project's folder (the one with <code>api</code> and{' '}
        <code>ui</code>) and give it this — change the name and the fields:
      </p>
      <pre className="app-help-prompt">{PROMPT}</pre>
      <button type="button" className="app-btn app-btn-quiet" onClick={copy}>
        {copied ? 'Copied' : 'Copy prompt'}
      </button>
      <p>
        Add behaviour in the same message if you want it — "a Mark active button
        on each row", "Region is required when Area is over 100". When Claude is
        done, restart the sign-in service and the API: the menu item appears and
        the table is created.
      </p>

      <h3>This page is an example</h3>
      <p>
        A task is filled in over three steps — the task, planning, an
        attachment — and shows every kind of control there is: text, a
        dropdown, radio buttons, a tick box, dates, a date and time, several
        tags at once, and a file. Neither the list nor the form is written by
        hand: both are <strong>screens</strong>, and a task is saved in an
        ordinary <code>tasks</code> table with one column per field. The file
        itself is kept outside the database, and its column holds the path.
      </p>
      <p>
        <strong>New</strong> and <strong>Edit</strong> open the form on a page
        of its own. Nothing is saved while you type: <strong>Save</strong> saves
        and comes back here, <strong>Cancel</strong> comes back without saving. A list can open
        it in a popup instead — that is its <strong>Opens in</strong> setting.
      </p>

      <h3>Change it</h3>
      <p>
        Open <strong>Configure UI</strong> in the settings menu (top right) and{' '}
        <strong>Design form</strong> on Tasks. Add a field, move one, change a
        label or a colour — then <strong>Publish</strong>. The table gains its
        new column as you publish.
      </p>

      <h3>Or without code</h3>
      <p>
        <strong>Configure UI → Forms → New form</strong>: label and key, design,
        publish, add to menu — no code. The full steps for a form with its own page, functions and
        model are in <code>CLAUDE.md</code>, under "Create a new UI".
      </p>

      <h3>More than saving</h3>
      <p>
        In the browser — a value added before saving, rows filtered for display,
        an extra button on each row: <code>ui/src/pages/EditTask.jsx</code>.
        Every method calls <code>super</code>; change the one you need.
      </p>
      <p>
        On the server — a check against other records, an email afterwards, a
        list only managers see: a function in <code>api/functions/</code>, registered by the event it
        is for and named in the screen’s events — Tasks names <code>tidyTaskTitle</code>.
      </p>

      <h3>Two things that catch people</h3>
      <ul className="app-help-notes">
        <li>
          Once a screen is published, the <em>database</em> holds its design.
          Editing its <code>.screen.json</code> afterwards changes nothing — use
          Forms.
        </li>
        <li>
          A new menu entry is remembered for ten minutes. Restart the sign-in
          service if you want it immediately.
        </li>
      </ul>
    </aside>
  )
}
