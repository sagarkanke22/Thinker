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
const MODE_SELECT = {
  fontSize: 11,
  fontFamily: 'system-ui, sans-serif',
  padding: '2px 6px',
  border: '1px solid #d0d7de',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
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
const COPY_INLINE_BTN = {
  border: '1px solid #d0d7de',
  background: '#fff',
  color: '#555',
  cursor: 'pointer',
  fontSize: 10,
  fontFamily: 'inherit',
  padding: '1px 6px',
  borderRadius: 3,
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
const APPLY_SUGG_BTN = {
  ...APPLY_BTN,
  border: '1px solid #8957e5',
  background: '#8957e5',
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
  // Lenient: handles `event: foo`, `event:foo`, CRLF line endings, and
  // multi-line data per the SSE spec (multiple `data:` lines joined with \n).
  const lines = frame.split(/\r?\n/)
  let event = 'message'
  const dataParts = []
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trimStart().trimEnd()
    } else if (line.startsWith('data:')) {
      const chunk = line.slice(5)
      dataParts.push(chunk.startsWith(' ') ? chunk.slice(1) : chunk)
    }
  }
  const data = dataParts.join('\n')
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
    // [L039] SSE frame separator MUST be /\r?\n\r?\n/ to handle CRLF streams
    // from Anthropic. Literal '\n\n'.split silently fails because the two
    // \n chars in '\r\n\r\n' are not consecutive.
    const frames = buf.split(/\r?\n\r?\n/)
    buf = frames.pop() || ''
    for (const frame of frames) {
      const ev = parseSSEFrame(frame)
      if (ev) onEvent(ev)
    }
  }
  if (buf.trim()) {
    const ev = parseSSEFrame(buf)
    if (ev) onEvent(ev)
  }
}

// ─── component ─────────────────────────────────────────────────────

const MODE_HINTS = {
  generate: 'e.g. "fetch sales from the orders table grouped by product"',
  explain: 'e.g. "explain what this widget does"',
  review: 'e.g. "review for bugs and edge cases"',
  optimize: 'e.g. "suggest performance improvements"',
}

// SSE through Vite's dev proxy buffers the response, so the stream never
// arrives at the browser. Hit the FastAPI backend directly for the
// streaming endpoint only. CORSMiddleware in app.py allows :5173 origin.
// Non-streaming calls (/api/save, /api/logic) keep using the proxy.
const SSE_BACKEND_BASE =
  import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'

// Small inline copy-to-clipboard control. Used in the proposed-code
// block header so the user can grab the generated code without
// click-drag-select.
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (_) {
      /* clipboard API may fail in non-secure contexts; ignore */
    }
  }
  return (
    <button style={COPY_INLINE_BTN} onClick={handleCopy} title="Copy to clipboard">
      {copied ? '✓ Copied' : '⧉ Copy'}
    </button>
  )
}

// localStorage key per (screen_id, widget_id) — per-widget multi-turn
// history. Source of truth for the WIDGET'S CODE is still logic_code in
// the DB; this is just the conversation log that produced it.
const HISTORY_KEY = (screenId, widgetId) =>
  `logiclive_chat:${screenId || '_'}:${widgetId || '_'}`
const MAX_HISTORY_SENT = 10 // turns sent to backend; clipped to keep prompt bounded

