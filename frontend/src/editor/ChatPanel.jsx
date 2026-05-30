// ChatPanel — AI chat scoped to the currently-selected widget.
//
// Flow:
//   1. User types a request, hits Enter (or Send)
//   2. POST /api/ai/generate with {screen_id, widget_id, prompt}
//   3. Stream SSE tokens into the "proposed" code block
//   4. On 'done', show Apply button
//   5. Apply → POST /api/save → SSE widget-changed event → LivePreview reloads
//
// [C019] Retry tokens (marked retry:true) clear and re-stream the proposed
// buffer so the user only sees the final correct attempt.
//
// [C015] This component only ever writes logic_code via /api/save —
// base_config is human-only.

import { useEffect, useRef, useState } from 'react'

// ─── styles ────────────────────────────────────────────────────────

const COL = { display: 'flex', flexDirection: 'column', height: '100%' }
const HEADER = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '6px 12px',
  borderBottom: '1px solid #e1e4e8',
  background: '#f7f8fa',
  flexShrink: 0,
}
const WIDGET_BADGE = {
  fontSize: 11,
  fontFamily: 'ui-monospace, monospace',
  color: '#888',
}
const TRANSCRIPT = {
  flex: 1,
  overflowY: 'auto',
  padding: 10,
  background: '#fff',
  minHeight: 0,
}
const EMPTY_HINT = {
  color: '#aaa',
  fontStyle: 'italic',
  fontSize: 13,
  padding: 8,
  lineHeight: 1.5,
}
const MSG_USER = {
  padding: '6px 10px',
  margin: '6px 0',
  background: '#eaf3ff',
  borderRadius: 8,
  fontSize: 13,
  lineHeight: 1.4,
}
const MSG_SYS = {
  padding: '4px 10px',
  margin: '4px 0',
  color: '#2da44e',
  fontSize: 12,
  fontStyle: 'italic',
}
const PROPOSED_BLOCK = {
  margin: '8px 0',
  border: '1px solid #d0d7de',
  borderRadius: 6,
  background: '#fafbfc',
}
const PROPOSED_HEADER = {
  padding: '4px 10px',
  fontSize: 11,
  color: '#666',
  borderBottom: '1px solid #d0d7de',
  background: '#f4f4f8',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}
const CODE_BLOCK = {
  margin: 0,
  padding: 10,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 280,
  overflowY: 'auto',
}
const APPLY_BTN = {
  display: 'block',
  margin: '6px 10px 10px',
  padding: '4px 12px',
  border: '1px solid #2da44e',
  borderRadius: 4,
  background: '#2da44e',
  color: '#fff',
  fontSize: 12,
  fontFamily: 'system-ui, sans-serif',
  cursor: 'pointer',
}
const ERR = { padding: '6px 10px', color: 'crimson', fontSize: 12 }
const INPUT_ROW = {
  display: 'flex',
  gap: 6,
  padding: 8,
  borderTop: '1px solid #e1e4e8',
  background: '#f7f8fa',
  flexShrink: 0,
}
const INPUT = {
  flex: 1,
  padding: '6px 10px',
  border: '1px solid #d0d7de',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'system-ui, sans-serif',
}
const SEND_BTN = {
  padding: '6px 14px',
  border: '1px solid #1f6feb',
  borderRadius: 4,
  background: '#1f6feb',
  color: '#fff',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif',
}

// ─── SSE-over-POST helper ──────────────────────────────────────────

function parseSSEFrame(frame) {
  const lines = frame.split('\n')
  let event = 'message'
  let data = ''
  for (const line of lines) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) data += line.slice(6)
  }
  if (!data) return null
  try {
    return { event, data: JSON.parse(data) }
  } catch (_) {
    return { event, data }
  }
}

async function streamSSEPost(url, body, onEvent) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}))
    throw new Error(detail.detail || `HTTP ${r.status}`)
  }
  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const frames = buf.split('\n\n')
    buf = frames.pop() || ''
    for (const frame of frames) {
      const ev = parseSSEFrame(frame)
      if (ev) onEvent(ev)
    }
  }
  // Flush any trailing frame
  if (buf.trim()) {
    const ev = parseSSEFrame(buf)
    if (ev) onEvent(ev)
  }
}

// ─── component ─────────────────────────────────────────────────────

