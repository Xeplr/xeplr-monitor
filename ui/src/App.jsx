import { useMemo } from 'react'
import { Routes, Route, Outlet, Navigate, useNavigate } from 'react-router-dom'
import { authRoutes, authPath, NavPage, ProtectedRoute } from '@xeplr/ui-account'
import Home from './pages/Home.jsx'
import Monitor from './pages/Monitor.jsx'
import Connections from './pages/Connections.jsx'
import { registerJobsUI } from '@xeplr/ui-jobs'

// The backup jobs' pages (@xeplr/ui-jobs, at /jobs), on this API (/api/jobs…).
// A job's dropdowns list the saved connections (routes/connections.js), by
// the kinds lib/backups.js's action names in `optionsFrom`.
const jobsUI = registerJobsUI({
  apiBase: '/api',
  optionSources: {
    backupServers: { url: '/monitor/connections/servers', label: 'name' },
    backupDatabases: { url: '/monitor/connections/databases', label: 'name' },
    backupBuckets: { url: '/monitor/connections/buckets', label: 'name' }
  }
})

// The rail is ICON-ONLY when collapsed, so a drawer item without one is
// invisible until somebody widens the rail. Same 24x24 stroke language the
// account library's own icons use.
const HomeIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M9 22V12h6v10" />
  </svg>
)

const JobsIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

const ConnectionsIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
    <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </svg>
)

const MonitorIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
)

// Module-level (stable reference) so NavPage's memoization actually holds.
const notifications = { count: 0, onClick: () => {} }

// Rendered above the framework's built-in Profile / Change Password section.
// `key` is the menu row it matches (shown only to roles given that row); what
// people read is its label.
const settingsOverrides = [
  { key: 'Admin', path: authPath('userRoles') }
]

// Layout route: NavPage and the routed page are independent siblings, and this
// holds no state of its own — lifting page state up here would re-render the
// nav on every unrelated change.
function Shell() {
  const navigate = useNavigate()

  // The drawer's catalog, by KEY. A key must match a `menus` row's name
  // (migrations-auth/0006, 0007, 0008; Jobs is @xeplr/jobs' own row) — @xeplr/ui-account drops unknown keys
  // SILENTLY, so a typo removes the item with no error anywhere. The text
  // shown is the row's label, never written here. `path` is how the rail
  // marks the page you are on.
  const drawerItems = useMemo(() => [
    { key: 'Home', icon: HomeIcon, path: '/home', clickHandler: () => navigate('/home') },
    { key: 'Monitor', icon: MonitorIcon, path: '/monitor', clickHandler: () => navigate('/monitor') },
    { key: 'Jobs', icon: JobsIcon, path: '/jobs', clickHandler: () => navigate('/jobs') },
    { key: 'Backup connections', icon: ConnectionsIcon, path: '/connections', clickHandler: () => navigate('/connections') }
  ], [navigate])

  return (
    <div className="app">
      {/* SAMPLE LOGOS — replace public/logo.svg and public/logo-wide.svg with
          your own. `logo` is the small mark in the top bar and the collapsed
          rail; `expandedLogo` is the wider wordmark the rail swaps to when you
          widen it. */}
      <NavPage
        logo="/logo.svg"
        expandedLogo="/logo-wide.svg"
        notifications={notifications}
        settingsOverrides={settingsOverrides}
        drawerItems={drawerItems}
      />
      <main className="main"><Outlet /></main>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      {/* @xeplr/ui-account supplies every auth screen — login, register,
          forgot/reset password, activate, profile, change password, and the
          RBAC admin pages. We hand it our Shell so signed-in pages render in
          our own chrome. */}
      {authRoutes({}, { layout: <Shell /> })}

      <Route element={<ProtectedRoute><Shell /></ProtectedRoute>}>
        <Route path="/" element={<Navigate to="/home" replace />} />
        {/* The server itself — migrations-auth/0007_monitor_home.sql grants who sees it. */}
        <Route path="/home" element={<Home />} />
        {/* The server's services — migrations-auth/0006_monitor.sql grants who sees it. */}
        <Route path="/monitor" element={<Monitor />} />
        {/* The backup jobs: schedule, runs, Run now — @xeplr/jobs' migrations-auth grants who sees them. */}
        {jobsUI.routes}
        {/* The logins the backups use — migrations-auth/0008_backups.sql: admins only. */}
        <Route path="/connections" element={<Connections />} />
      </Route>

      <Route path="*" element={<Navigate to="/auth/login" replace />} />
    </Routes>
  )
}
