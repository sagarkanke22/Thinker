// LogicLive root. Path-based routing:
//   /editor[?screen=X]  → Editor (dev screen)
//   anything else       → AppRenderer (end-user app)
//
// Vite's SPA fallback returns index.html for any path, so the React app
// sees the real pathname via window.location.

import AppRenderer from './AppRenderer.jsx'
import Editor from './Editor.jsx'

function isEditorPath(path) {
  return path === '/editor' || path.startsWith('/editor/')
}

export default function App() {
  return isEditorPath(window.location.pathname) ? <Editor /> : <AppRenderer />
}