export function ChatPanel({ screenId, widgetId }) {
  const [prompt, setPrompt] = useState('')
  const [proposed, setProposed] = useState('')
  const [phase, setPhase] = useState('idle') // idle | streaming | done | applying | applied | error
  const [errMsg, setErrMsg] = useState(null)
  const [transcript, setTranscript] = useState([]) // [{role, text}]
  const scrollRef = useRef(null)

  // Reset everything when widget changes
  useEffect(() => {
    setPrompt('')
    setProposed('')
    setPhase('idle')
    setErrMsg(null)
    setTranscript([])
  }, [screenId, widgetId])

  // Auto-scroll transcript on update
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [transcript, proposed, phase])

  const send = async () => {
    const userPrompt = prompt.trim()
    if (!userPrompt || !widgetId) return
    setPrompt('')
    setTranscript((prev) => [...prev, { role: 'user', text: userPrompt }])
    setProposed('')
    setPhase('streaming')
    setErrMsg(null)

    try {
      await streamSSEPost(
        '/api/ai/generate',
        { screen_id: screenId, widget_id: widgetId, prompt: userPrompt },
        (ev) => {
          if (ev.event === 'token') {
            if (ev.data && ev.data.retry) {
              // [C019] retry started — discard the bad first attempt
              setProposed(ev.data.text || '')
            } else {
              setProposed((p) => p + (ev.data?.text || ''))
            }
          } else if (ev.event === 'done') {
            setProposed(ev.data?.full_text || '')
            setPhase('done')
          } else if (ev.event === 'error') {
            setErrMsg(ev.data?.message || 'AI error')
            setPhase('error')
          }
        },
      )
    } catch (e) {
      setErrMsg(String(e.message || e))
      setPhase('error')
    }
  }

  const apply = async () => {
    if (!proposed || !widgetId) return
    setPhase('applying')
    setErrMsg(null)
    try {
      const r = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screen_id: screenId,
          widget_id: widgetId,
          logic_code: proposed,
        }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${r.status}`)
      }
      setPhase('applied')
      setTranscript((prev) => [...prev, { role: 'system', text: 'Applied ✓ — preview will refresh' }])
      // After a beat, allow another round
      setTimeout(() => setProposed(''), 600)
    } catch (e) {
      setErrMsg(String(e.message || e))
      setPhase('error')
    }
  }

  if (!widgetId) {
    return (
      <div className="editor-pad editor-stub">
        Select a widget on the left to chat about its logic
      </div>
    )
  }

  let phaseLabel = ''
  if (phase === 'streaming') phaseLabel = '⏳ streaming…'
  else if (phase === 'done') phaseLabel = '✨ proposed'
  else if (phase === 'applying') phaseLabel = '💾 applying…'
  else if (phase === 'applied') phaseLabel = '✅ applied'
  else if (phase === 'error') phaseLabel = '⚠ error'

  return (
    <div style={COL}>
      <div style={HEADER}>
        <span className="editor-section-label" style={{ margin: 0 }}>
          AI Chat
        </span>
        <span style={WIDGET_BADGE}>{widgetId}</span>
      </div>

      <div ref={scrollRef} style={TRANSCRIPT}>
        {transcript.length === 0 && !proposed && (
          <div style={EMPTY_HINT}>
            Ask the AI to write or modify this widget's logic.
            <br />
            <em>
              e.g. "fetch sales from the orders table grouped by product"
            </em>
          </div>
        )}

        {transcript.map((t, i) => (
          <div key={i} style={t.role === 'user' ? MSG_USER : MSG_SYS}>
            {t.role === 'user' ? '› ' : ''}
            {t.text}
          </div>
        ))}

        {proposed && (
          <div style={PROPOSED_BLOCK}>
            <div style={PROPOSED_HEADER}>
              <span>{phaseLabel}</span>
              <span style={{ fontSize: 10, color: '#888' }}>
                {proposed.length} chars
              </span>
            </div>
            <pre style={CODE_BLOCK}>{proposed}</pre>
            {phase === 'done' && (
              <button style={APPLY_BTN} onClick={apply}>
                Apply →
              </button>
            )}
            {errMsg && <div style={ERR}>{errMsg}</div>}
          </div>
        )}
      </div>

      <div style={INPUT_ROW}>
        <input
          style={INPUT}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="ask the AI…"
          disabled={phase === 'streaming' || phase === 'applying'}
        />
        <button
          style={SEND_BTN}
          onClick={send}
          disabled={
            !prompt.trim() || phase === 'streaming' || phase === 'applying'
          }
        >
          {phase === 'streaming' ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
