// LivePreview — iframe pointed at /app?screen=X, plus an EventSource
// subscription to /api/events. When the backend emits a 'widget-changed'
// event for the current screen, the iframe reloads so the dev sees their
// /save effect immediately.

import { useEffect, useRef } from 'react'

const HEADER = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  borderBottom: '1px solid #e1e4e8',
  background: '#f7f8fa',
  fontSize: 11,
  color: '#666',
  flexShrink: 0,
}
const HEADER_PATH = {
  fontFamily: 'ui-monospace, monospace',
  fontSize: 11,
  color: '#888',
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

export function LivePreview({ screenId }) {
  const iframeRef = useRef(null)

  useEffect(() => {
    if (!screenId) return

    const es = new EventSource('/api/events')

    const handler = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.screen_id === screenId && iframeRef.current) {
          // Reload the iframe — setting src to itself triggers a fresh load
          const node = iframeRef.current
          node.src = node.src
        }
      } catch (_) {
        // ignore malformed event payloads
      }
    }

    es.addEventListener('widget-changed', handler)
    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do here
    }

    return () => {
      es.removeEventListener('widget-changed', handler)
      es.close()
    }
  }, [screenId])

  if (!screenId) {
    return <div style={EMPTY}>No screen specified</div>
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={HEADER}>
        <span className="editor-section-label" style={{ margin: 0 }}>
          Live preview
        </span>
        <span style={HEADER_PATH}>
          /app?screen={screenId}
        </span>
      </div>
      <iframe
        ref={iframeRef}
        src={`/app?screen=${encodeURIComponent(screenId)}`}
        title="LogicLive preview"
        style={{
          flex: 1,
          minHeight: 0,
          border: 'none',
          background: '#fff',
        }}
      />
    </div>
  )
}
