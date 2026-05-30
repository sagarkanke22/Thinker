// Step 8 placeholder — replaced by real widget components in Steps 9-13.
// Shows the widget id, declared type, and the raw /render response so the
// dev can verify the pipeline end-to-end without any styling.

export function Placeholder({ widgetId, type, config }) {
  const isLoading = config && config.loading
  const hasError = config && config.error

  return (
    <div
      style={{
        border: '1px dashed #888',
        padding: 12,
        margin: '8px 0',
        fontFamily: 'system-ui, sans-serif',
        background: hasError ? '#fff0f0' : '#f7f8fa',
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>
        <strong>{widgetId}</strong> · type=<code>{type}</code>
        {isLoading && <span style={{ marginLeft: 8 }}>loading…</span>}
        {hasError && <span style={{ marginLeft: 8, color: 'crimson' }}>error</span>}
      </div>
      {!isLoading && (
        <pre
          style={{
            fontSize: 11,
            margin: 0,
            color: '#333',
            overflowX: 'auto',
          }}
        >
          {JSON.stringify(config, null, 2)}
        </pre>
      )}
    </div>
  )
}
