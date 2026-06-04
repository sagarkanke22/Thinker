// CodeEditor — Monaco editor bound to the selected widget's logic_code.
// On widgetId change, fetches GET /api/logic. Ctrl+S → POST /api/save.
//
// [C015] This editor only ever reads / writes logic_code, never
// base_config. The backend SaveRequest model has no base_config field,
// so the constraint is structurally enforced.

import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'

const HEADER = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '6px 12px',
  borderBottom: '1px solid #e1e4e8',
  background: '#f7f8fa',
  fontSize: 12,
  color: '#444',
  flexShrink: 0,
}
const HEADER_LEFT = { display: 'flex', alignItems: 'center', gap: 10 }
const TITLE = { fontWeight: 600, fontFamily: 'ui-monospace, monospace' }
const STATUS_MUTED = { color: '#888', fontStyle: 'italic' }
const STATUS_ERR = { color: 'crimson' }
const STATUS_OK = { color: '#2da44e' }
const SAVE_BTN = {
  padding: '3px 10px',
  border: '1px solid #1f6feb',
  borderRadius: 3,
  background: '#1f6feb',
  color: '#fff',
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
}
const SAVE_BTN_DISABLED = {
  ...SAVE_BTN,
  background: '#a8c3e6',
  border: '1px solid #a8c3e6',
  cursor: 'default',
}
const EMPTY = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: '#aaa',
  fontStyle: 'italic',
  fontFamily: 'system-ui, sans-serif',
}

