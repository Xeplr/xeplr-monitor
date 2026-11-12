import { useMemo } from 'react'
import { Routes, Route, Outlet, Navigate, useNavigate } from 'react-router-dom'
import { authRoutes, authPath, NavPage, ProtectedRoute, useAccess } from '@xeplr/ui-account'
import Home from './pages/Home.jsx'
import Tasks from './pages/Tasks.jsx'
import EditTask from './pages/EditTask.jsx'
import FlowDesigner from './pages/FlowDesigner.jsx'
import Journey from './pages/Journey.jsx'
import FlowsHome from './pages/FlowsHome.jsx'
import ConfigureUI from './pages/ConfigureUI.jsx'
import { FORM_MENU_PREFIX } from './menu.js'
import FormDesigner from './pages/FormDesigner.jsx'
import FormRecords from './pages/FormRecords.jsx'
import Monitor from './pages/Monitor.jsx'

// The rail is ICON-ONLY when collapsed, so a drawer item without one is
// invisible until somebody widens the rail. Same 24x24 stroke language the
// account library's own icons use.
const TasksIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
)

const FlowsIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="6" height="6" rx="1" />
    <rect x="15" y="15" width="6" height="6" rx="1" />
    <path d="M9 6h4a2 2 0 0 1 2 2v7" />
  </svg>
)

const MonitorIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
)

const FormsIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M9 21V9" />
  </svg>
)

const HomeIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M9 22V12h6v10" />
  </svg>
)

// Module-level (stable reference) so NavPage's memoization actually holds.
const notifications = { count: 0, onClick: () => {} }

// Rendered above the framework's built-in Profile / Change Password section.
// `key` is the menu row it matches (shown only to roles given that row); what
// people read is its label, changed in Configure UI → Menu.
const settingsOverrides = [
  { key: 'Admin', path: authPath('userRoles') },
  // Super Admin only (migrations-auth/0003): every form, and the side rail.
  { key: 'Configure UI', path: '/configure' }
]


// Layout route: NavPage and the routed page are independent siblings, and this
// holds no state of its own — lifting page state up here would re-render the
// nav on every unrelated change.
function Shell() {
  const navigate = useNavigate()

  const { access } = useAccess()
  const menus = (access && access.menus) || []

  // The drawer's catalog, by KEY. A key must match a `menus` row's name —
  // @xeplr/ui-account drops unknown keys SILENTLY, so a typo removes the item
  // with no error anywhere. The text shown is the row's label (Configure UI →
  // Menu), in the order set there — never written here. `path` is how the rail
  // marks the page you are on (and /tasks/12 still counts as Tasks).
  const drawerItems = useMemo(() => [
    { key: 'Home', icon: HomeIcon, path: '/home', clickHandler: () => navigate('/home') },
    { key: 'Monitor', icon: MonitorIcon, path: '/monitor', clickHandler: () => navigate('/monitor') },
    { key: 'Tasks', icon: TasksIcon, path: '/tasks', clickHandler: () => navigate('/tasks') },
    // Always in the rail — the page says when Xeplr Workflow is not connected.
    { key: 'Flows', icon: FlowsIcon, path: '/flows', clickHandler: () => navigate('/flows') },
    // Every form added to the menu, with no code: "form:crop" opens /forms/crop.
    ...menus.filter((key) => key.startsWith(FORM_MENU_PREFIX)).map((key) => ({
      key, icon: FormsIcon,
      path: '/forms/' + key.slice(FORM_MENU_PREFIX.length),
      clickHandler: () => navigate('/forms/' + key.slice(FORM_MENU_PREFIX.length))
    }))
  ], [navigate, menus])

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
        <Route path="/home" element={<Home />} />
        {/* The server's services — migrations-auth/0006_monitor.sql grants who sees it. */}
        <Route path="/monitor" element={<Monitor />} />
        <Route path="/tasks" element={<Tasks />} />
        {/* The task list opens its form on a page — see Tasks.jsx's onOpenRecord. */}
        <Route path="/tasks/new" element={<EditTask />} />
        <Route path="/tasks/:id" element={<EditTask />} />
        <Route path="/forms/:form" element={<FormRecords />} />
        <Route path="/configure" element={<ConfigureUI />} />
        <Route path="/configure/forms/:form/design/:part" element={<FormDesigner />} />
        {/* Flows — run by @xeplr/workflow inside this app's own API. */}
        <Route path="/flows" element={<FlowsHome />} />
        <Route path="/configure/flows/:flow" element={<FlowDesigner />} />
        {/* A journey: its run id joins the address once it starts, so it can be resumed. */}
        <Route path="/journey/:flow" element={<Journey />} />
        <Route path="/journey/:flow/:run" element={<Journey />} />
      </Route>

      <Route path="*" element={<Navigate to="/auth/login" replace />} />
    </Routes>
  )
}