export function ChatPanel({ screenId, widgetId, prefill = '' }) {
  const [prompt, setPrompt] = useState('')
  // history: [{role: 'user'|'assistant', content, mode?, applied?}]
  // Multi-turn — survives widget switch + page refresh via localStorage.
  const [history, setHistory] = useState([])
  const [phase, setPhase] = useState('idle') // idle | streaming | applying | error
  const [errMsg, setErrMsg] = useState(null)
  const [mode, setMode] = useState('generate') // generate | explain | review | optimize
  const [streamingIdx, setStreamingIdx] = useState(null)
  const scrollRef = useRef(null)

  // Load history for this widget from localStorage when widget changes.
  // ORDER MATTERS: this must run BEFORE the prefill effect so its
  // setPrompt('') doesn't wipe the prefill on first mount. React fires
  // effects in source order; the later setPrompt call wins.
  useEffect(() => {
    setPrompt('')
    setPhase('idle')
    setErrMsg(null)
    setStreamingIdx(null)
    if (!widgetId) {
      setHistory([])
      return
    }
    try {
      const saved = localStorage.getItem(HISTORY_KEY(screenId, widgetId))
      setHistory(saved ? JSON.parse(saved) : [])
    } catch (_) {
      setHistory([])
    }
  }, [screenId, widgetId])

  // One-shot prefill from /plan's BuildButton (?prefill=...). Drop it
  // into the prompt input on first render only. Runs AFTER the widget-
  // change effect so its setPrompt(prefill) overrides the clear above.
  useEffect(() => {
    if (prefill) setPrompt(prefill)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist whenever history changes (best-effort).
  useEffect(() => {
    if (!widgetId) return
    try {
      localStorage.setItem(
        HISTORY_KEY(screenId, widgetId),
        JSON.stringify(history),
      )
    } catch (_) {
      /* quota errors etc — ignore */
    }
  }, [screenId, widgetId, history])

  // Auto-scroll on update
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [history, phase])

  const send = async (overridePrompt = null, overrideMode = null) => {
    // Accepts optional overrides so programmatic flows (e.g. the
    // "Apply suggestions →" button on a review) can send without
    // touching the input field or waiting for setState to flush.
    const userPrompt = (overridePrompt ?? prompt).trim()
    const useMode = overrideMode ?? mode
    if (!userPrompt || !widgetId) return
    if (overridePrompt == null) setPrompt('')
    setErrMsg(null)
    setPhase('streaming')

    // Snapshot the history sent to backend BEFORE we append new turn,
    // clipped to last MAX_HISTORY_SENT entries. mode is included so
    // labels in CONVERSATION SO FAR are unambiguous (see [L040]).
    const historyForBackend = history.slice(-MAX_HISTORY_SENT).map((m) => ({
      role: m.role,
      content: m.content,
      mode: m.mode,
    }))

    // Append user message + placeholder assistant message we'll fill as
    // tokens arrive. assistantIdx is where streamed text lands.
    let assistantIdx
    setHistory((prev) => {
      const userTurn = { role: 'user', content: userPrompt, mode: useMode }
      const assistantTurn = { role: 'assistant', content: '', mode: useMode }
      assistantIdx = prev.length + 1
      setStreamingIdx(assistantIdx)
      return [...prev, userTurn, assistantTurn]
    })

    try {
      await streamSSEPost(
        `${SSE_BACKEND_BASE}/ai/generate`,
        {
          screen_id: screenId,
          widget_id: widgetId,
          prompt: userPrompt,
          mode: useMode,
          history: historyForBackend,
        },
        (ev) => {
          const d = ev.data || {}
          if (ev.event === 'token' || (ev.event === 'message' && d.text !== undefined)) {
            const addText = d.text || ''
            if (d.retry) {
              // [C019] retry — replace the placeholder content
              setHistory((prev) => {
                const copy = [...prev]
                if (copy[assistantIdx]) copy[assistantIdx] = { ...copy[assistantIdx], content: addText }
                return copy
              })
            } else {
              setHistory((prev) => {
                const copy = [...prev]
                if (copy[assistantIdx]) {
                  copy[assistantIdx] = { ...copy[assistantIdx], content: (copy[assistantIdx].content || '') + addText }
                }
                return copy
              })
            }
          } else if (ev.event === 'done' || (ev.event === 'message' && d.full_text !== undefined)) {
            // Done — replace with the canonical full_text just in case
            // we missed any tokens (rare, but possible).
            if (d.full_text) {
              setHistory((prev) => {
                const copy = [...prev]
                if (copy[assistantIdx]) copy[assistantIdx] = { ...copy[assistantIdx], content: d.full_text }
                return copy
              })
            }
            setPhase('idle')
            setStreamingIdx(null)
          } else if (ev.event === 'error' || (ev.event === 'message' && d.message !== undefined)) {
            setErrMsg(d.message || 'AI error')
            setPhase('error')
            setStreamingIdx(null)
          }
        },
      )
    } catch (e) {
      setErrMsg(String(e.message || e))
      setPhase('error')
      setStreamingIdx(null)
    }
  }

  const apply = async (idx) => {
    const msg = history[idx]
    if (!msg || msg.role !== 'assistant' || !msg.content || !widgetId) return
    setPhase('applying')
    setErrMsg(null)
    try {
      const r = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screen_id: screenId,
          widget_id: widgetId,
          logic_code: msg.content,
        }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${r.status}`)
      }
      // Mark applied on the message + add a small system note
      setHistory((prev) => {
        const copy = [...prev]
        if (copy[idx]) copy[idx] = { ...copy[idx], applied: true }
        return [...copy, { role: 'system', content: 'Applied ✓ — preview will refresh' }]
      })
      setPhase('idle')
    } catch (e) {
      setErrMsg(String(e.message || e))
      setPhase('error')
    }
  }

  // Trigger a follow-up generate turn that asks the AI to rewrite the
  // code addressing every bullet from a prior review/optimize message.
  // The full history is already sent to the backend, so the AI sees
  // the bullets as part of CONVERSATION SO FAR.
  const applySuggestions = (idx) => {
    const m = history[idx]
    if (!m || m.role !== 'assistant') return
    const noun =
      m.mode === 'review'
        ? 'review'
        : m.mode === 'optimize'
        ? 'optimization suggestions'
        : 'suggestions'
    const promptText =
      `Rewrite the prior render(params) function addressing every bullet from your ${noun} above. ` +
      `Respect the SANDBOX RULES — no import statements (sqlite3, json, math, datetime, statistics are pre-injected; ` +
      `use datetime.datetime.* forms). Output ONLY the corrected Python function.`
    setMode('generate')
    send(promptText, 'generate')
  }

  const clearHistory = () => {
    if (!widgetId) return
    if (!confirm('Clear chat history for this widget?')) return
    setHistory([])
    setPrompt('')
    setErrMsg(null)
    try {
      localStorage.removeItem(HISTORY_KEY(screenId, widgetId))
    } catch (_) {}
  }

  if (!widgetId) {
    return (
      <div className="editor-pad editor-stub">
        Select a widget on the left to chat about its logic
      </div>
    )
  }

  const isBusy = phase === 'streaming' || phase === 'applying'

  return (
    <div style={COL}>
      <div style={HEADER}>
        <span className="editor-section-label" style={{ margin: 0 }}>
          AI Chat
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            style={MODE_SELECT}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            disabled={isBusy}
            title="Mode determines whether the AI writes code or prose"
          >
            <option value="generate">Generate (code)</option>
            <option value="explain">Explain</option>
            <option value="review">Review</option>
            <option value="optimize">Optimize</option>
          </select>
          {history.length > 0 && (
            <button
              onClick={clearHistory}
              disabled={isBusy}
              title="Clear chat history for this widget"
              style={{
                fontSize: 11,
                padding: '2px 6px',
                border: '1px solid #d0d7de',
                borderRadius: 3,
                background: '#fff',
                color: '#666',
                cursor: 'pointer',
              }}
            >
              clear
            </button>
          )}
          <span style={WIDGET_BADGE}>{widgetId}</span>
        </div>
      </div>

      <div ref={scrollRef} style={TRANSCRIPT}>
        {history.length === 0 && (
          <div style={EMPTY_HINT}>
            {mode === 'generate'
              ? "Ask the AI to write or modify this widget's logic."
              : mode === 'explain'
              ? 'Ask the AI to explain what this widget does.'
              : mode === 'review'
              ? 'Ask the AI to review the widget for issues.'
              : 'Ask the AI to suggest improvements to this widget.'}
            <br />
            <em>{MODE_HINTS[mode]}</em>
          </div>
        )}

        {history.map((m, i) => {
          if (m.role === 'system') {
            return <div key={i} style={MSG_SYS}>{m.content}</div>
          }
          if (m.role === 'user') {
            return (
              <div key={i} style={MSG_USER}>
                {m.mode && m.mode !== 'generate' && (
                  <span style={{ fontSize: 10, color: '#888', marginRight: 6 }}>
                    [{m.mode}]
                  </span>
                )}
                › {m.content}
              </div>
            )
          }
          // assistant
          const turnMode = m.mode || 'generate'
          const isStreamingThis = i === streamingIdx
          const showApply = turnMode === 'generate' && m.content && !m.applied && !isStreamingThis
          const showApplySuggestions =
            (turnMode === 'review' || turnMode === 'optimize') &&
            m.content &&
            !isStreamingThis &&
            !isBusy
          return (
            <div key={i} style={PROPOSED_BLOCK}>
              <div style={PROPOSED_HEADER}>
                <span>
                  {isStreamingThis ? '⏳ streaming…' : m.applied ? '✅ applied' : '✨ proposed'}
                  {turnMode !== 'generate' && (
                    <span style={{ marginLeft: 6, color: '#888' }}>({turnMode})</span>
                  )}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, color: '#888' }}>
                    {(m.content || '').length} chars
                  </span>
                  {m.content && !isStreamingThis && (
                    <CopyButton text={m.content} />
                  )}
                </span>
              </div>
              <pre style={CODE_BLOCK}>{m.content || '…thinking'}</pre>
              {showApply && (
                <button style={APPLY_BTN} onClick={() => apply(i)}>
                  Apply →
                </button>
              )}
              {showApplySuggestions && (
                <button
                  style={APPLY_SUGG_BTN}
                  onClick={() => applySuggestions(i)}
                  title="Ask the AI to rewrite the code addressing every bullet above"
                >
                  Apply suggestions →
                </button>
              )}
            </div>
          )
        })}

        {/* Streaming indicator when no tokens have arrived yet for current turn */}
        {phase === 'streaming' && streamingIdx !== null && !history[streamingIdx]?.content && (
          <div style={{ ...MSG_SYS, color: '#888' }}>⏳ waiting for first token…</div>
        )}
        {phase === 'applying' && (
          <div style={{ ...MSG_SYS, color: '#888' }}>💾 applying…</div>
        )}
        {errMsg && <div style={ERR}>{errMsg}</div>}
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
          disabled={isBusy}
        />
        <button
          style={SEND_BTN}
          onClick={send}
          disabled={!prompt.trim() || isBusy}
        >
          {phase === 'streaming' ? '…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
