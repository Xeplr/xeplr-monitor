import { useEffect, useState } from 'react'
import { authFetch, getUser } from '@xeplr/ui-account'

// THE STARTER SCREEN — the equivalent of "Welcome to React".
//
// It exists to prove the whole chain works and then get out of the way:
// you are signed in, the UI reached the API, and the API accepted your token.
// Replace it with your own first page — that is the point of it.

function Check({ ok, pending, children }) {
  return (
    <li className="app-check">
      <span className={'app-check-dot' + (pending ? ' is-pending' : ok ? ' is-ok' : ' is-bad')} />
      {children}
    </li>
  )
}

export default function Home() {
  const user = getUser()
  const [api, setApi] = useState({ state: 'checking' })

  useEffect(() => {
    // authFetch returns the PARSED body — it has already checked the status
    // and thrown on failure, so there is no .json() to call.
    authFetch('/whoami')
      .then(() => setApi({ state: 'ok' }))
      .catch((e) => setApi({ state: 'error', message: e.message }))
  }, [])

  return (
    <div className="app-welcome">
      <img src="/logo.svg" alt="" className="app-welcome-logo" />

      <h1>Welcome to your app</h1>
      <p className="app-welcome-lead">
        Everything below is already working. Replace this page and start building.
      </p>

      <ul className="app-checks">
        <Check ok>
          Signed in as <strong>{user ? user.email : 'unknown'}</strong>
        </Check>
        <Check ok={api.state === 'ok'} pending={api.state === 'checking'}>
          {api.state === 'checking' && 'Talking to your API…'}
          {api.state === 'ok' && <>Your API answered, and accepted your sign-in</>}
          {api.state === 'error' && <>Could not reach your API — {api.message}</>}
        </Check>
        <Check ok>Sign-in, profile, roles and permissions are all set up</Check>
      </ul>

      <h2>What to change first</h2>
      <ol className="app-next">
        <li>
          <code>src/pages/Home.jsx</code> — this page.
        </li>
        <li>
          <code>public/logo.svg</code> and <code>public/logo-wide.svg</code> — the
          sample logo, in the top bar and the side rail.
        </li>
        <li>
          <strong>Configure UI</strong>, in the settings menu — every form (make one,
          design it, publish it, add it to the menu) and the side rail's labels.
        </li>
        <li>
          <code>src/App.jsx</code> — add your own pages, and the side-rail items
          that open them.
        </li>
      </ol>

      <p className="app-welcome-foot">
        Use the settings menu, top right, for your profile, password, and the
        admin screens for users and roles.
      </p>
    </div>
  )
}
