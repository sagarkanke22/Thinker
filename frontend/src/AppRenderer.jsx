// AppRenderer — the generic SDUI client.
//   1. Read ?screen=<id> from the URL
//   2. Fetch /api/screen → list of {widget_id, type}
//   3. For each widget, fetch /api/render → dispatch to registered component
//   4. Hold a params map (widget_id → value). When any Input widget calls
//      onChange, update the map and re-fetch all widgets' renders with the
//      new params so any dependent widget reflects the change.
//
// The frontend is intentionally generic — it knows nothing about specific
// widgets. Component-specific rendering lives in widgets/*.jsx, registered
// in widgets/index.js.

import { useCallback, useEffect, useState } from 'react'
import { fetchScreen, renderWidget } from './api/client.js'
import { getWidgetComponent } from './widgets/index.js'

function getScreenIdFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('screen')
}

export default function AppRenderer() {
  const screenId = getScreenIdFromUrl()
  const [widgets, setWidgets] = useState(null)
  const [renders, setRenders] = useState({})
  const [paramsMap, setParamsMap] = useState({})
  const [error, setError] = useState(null)

  // Step 1: load the screen's widget list once
  useEffect(() => {
    if (!screenId) return
    fetchScreen(screenId)
      .then((data) => setWidgets(data.widgets))
      .catch((e) => setError(String(e.message || e)))
  }, [screenId])

  // Step 2: whenever widgets or paramsMap change, fetch /render for each.
  // [C016] each /render call = fresh sandbox subprocess; safe to call in
  // parallel for all widgets on the screen.
  useEffect(() => {
    if (!widgets) return
    widgets.forEach((w) => {
      renderWidget(screenId, w.widget_id, paramsMap)
        .then((cfg) => {
          // For inputs: also inject the current value into props so the
          // controlled component renders the committed value instead of
          // reverting to `default`.
          if (w.type === 'input' && paramsMap[w.widget_id] !== undefined) {
            cfg.props = { ...(cfg.props || {}), value: paramsMap[w.widget_id] }
          }
          setRenders((prev) => ({ ...prev, [w.widget_id]: cfg }))
        })
        .catch((e) =>
          setRenders((prev) => ({
            ...prev,
            [w.widget_id]: {
              type: w.type,
              error: { type: 'fetch', message: String(e.message || e) },
            },
          })),
        )
    })
  }, [widgets, screenId, paramsMap])

  // Input widgets call this when their debounced value commits
  const onParamChange = useCallback((widgetId, value) => {
    setParamsMap((prev) => ({ ...prev, [widgetId]: value }))
  }, [])

  if (!screenId) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h2>No screen specified</h2>
        <p>
          Append <code>?screen=&lt;screen_id&gt;</code> to the URL. Try{' '}
          <a href="?screen=sales_report">?screen=sales_report</a>.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 24, color: 'crimson', fontFamily: 'system-ui, sans-serif' }}>
        Error loading screen <code>{screenId}</code>: {error}
      </div>
    )
  }

  if (!widgets) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        Loading <code>{screenId}</code>…
      </div>
    )
  }

  const inputWidgets = widgets.filter((w) => w.type === 'input' || w.type === 'button')
  const contentWidgets = widgets.filter((w) => w.type !== 'input' && w.type !== 'button')

  function WidgetCard({ w }) {
    const Component = getWidgetComponent(w.type)
    const cfg = renders[w.widget_id] || { loading: true, type: w.type }
    return (
      <div style={{
        background: '#fff',
        border: '1px solid #e1e4e8',
        borderRadius: 10,
        boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
        padding: '18px 20px',
        minWidth: 0,
      }}>
        <Component
          widgetId={w.widget_id}
          type={w.type}
          config={cfg}
          screenId={screenId}
          onChange={onParamChange}
        />
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f4f5f7',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Page header */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e1e4e8',
        padding: '14px 28px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: 1, color: '#8b949e' }}>Report</span>
        <span style={{ color: '#d0d7de', fontSize: 14 }}>›</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1f2328', letterSpacing: 0.2 }}>
          {screenId.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Controls row — input + button widgets */}
      {inputWidgets.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          padding: '14px 28px 0',
          flexWrap: 'wrap',
        }}>
          {inputWidgets.map((w) => (
            <WidgetCard key={w.widget_id} w={w} />
          ))}
        </div>
      )}

      {/* Main content — charts, tables, text */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: 28,
      }}>
        {contentWidgets.map((w) => (
          <WidgetCard key={w.widget_id} w={w} />
        ))}
      </div>
    </div>
  )
}
