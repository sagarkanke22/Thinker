// WidgetTree — lists the widgets that make up the current screen.
// Clicking a widget calls onSelect(widget_id) which the Editor uses to
// drive the CodeEditor (Step 16) and ChatPanel (Step 21).

import { useEffect, useRef, useState } from 'react'
import { fetchScreen } from '../api/client.js'

const TYPE_COLORS = {
  text: '#7c5cff',
  input: '#2da44e',
  button: '#1f6feb',
  table: '#e36209',
  chart: '#bf3989',
}

const ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  cursor: 'pointer',
  borderRadius: 4,
  fontSize: 13,
  userSelect: 'none',
  marginBottom: 2,
  transition: 'background 0.1s',
}
const ROW_SELECTED = { background: '#eaf3ff' }
const ROW_DRAG_OVER = { background: '#dbeafe', outline: '2px dashed #1f6feb', outlineOffset: -2 }
const DRAG_HANDLE = {
  color: '#bbb',
  fontSize: 12,
  cursor: 'grab',
  padding: '0 2px',
  lineHeight: 1,
  flexShrink: 0,
  letterSpacing: -1,
}
const BADGE = {
  fontSize: 10,
  fontWeight: 600,
  padding: '1px 6px',
  borderRadius: 3,
  color: '#fff',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  minWidth: 42,
  textAlign: 'center',
  flexShrink: 0,
}
const ID_TEXT = {
  flex: 1,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const STATUS_TEXT = { color: '#888', fontStyle: 'italic', fontSize: 13 }
const ERR_TEXT = { color: 'crimson', fontSize: 12, padding: 4 }

const ADD_BTN = {
  display: 'block',
  width: '100%',
  padding: '6px 10px',
  margin: '0 0 8px',
  border: '1px dashed #2da44e',
  borderRadius: 4,
  background: '#f6fcf8',
  color: '#2da44e',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
}
const DIALOG = {
  padding: 8,
  margin: '0 0 10px',
  border: '1px solid #d0d7de',
  borderRadius: 4,
  background: '#fafbfc',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}
const DIALOG_INPUT = {
  padding: '4px 8px',
  border: '1px solid #d0d7de',
  borderRadius: 3,
  fontSize: 12,
  fontFamily: 'ui-monospace, monospace',
}
const DIALOG_BTN_ROW = { display: 'flex', gap: 6, justifyContent: 'flex-end' }
const DIALOG_BTN_PRIMARY = {
  padding: '4px 12px',
  border: '1px solid #2da44e',
  borderRadius: 3,
  background: '#2da44e',
  color: '#fff',
  fontSize: 12,
  cursor: 'pointer',
}
const DIALOG_BTN_CANCEL = {
  padding: '4px 12px',
  border: '1px solid #d0d7de',
  borderRadius: 3,
  background: '#fff',
  color: '#333',
  fontSize: 12,
  cursor: 'pointer',
}
const TYPES = ['text', 'input', 'button', 'table', 'chart']

const DELETE_X_BTN = {
  border: 'none',
  background: 'transparent',
  color: '#888',
  cursor: 'pointer',
  fontSize: 14,
  padding: '0 4px',
  lineHeight: 1,
  visibility: 'hidden',
}

export function WidgetTree({ screenId, selectedWidgetId, onSelect }) {
  const [widgets, setWidgets] = useState(null)
  const [error, setError] = useState(null)

  // Add-widget dialog state
  const [showAdd, setShowAdd] = useState(false)
  const [newType, setNewType] = useState('text')
  const [newId, setNewId] = useState('')
  const [busy, setBusy] = useState(false)
  const [addError, setAddError] = useState(null)

  // Drag-and-drop state
  const dragId = useRef(null)
  const [dragOverId, setDragOverId] = useState(null)

  const refresh = () =>
    fetchScreen(screenId)
      .then((d) => setWidgets(d.widgets))
      .catch((e) => setError(String(e.message || e)))

  useEffect(() => {
    if (!screenId) return
    let cancelled = false
    fetchScreen(screenId)
      .then((d) => {
        if (!cancelled) setWidgets(d.widgets)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e.message || e))
      })
    return () => {
      cancelled = true
    }
  }, [screenId])

  const deleteWidget = async (widgetId, e) => {
    e.stopPropagation()
    if (!confirm(`Delete widget '${widgetId}'? This cannot be undone.`)) return
    try {
      const r = await fetch(
        `/api/widget/${encodeURIComponent(screenId)}/${encodeURIComponent(widgetId)}`,
        { method: 'DELETE' },
      )
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${r.status}`)
      }
      // Clear selection if the deleted widget was selected
      if (selectedWidgetId === widgetId && onSelect) onSelect(null)
      await refresh()
    } catch (e) {
      setError(`delete: ${String(e.message || e)}`)
    }
  }

  const createWidget = async () => {
    const wid = newId.trim()
    if (!wid) {
      setAddError('widget_id required')
      return
    }
    setBusy(true)
    setAddError(null)
    try {
      const r = await fetch('/api/widget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screen_id: screenId, widget_id: wid, type: newType }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${r.status}`)
      }
      await refresh()
      setShowAdd(false)
      setNewId('')
      setNewType('text')
      if (onSelect) onSelect(wid)
    } catch (e) {
      setAddError(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const saveOrder = async (ordered) => {
    try {
      await fetch(`/api/screen/order?screen_id=${encodeURIComponent(screenId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widget_ids: ordered.map((w) => w.widget_id) }),
      })
    } catch (_) { /* best-effort */ }
  }

  const onDragStart = (e, widgetId) => {
    dragId.current = widgetId
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = (e, widgetId) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (widgetId !== dragId.current) setDragOverId(widgetId)
  }

  const onDrop = (e, targetId) => {
    e.preventDefault()
    setDragOverId(null)
    const from = dragId.current
    dragId.current = null
    if (!from || from === targetId || !widgets) return
    const list = [...widgets]
    const fromIdx = list.findIndex((w) => w.widget_id === from)
    const toIdx = list.findIndex((w) => w.widget_id === targetId)
    if (fromIdx === -1 || toIdx === -1) return
    list.splice(toIdx, 0, list.splice(fromIdx, 1)[0])
    setWidgets(list)
    saveOrder(list)
  }

  const onDragEnd = () => {
    dragId.current = null
    setDragOverId(null)
  }

  return (
    <div className="editor-pad">
      <div className="editor-section-label">Widgets</div>

      {!showAdd && (
        <button style={ADD_BTN} onClick={() => setShowAdd(true)}>
          + Add Widget
        </button>
      )}
      {showAdd && (
        <div style={DIALOG}>
          <select
            style={DIALOG_INPUT}
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            disabled={busy}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input
            style={DIALOG_INPUT}
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createWidget()
              else if (e.key === 'Escape') setShowAdd(false)
            }}
            placeholder={`${newType}.new_widget`}
            disabled={busy}
            autoFocus
          />
          {addError && <div style={ERR_TEXT}>{addError}</div>}
          <div style={DIALOG_BTN_ROW}>
            <button
              style={DIALOG_BTN_CANCEL}
              onClick={() => { setShowAdd(false); setAddError(null) }}
              disabled={busy}
            >
              Cancel
            </button>
            <button style={DIALOG_BTN_PRIMARY} onClick={createWidget} disabled={busy}>
              {busy ? '…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {error && <div style={ERR_TEXT}>{error}</div>}
      {!widgets && !error && <div style={STATUS_TEXT}>loading…</div>}
      {widgets && widgets.length === 0 && (
        <div style={STATUS_TEXT}>no widgets on this screen</div>
      )}

      {widgets &&
        widgets.map((w) => {
          const isSelected = w.widget_id === selectedWidgetId
          const isDragOver = w.widget_id === dragOverId
          const style = isDragOver
            ? { ...ROW, ...ROW_DRAG_OVER }
            : isSelected
            ? { ...ROW, ...ROW_SELECTED }
            : ROW
          return (
            <div
              key={w.widget_id}
              draggable
              style={style}
              onClick={() => onSelect && onSelect(w.widget_id)}
              onDragStart={(e) => onDragStart(e, w.widget_id)}
              onDragOver={(e) => onDragOver(e, w.widget_id)}
              onDrop={(e) => onDrop(e, w.widget_id)}
              onDragEnd={onDragEnd}
              onMouseEnter={(e) => {
                const x = e.currentTarget.querySelector('button')
                if (x) x.style.visibility = 'visible'
              }}
              onMouseLeave={(e) => {
                const x = e.currentTarget.querySelector('button')
                if (x) x.style.visibility = 'hidden'
              }}
              title={`${w.type} · ${w.widget_id} — drag to reorder`}
            >
              <span style={DRAG_HANDLE} title="drag to reorder">⠿</span>
              <span
                style={{ ...BADGE, background: TYPE_COLORS[w.type] || '#888' }}
              >
                {w.type}
              </span>
              <span style={ID_TEXT}>{w.widget_id}</span>
              <button
                style={DELETE_X_BTN}
                onClick={(e) => deleteWidget(w.widget_id, e)}
                title={`Delete ${w.widget_id}`}
              >
                ×
              </button>
            </div>
          )
        })}
    </div>
  )
}
