// Input widget — controlled <input> with 300ms debounce on the onChange
// callback. The committed value is keyed by widget_id in the parent
// AppRenderer's params map, which is passed to every /render call so any
// widget's logic_code can read it.

import { useEffect, useRef, useState } from 'react'

const LABEL_STYLE = { fontSize: 13, color: '#444', marginRight: 8, minWidth: 90 }
const INPUT_STYLE = {
  padding: '4px 8px',
  border: '1px solid #ccc',
  borderRadius: 3,
  fontSize: 14,
  fontFamily: 'system-ui, sans-serif',
}
const ROW_STYLE = {
  margin: '6px 0',
  display: 'flex',
  alignItems: 'center',
  fontFamily: 'system-ui, sans-serif',
}

const DEBOUNCE_MS = 300

export function Input({ widgetId, config, onChange }) {
  // Initial value comes from the current paramsMap (passed via config.props.value)
  // or falls back to the declarative `default` in base_config.
  const initial =
    config && config.props && config.props.value !== undefined
      ? config.props.value
      : config && config.props && config.props.default !== undefined
        ? config.props.default
        : ''
  const [val, setVal] = useState(initial)
  const debounceRef = useRef(null)

  // Sync if config.props.value changes externally (e.g., a reset)
  useEffect(() => {
    setVal(initial)
    // We intentionally only re-sync when `initial` changes — local typing
    // shouldn't trigger this. The ref-derived `initial` does the right thing.
  }, [initial])

  // Cancel any pending debounce on unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

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
        Input error: {config.error.message || JSON.stringify(config.error)}
      </div>
    )
  }

  const label = (config && config.props && config.props.label) || ''
  const kind = (config && config.props && config.props.kind) || 'text'

  const handleChange = (e) => {
    const next = e.target.value
    setVal(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (typeof onChange === 'function') onChange(widgetId, next)
    }, DEBOUNCE_MS)
  }

  return (
    <div style={ROW_STYLE}>
      {label && <label style={LABEL_STYLE}>{label}</label>}
      <input
        type={kind === 'date' ? 'date' : kind}
        value={val}
        onChange={handleChange}
        style={INPUT_STYLE}
      />
    </div>
  )
}
