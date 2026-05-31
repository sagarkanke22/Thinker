// LogicLive root. Path-based routing + top nav.
//
//   /plan               → PlanPage (discovery chat with @backend/@frontend)
//   /editor[?screen=X]  → Editor   (dev screen)
//   anything else       → AppRenderer (end-user app — no dev nav)
//
// /plan and /editor get a shared TopNav. /app stays clean since end users
// shouldn't see dev surfaces.

import AppRenderer from './AppRenderer.jsx'
import Editor from './Editor.jsx'
import PlanPage from './plan/PlanPage.jsx'

const DEFAULT_SCREEN = 'sales_report'

function isEditorPath(path) {
  return path === '/editor' || path.startsWith('/editor/')
}

function isPlanPath(path) {
  return path === '/plan' || path.startsWith('/plan/')
}

// ─── TopNav styles ────────────────────────────────────────────────

const NAV_BAR = {
  display: 'flex',
  alignItems: 'center',
  gap: 20,
  padding: '0 18px',
  background: '#0d1117',
  borderBottom: '1px solid #21262d',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  height: 40,
  flexShrink: 0,
  boxSizing: 'border-box',
}
const NAV_BRAND = {
  fontWeight: 700,
  fontSize: 14,
  color: '#f0f6fc',
  textDecoration: 'none',
  letterSpacing: 0.3,
}
const NAV_LINK = {
  fontSize: 13,
  color: '#9da5b4',
  textDecoration: 'none',
  padding: '4px 10px',
  borderRadius: 4,
  transition: 'background 0.15s, color 0.15s',
}
const NAV_LINK_ACTIVE = {
  ...NAV_LINK,
  color: '#fff',
  background: '#1f6feb',
  fontWeight: 600,
}
const NAV_RIGHT = {
  marginLeft: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
}
const NAV_SUB = {
  fontSize: 11,
  color: '#6e7681',
  fontFamily: 'ui-monospace, monospace',
}

function TopNav({ currentPath }) {
  const onPlan = isPlanPath(currentPath)
  const onEditor = isEditorPath(currentPath)
  // Show current screen in the editor link when known, else default
  const screen =
    new URLSearchParams(window.location.search).get('screen') ||
    DEFAULT_SCREEN
  return (
    <div style={NAV_BAR}>
      <a href="/plan" style={NAV_BRAND}>⚡ LogicLive</a>
      <a href="/plan" style={onPlan ? NAV_LINK_ACTIVE : NAV_LINK}>
        Plan
      </a>
      <a href={`/editor?screen=${screen}`} style={onEditor ? NAV_LINK_ACTIVE : NAV_LINK}>
        Editor
      </a>
      <div style={NAV_RIGHT}>
        {onEditor && <span style={NAV_SUB}>screen: {screen}</span>}
        <a
          href={`/app?screen=${screen}`}
          target="_blank"
          rel="noreferrer"
          style={NAV_LINK}
          title="Open the end-user view in a new tab"
        >
          Preview app ↗
        </a>
      </div>
    </div>
  )
}

const SHELL = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  background: '#fafbfc',
}
const PAGE_FRAME = { flex: 1, minHeight: 0, overflow: 'hidden' }

export default function App() {
  const path = window.location.pathname
  const isDev = isPlanPath(path) || isEditorPath(path)
  if (!isDev) return <AppRenderer />
  return (
    <div style={SHELL}>
      <TopNav currentPath={path} />
      <div style={PAGE_FRAME}>
        {isPlanPath(path) ? <PlanPage /> : <Editor />}
      </div>
    </div>
  )
}
