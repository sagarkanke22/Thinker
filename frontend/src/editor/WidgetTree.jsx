// WidgetTree — lists the widgets that make up the current screen.
// Clicking a widget calls onSelect(widget_id) which the Editor uses to
// drive the CodeEditor (Step 16) and ChatPanel (Step 21).

import { useEffect, useState } from 'react'
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
}
const ROW_SELECTED = { background: '#eaf3ff' }
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

export function WidgetTree({ screenId, selectedWidgetId, onSelect }) {
  const [widgets, setWidgets] = useState(null)
  const [error, setError] = useState(null)

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

  return (
    <div className="editor-pad">
      <div className="editor-section-label">Widgets</div>

      {error && <div style={ERR_TEXT}>{error}</div>}
      {!widgets && !error && <div style={STATUS_TEXT}>loading…</div>}
      {widgets && widgets.length === 0 && (
        <div style={STATUS_TEXT}>no widgets on this screen</div>
      )}

      {widgets &&
        widgets.map((w) => {
          const isSelected = w.widget_id === selectedWidgetId
          const style = isSelected ? { ...ROW, ...ROW_SELECTED } : ROW
          return (
            <div
              key={w.widget_id}
              style={style}
              onClick={() => onSelect && onSelect(w.widget_id)}
              title={`${w.type} · ${w.widget_id}`}
            >
              <span
                style={{ ...BADGE, background: TYPE_COLORS[w.type] || '#888' }}
              >
                {w.type}
              </span>
              <span style={ID_TEXT}>{w.widget_id}</span>
            </div>
          )
        })}
    </div>
  )
}