export function CodeEditor({ screenId, widgetId }) {
  const [code, setCode] = useState('')
  const [origCode, setOrigCode] = useState('')
  const [phase, setPhase] = useState('idle') // idle | loading | saving | saved | error
  const [errMsg, setErrMsg] = useState(null)
  const [testOut, setTestOut] = useState(null)   // {ok, result, stdout, stderr} or null
  const [testing, setTesting] = useState(false)
  const saveRef = useRef(null)
  const editorRef = useRef(null)

  // Load logic when the selected widget changes
  useEffect(() => {
    if (!screenId || !widgetId) return
    let cancelled = false
    setPhase('loading')
    setErrMsg(null)
    fetch(
      `/api/logic?screen_id=${encodeURIComponent(screenId)}&widget_id=${encodeURIComponent(widgetId)}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((body) => {
        if (cancelled) return
        const s = body.logic_code || ''
        setCode(s)
        setOrigCode(s)
        // Imperatively set Monaco's content — avoids controlled-mode re-render on every keystroke
        editorRef.current?.getModel()?.setValue(s)
        setPhase('idle')
      })
      .catch((e) => {
        if (cancelled) return
        setPhase('error')
        setErrMsg(String(e.message || e))
      })
    return () => {
      cancelled = true
    }
  }, [screenId, widgetId])

  // Clear test output when widget selection changes
  useEffect(() => {
    setTestOut(null)
  }, [widgetId])

  // Test handler — runs current code in sandbox WITHOUT saving
  const runTest = async () => {
    if (!code.trim()) return
    setTesting(true)
    setTestOut(null)
    try {
      const r = await fetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logic_code: code, params: {} }),
      })
      const body = await r.json()
      setTestOut(body)
    } catch (e) {
      setTestOut({ ok: false, result: { error: { type: 'fetch',
                   message: String(e.message || e) } }, stdout: '', stderr: '' })
    } finally {
      setTesting(false)
    }
  }

  // Save handler — also bound to Ctrl+S inside Monaco
  const save = async () => {
    if (!screenId || !widgetId) return
    setPhase('saving')
    setErrMsg(null)
    try {
      const r = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screen_id: screenId,
          widget_id: widgetId,
          logic_code: code,
        }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${r.status}`)
      }
      setOrigCode(code)
      setPhase('saved')
    } catch (e) {
      setPhase('error')
      setErrMsg(String(e.message || e))
    }
  }
  saveRef.current = save // always reach the latest save (closure-free Monaco binding)

  const handleMount = (editor, monaco) => {
    editorRef.current = editor
    editor.updateOptions({ accessibilitySupport: 'off' })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveRef.current && saveRef.current()
    })
  }

  if (!widgetId) {
    return <div style={EMPTY}>Select a widget on the left</div>
  }

  const dirty = code !== origCode
  let statusEl = null
  if (phase === 'loading') statusEl = <span style={STATUS_MUTED}>loading…</span>
  else if (phase === 'saving') statusEl = <span style={STATUS_MUTED}>saving…</span>
  else if (phase === 'saved' && !dirty)
    statusEl = <span style={STATUS_OK}>saved</span>
  else if (phase === 'error')
    statusEl = <span style={STATUS_ERR}>{errMsg}</span>
  else if (dirty)
    statusEl = <span style={STATUS_MUTED}>unsaved (Ctrl+S)</span>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={HEADER}>
        <div style={HEADER_LEFT}>
          <span style={TITLE}>{widgetId}</span>
          {statusEl}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            style={!testing && code.trim() ? TEST_BTN : TEST_BTN_DISABLED}
            onClick={runTest}
            disabled={testing || !code.trim()}
            title="Run this code in the sandbox without saving"
          >
            {testing ? '…' : 'Test'}
          </button>
          <button
            style={dirty && phase !== 'saving' ? SAVE_BTN : SAVE_BTN_DISABLED}
            onClick={save}
            disabled={!dirty || phase === 'saving'}
          >
            Save
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          height="100%"
          defaultLanguage="python"
          theme="vs-dark"
          onChange={(v) => setCode(v || '')}
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            tabSize: 4,
            insertSpaces: true,
            scrollBeyondLastLine: false,
            accessibilitySupport: 'off',
          }}
        />
      </div>
      {testOut && (
        <div style={TEST_PANEL}>
          <div style={TEST_PANEL_HEADER}>
            <span>
              Test{' '}
              {testOut.ok
                ? <span style={{ color: '#2da44e' }}>✓ ok</span>
                : <span style={{ color: 'crimson' }}>✗ {testOut.result?.error?.type || 'failed'}</span>
              }
              {typeof testOut.duration_ms === 'number' && (
                <span style={{ color: '#888', marginLeft: 8 }}>· {testOut.duration_ms}ms</span>
              )}
            </span>
            <button style={CLOSE_BTN} onClick={() => setTestOut(null)}>×</button>
          </div>
          <div style={TEST_PANEL_BODY}>
            <div style={TEST_SECTION_LABEL}>result</div>
            <pre style={TEST_PRE}>{JSON.stringify(testOut.result, null, 2)}</pre>

            {/* Always show stdout section so user can tell whether code printed */}
            <div style={TEST_SECTION_LABEL}>
              stdout (server-side print output from sandbox)
            </div>
            <pre style={{
              ...TEST_PRE,
              background: '#f0f0f4',
              color: testOut.stdout ? '#222' : '#888',
              fontStyle: testOut.stdout ? 'normal' : 'italic',
            }}>
              {testOut.stdout || '(no print output — add print(...) to your widget logic to see traces here)'}
            </pre>

            {testOut.stderr && (
              <>
                <div style={TEST_SECTION_LABEL}>stderr</div>
                <pre style={{ ...TEST_PRE, background: '#fff0f0', color: 'crimson' }}>{testOut.stderr}</pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const TEST_BTN = {
  padding: '3px 10px',
  border: '1px solid #2da44e',
  borderRadius: 3,
  background: '#2da44e',
  color: '#fff',
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
}
const TEST_BTN_DISABLED = {
  ...TEST_BTN,
  background: '#a8d4b8',
  border: '1px solid #a8d4b8',
  cursor: 'default',
}
const TEST_PANEL = {
  borderTop: '1px solid #e1e4e8',
  maxHeight: 220,
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  background: '#fafbfc',
}
const TEST_PANEL_HEADER = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 600,
  color: '#444',
  background: '#f0f3f7',
  borderBottom: '1px solid #e1e4e8',
}
const TEST_PANEL_BODY = {
  overflow: 'auto',
  padding: '6px 10px',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 11,
}
const TEST_SECTION_LABEL = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 0.5,
  color: '#666',
  textTransform: 'uppercase',
  margin: '6px 0 2px',
}
const TEST_PRE = {
  margin: 0,
  padding: '4px 8px',
  background: '#fff',
  border: '1px solid #e1e4e8',
  borderRadius: 3,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 100,
  overflow: 'auto',
}
const CLOSE_BTN = {
  background: 'transparent',
  border: 'none',
  fontSize: 16,
  cursor: 'pointer',
  color: '#888',
  padding: 0,
  lineHeight: 1,
}
