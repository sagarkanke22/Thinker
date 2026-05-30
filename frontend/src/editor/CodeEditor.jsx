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
  const saveRef = useRef(null)

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
        <button
          style={dirty && phase !== 'saving' ? SAVE_BTN : SAVE_BTN_DISABLED}
          onClick={save}
          disabled={!dirty || phase === 'saving'}
        >
          Save
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          height="100%"
          defaultLanguage="python"
          theme="vs-dark"
          value={code}
          onChange={(v) => setCode(v || '')}
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            tabSize: 4,
            insertSpaces: true,
            scrollBeyondLastLine: false,
          }}
        />
      </div>
    </div>
  )
}
