// Editor — dev screen with 3-pane layout (CSS grid in styles/editor.css).
//   Left  : WidgetTree   — list of widgets for the screen
//   Center: CodeEditor   — Monaco editor for the selected widget's logic_code
//           LivePreview  — iframe of /app?screen=X
//   Right : ChatPanel    — scoped AI chat

import { useState } from 'react'
import './styles/editor.css'
import { WidgetTree } from './editor/WidgetTree.jsx'
import { CodeEditor } from './editor/CodeEditor.jsx'
import { LivePreview } from './editor/LivePreview.jsx'
import { ChatPanel } from './editor/ChatPanel.jsx'

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name)
}

export default function Editor() {
  const screenId = getQueryParam('screen')
  // Seed selection + chat prefill from /plan's BuildButton handoff.
  // Read once at mount; the user can later select other widgets normally.
  const [selectedWidgetId, setSelectedWidgetId] = useState(
    () => getQueryParam('select'),
  )
  const [chatPrefill] = useState(() => getQueryParam('prefill') || '')

  if (!screenId) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h2>No screen specified</h2>
        <p>
          Append <code>?screen=&lt;screen_id&gt;</code> to the URL. Try{' '}
          <a href="/editor?screen=sales_report">
            /editor?screen=sales_report
          </a>
          .
        </p>
      </div>
    )
  }

  return (
    // height:100% overrides editor.css's height:100vh so we fit inside
    // App.jsx's flex shell (TopNav above + this below).
    <div className="editor-shell" style={{ height: '100%' }}>
      <header className="editor-header">
        <span className="editor-header-title">LogicLive Editor</span>
        <span className="editor-header-screen">
          screen: <code>{screenId}</code>
        </span>
      </header>

      <aside className="editor-pane editor-tree">
        <WidgetTree
          screenId={screenId}
          selectedWidgetId={selectedWidgetId}
          onSelect={setSelectedWidgetId}
        />
      </aside>

      <main className="editor-center">
        <section className="editor-code">
          <CodeEditor screenId={screenId} widgetId={selectedWidgetId} />
        </section>
        <section className="editor-preview">
          <LivePreview screenId={screenId} />
        </section>
      </main>

      <aside className="editor-pane editor-chat">
        <ChatPanel
          screenId={screenId}
          widgetId={selectedWidgetId}
          prefill={chatPrefill}
        />
      </aside>
    </div>
  )
}
