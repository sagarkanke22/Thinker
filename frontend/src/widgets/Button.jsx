// Button widget — on click, POSTs to /api/action which runs the widget's
// logic_code in a fresh sandbox. After the response, fires onChange with
// a synthetic '_action_tick' so AppRenderer re-fetches all widgets.

import { useState } from 'react'

const BTN_STYLE = {
  padding: '6px 16px',
  border: '1px solid #1f6feb',
  borderRadius: 4,
  background: '#1f6feb',
  color: '#fff',
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 14,
}
const BTN_DISABLED = { ...BTN_STYLE, opacity: 0.6, cursor: 'wait' }
const ROW_STYLE = { margin: '8px 0', fontFamily: 'system-ui, sans-serif' }

export function Button({ widgetId, config, screenId, onChange }) {
  const [pending, setPending] = useState(false)
  const [lastError, setLastError] = useState(null)

  if (config && config.error) {
    return (
      <div
        style={{
          color: 'crimson',
          margin: '8px 0',
          padding: '6px 10px',
          border: '1px solid #fbb',
          borderRadius: 4,
          background: '#fff0f0',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        Button error: {config.error.message || JSON.stringify(config.error)}
      </div>
    )
  }

  const label = (config && config.props && config.props.label) || 'Click'

  async function handleClick() {
    setPending(true)
    setLastError(null)
    try {
      const r = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screen_id: screenId,
          widget_id: widgetId,
          params: {},
        }),
      })
      const body = await r.json()
      if (!r.ok) {
        setLastError(body && body.detail ? body.detail : `HTTP ${r.status}`)
      } else if (body && body.ok === false) {
        setLastError(
          (body.error && body.error.message) || 'action returned ok=false',
        )
      } else if (typeof onChange === 'function') {
        // Trigger a re-fetch of every widget on the screen
        onChange('_action_tick', Date.now())
      }
    } catch (e) {
      setLastError(String(e.message || e))
    } finally {
      setPending(false)
    }
  }

  return (
    <div style={ROW_STYLE}>
      <button
        style={pending ? BTN_DISABLED : BTN_STYLE}
        onClick={handleClick}
        disabled={pending}
      >
        {pending ? '…' : label}
      </button>
      {lastError && (
        <span style={{ marginLeft: 10, color: 'crimson', fontSize: 13 }}>
          {lastError}
        </span>
      )}
    </div>
  )
}
