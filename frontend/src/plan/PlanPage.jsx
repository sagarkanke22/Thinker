// PlanPage — discovery chat at /plan, now with a left sidebar of saved
// conversations (Step 33). Persistence is DB-backed via /api/conversations.
//
// Flow:
//   - Mount: GET /api/conversations to populate sidebar
//   - Click row: GET /api/conversations/{id} to load full messages
//   - "+ New": clear state, activeId=null (lazy-create on first send)
//   - Send: if no activeId, POST /api/conversations first, then ask the
//     agents, then PUT /api/conversations/{id} with the updated array.
//     First user message also auto-sets the title.
//   - Delete (×): DELETE /api/conversations/{id}, refresh sidebar.
//
// SSE streaming still hits the backend directly (bypassing Vite proxy per
// [L039]); list/load/save are plain JSON through the proxy (works fine).

import { useEffect, useRef, useState } from 'react'
import '../styles/editor.css'

const SSE_BACKEND_BASE =
  import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'

const AGENTS = ['backend', 'frontend']
const DEFAULT_AGENT = 'backend'

// ─── styles ────────────────────────────────────────────────────────

const PAGE = {
  display: 'flex',
  height: '100%',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  background: '#0d1117',
}
const SIDEBAR = {
  width: 240,
  borderRight: '1px solid #21262d',
  background: '#161b22',
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
}
const SIDEBAR_HEADER = {
  padding: '12px 10px',
  borderBottom: '1px solid #21262d',
}
const NEW_BTN = {
  width: '100%',
  padding: '9px 10px',
  border: 'none',
  borderRadius: 8,
  background: 'linear-gradient(135deg, #238636 0%, #2ea043 100%)',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
  letterSpacing: 0.3,
  boxShadow: '0 0 0 1px rgba(46,160,67,0.4), 0 2px 8px rgba(46,160,67,0.2)',
}
const SIDEBAR_LIST = { flex: 1, overflowY: 'auto', padding: 6 }
const CONV_ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 10px',
  margin: '2px 0',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12,
  color: '#8b949e',
}
const CONV_ROW_ACTIVE = { background: '#1f2d3d', color: '#58a6ff' }
const CONV_TITLE = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const CONV_DELETE = {
  border: 'none',
  background: 'transparent',
  color: '#484f58',
  cursor: 'pointer',
  fontSize: 14,
  padding: '0 4px',
  visibility: 'hidden',
}
const CONV_EMPTY = {
  color: '#484f58',
  fontStyle: 'italic',
  fontSize: 12,
  padding: 10,
}

const MAIN = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  background: '#0d1117',
}

// ─── Steps side-panel styles (right column) ───────────────────────

const STEPS_PANEL = {
  width: 360,
  flexShrink: 0,
  borderLeft: '1px solid #21262d',
  background: '#161b22',
  overflowY: 'auto',
  padding: 16,
  boxSizing: 'border-box',
}
const STEPS_TITLE = {
  fontSize: 10,
  fontWeight: 700,
  color: '#6e7681',
  marginBottom: 14,
  paddingBottom: 10,
  borderBottom: '1px solid #21262d',
  letterSpacing: 1,
  textTransform: 'uppercase',
}
const STEP_CARD = {
  background: '#21262d',
  border: '1px solid #30363d',
  borderRadius: 10,
  padding: '12px 14px',
  position: 'relative',
  boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
}
const STEP_CARD_EMPTY = {
  ...STEP_CARD,
  background: '#161b22',
  borderStyle: 'dashed',
  borderColor: '#21262d',
  boxShadow: 'none',
}
const STEP_LABEL = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  color: '#6e7681',
  marginBottom: 8,
  fontWeight: 700,
}
const STEP_BODY = {
  fontSize: 13,
  color: '#c9d1d9',
  lineHeight: 1.5,
  wordBreak: 'break-word',
}
const STEP_BODY_MUTED = { ...STEP_BODY, color: '#484f58', fontStyle: 'italic' }
// Stacked field layout — label above value, much friendlier in a narrow
// column than the side-by-side grid (which truncated long SQL).
const STEP_FIELD = { marginTop: 8 }
const STEP_FIELD_KEY = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#6e7681',
  fontWeight: 600,
  marginBottom: 2,
}
const STEP_FIELD_VAL = {
  fontSize: 12,
  color: '#c9d1d9',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  overflowWrap: 'anywhere',
  lineHeight: 1.4,
}
const STEP_ARROW = {
  textAlign: 'center',
  color: '#8957e5',
  fontSize: 18,
  lineHeight: 1,
  margin: '6px 0',
  fontWeight: 600,
}
const STEP_BUILD_CARD = {
  ...STEP_CARD,
  background: 'linear-gradient(180deg, #0d2316 0%, #0f2f1a 100%)',
  borderColor: '#2ea043',
  boxShadow: '0 2px 12px rgba(46,160,67,0.2)',
}
const STEP_CODE_PRE = {
  margin: '8px 0 0',
  padding: '8px 10px',
  background: '#0d1117',
  color: '#c9d1d9',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 11,
  lineHeight: 1.5,
  borderRadius: 6,
  maxHeight: 110,
  overflow: 'auto',
  whiteSpace: 'pre',
  border: '1px solid #21262d',
}
const HEADER = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 20px',
  borderBottom: '1px solid #21262d',
  background: '#161b22',
}
const TITLE = { fontSize: 14, fontWeight: 700, color: '#c9d1d9', letterSpacing: 0.2 }
const NAV_LINK = { fontSize: 12, color: '#58a6ff', textDecoration: 'none' }
const TRANSCRIPT = {
  flex: 1,
  overflowY: 'auto',
  padding: '20px 32px',
  width: '100%',
  boxSizing: 'border-box',
}
const HINT = {
  color: '#6e7681',
  fontStyle: 'italic',
  fontSize: 13,
  lineHeight: 1.7,
  padding: '12px 0',
}
// All agent cards share the same neutral dark background.
// Identity comes from the colored left border + colored label, not bg tint.
const MSG_CARD = {
  margin: '12px 0',
  borderRadius: 10,
  fontSize: 14,
  lineHeight: 1.6,
  wordBreak: 'break-word',
  color: '#c9d1d9',
  background: '#161b22',
  border: '1px solid #21262d',
  overflow: 'hidden',
}
const MSG_USER = {
  ...MSG_CARD,
  background: '#12203a',
  border: '1px solid #1c3358',
  borderLeft: '3px solid #388bfd',
}
const MSG_BACKEND = {
  ...MSG_CARD,
  background: '#15120a',       // warm amber tint — clearly @backend
  border: '1px solid #2a2210',
  borderLeft: '3px solid #d29922',
}
const MSG_FRONTEND = {
  ...MSG_CARD,
  background: '#0b150d',       // cool green tint — clearly @frontend
  border: '1px solid #162118',
  borderLeft: '3px solid #3fb950',
}
// Reuse for context question cards (purple accent)
const MSG_CTX_Q_STYLE = {
  ...MSG_CARD,
  borderLeft: '3px solid #8957e5',
}

// Per-agent accent colors used in the header label
const AGENT_ACCENT = { backend: '#d29922', frontend: '#3fb950' }

// Header bar inside each agent card
const MSG_HEADER_BAR = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 14px',
  background: '#0d1117',
  borderBottom: '1px solid #21262d',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
}
// Content body inside the card
const MSG_BODY = { padding: '12px 16px' }
const ERR = { color: '#f85149', fontSize: 12, padding: '6px 0' }
const INPUT_BAR = {
  borderTop: '1px solid #21262d',
  padding: 14,
  background: '#161b22',
}
const INPUT_INNER = {
  display: 'flex',
  gap: 8,
}
const INPUT = {
  flex: 1,
  padding: '10px 14px',
  border: '1px solid #30363d',
  borderRadius: 8,
  fontSize: 14,
  fontFamily: 'inherit',
  resize: 'vertical',
  minHeight: 42,
  maxHeight: 200,
  background: '#21262d',
  color: '#e6edf3',
  outline: 'none',
  colorScheme: 'dark',
}
const SEND_BTN = {
  padding: '8px 20px',
  border: 'none',
  borderRadius: 8,
  background: 'linear-gradient(135deg, #1158d4 0%, #1f6feb 100%)',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  boxShadow: '0 0 0 1px rgba(31,111,235,0.4), 0 2px 6px rgba(31,111,235,0.25)',
}
const FINALIZE_BTN = {
  padding: '8px 14px',
  border: 'none',
  borderRadius: 8,
  background: 'linear-gradient(135deg, #6e40c9 0%, #8957e5 100%)',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  boxShadow: '0 0 0 1px rgba(137,87,229,0.4), 0 2px 6px rgba(137,87,229,0.25)',
}

// Synthesis prompts — kept here (not in agents.py) because they're a UI
// orchestration concern, not an agent personality. Both prompts ask the
// agent to produce a structured spec in its domain; the frontend prompt
// also emits the BUILD: hook + code draft so the user can click Build.
const FINALIZE_BACKEND_PROMPT =
  "Synthesize the final DATA SPEC for the widget we've been discussing. " +
  "Use EXACTLY this format (one line per field; write 'n/a' if unclear):\n\n" +
  "  SOURCE TABLE:\n" +
  "  COLUMNS USED:\n" +
  "  FILTERS:\n" +
  "  GROUPING:\n" +
  "  SQL APPROACH:\n" +
  "  NOTES:\n\n" +
  "Keep it tight. This is the handoff to the code-gen AI."

const FINALIZE_FRONTEND_PROMPT =
  "Synthesize the final UI SPEC for the widget. The @backend's DATA SPEC " +
  "is in the conversation above — use it.\n\n" +
  "Use EXACTLY this format:\n\n" +
  "  WIDGET TYPE:\n" +
  "  LAYOUT:\n" +
  "  KEY PROPS:\n" +
  "  NOTES:\n\n" +
  "Then emit the BUILD: hook (BUILD: type=..., id=...) followed by a " +
  "fenced ```python``` code draft of render(params) that combines the " +
  "data spec above with this UI spec. The code-gen AI in /editor will " +
  "save and refine your draft."
const TAG_HINT = { fontSize: 11, color: '#484f58', margin: '6px 0 0 4px' }

const BLOCKED_BADGE = {
  display: 'inline-block',
  background: '#3d1515',
  border: '1px solid #6e1c1c',
  borderRadius: 4,
  color: '#f85149',
  fontSize: 10,
  fontWeight: 700,
  padding: '1px 6px',
  marginLeft: 8,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  verticalAlign: 'middle',
}
const RESUME_BANNER = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 8,
  padding: '10px 14px',
  marginBottom: 16,
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  flexWrap: 'wrap',
  fontSize: 12,
}
const RESUME_LABEL = {
  color: '#6e7681', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: 0.6, fontSize: 10, flexShrink: 0,
}
const RESUME_Q = { color: '#c9d1d9', fontStyle: 'italic', flex: 1, minWidth: 0 }
const RESUME_TAG = {
  fontWeight: 600, borderRadius: 4, padding: '1px 7px',
  fontSize: 10, letterSpacing: 0.2, flexShrink: 0,
}
const RESUME_NEXT = { color: '#8b949e', fontSize: 11, flexShrink: 0 }

// Task context card (right panel — above pipeline)
const TASK_CTX_CARD = {
  background: '#1a1f2e',
  border: '1px solid #2d3561',
  borderLeft: '3px solid #58a6ff',
  borderRadius: 10,
  padding: '12px 14px',
  marginBottom: 14,
}
const TASK_CTX_TITLE = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: 1, color: '#58a6ff', marginBottom: 10,
}
const TASK_CTX_FIELD = { marginTop: 8 }
const TASK_CTX_KEY = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
  color: '#6e7681', fontWeight: 700, marginBottom: 3,
}
const TASK_CTX_VAL = { fontSize: 12, color: '#c9d1d9', lineHeight: 1.5 }
const TASK_CTX_CHIP = {
  display: 'inline-block', fontSize: 10, padding: '2px 7px',
  borderRadius: 4, marginRight: 4, marginTop: 3,
  background: '#21262d', border: '1px solid #30363d', color: '#8b949e',
}

// Alias — context question cards reuse the shared neutral style with purple accent
const MSG_CTX_Q = MSG_CTX_Q_STYLE
const CTX_Q_SECTION = {
  marginTop: 10, padding: '10px 12px',
  background: '#0d1117', borderRadius: 8,
  border: '1px solid #30363d',
}
const CTX_Q_LABEL = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: 0.8, color: '#8957e5', marginBottom: 8,
}
const CTX_Q_ITEM = {
  display: 'flex', gap: 10, alignItems: 'baseline',
  padding: '4px 0', fontSize: 13, color: '#c9d1d9',
}
const CTX_Q_NUM = {
  flexShrink: 0, width: 18, height: 18, borderRadius: '50%',
  background: '#8957e5', color: '#fff', fontSize: 10,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontWeight: 700,
}

// Interactive context form styles
const CTX_FORM_QUESTION = { marginBottom: 14 }
const CTX_FORM_INPUT = {
  width: '100%',
  padding: '7px 10px',
  border: '1px solid #30363d',
  borderRadius: 6,
  background: '#0d1117',
  color: '#e6edf3',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
  colorScheme: 'dark',
}
const CTX_FORM_BTN_GROUP = { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }
const CTX_FORM_TYPE_BTN = {
  padding: '5px 12px',
  border: '1px solid #30363d',
  borderRadius: 5,
  background: '#21262d',
  color: '#8b949e',
  fontSize: 12,
  cursor: 'pointer',
  fontWeight: 500,
}
const CTX_FORM_TYPE_BTN_ACTIVE = {
  ...CTX_FORM_TYPE_BTN,
  background: '#1a1225',
  border: '1px solid #8957e5',
  color: '#d2a8ff',
}
const CTX_FORM_SUBMIT = {
  marginTop: 14,
  padding: '7px 18px',
  border: 'none',
  borderRadius: 6,
  background: 'linear-gradient(135deg, #6e40c9 0%, #8957e5 100%)',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
  boxShadow: '0 0 0 1px rgba(137,87,229,0.3)',
}

// ─── SSE helpers ([L039] CRLF-safe) ────────────────────────────────

function parseSSEFrame(frame) {
  const lines = frame.split(/\r?\n/)
  let event = 'message'
  const dataParts = []
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
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

// ─── @mention parsing ──────────────────────────────────────────────

// Returns true when an assistant message hit a wall — has a SOLUTION PLAN
// or explicitly states impossibility in the ANSWER section.
// A message that ALSO has a BUILD hook is not blocked — it proposed a
// concrete solution and emitted buildable code.
function isBlockedMessage(content) {
  if (!content) return false
  if (parseBuildHook(content)) return false   // BUILD present → not blocked
  if (/SOLUTION PLAN\s*:/i.test(content)) return true
  const answerMatch = content.match(/ANSWER\s*:\s*\n?([\s\S]{0,500}?)(?=\n\s*[A-Z ]{4,}\s*:|$)/i)
  if (answerMatch) {
    const a = answerMatch[1].toLowerCase()
    if (/\b(not possible|cannot|can't|no .{1,30} exist|not available|does not exist|no data|no .{1,20} table|not in the (db|schema|database))\b/.test(a)) return true
  }
  return false
}

// Extracts a one-line resume summary from a loaded conversation — used by
// the session-start banner so the user knows where they left off.
function buildResumeSummary(msgs) {
  if (!msgs || msgs.length < 2) return null
  const firstUser = msgs.find(m => m.role === 'user')
  const hasBlocked = msgs.some(m => m.role === 'assistant' && isBlockedMessage(m.content))
  const feasibleCount = msgs.filter(m => m.role === 'assistant' && !isBlockedMessage(m.content) && m.content).length
  let nextStep = null
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role !== 'assistant') continue
    const match = (m.content || '').match(/NEXT STEPS?\s*:\s*\n?([-•* ]?.{5,100})/i)
    if (match) { nextStep = match[1].replace(/^[-•*\s]+/, '').trim().slice(0, 80); break }
  }
  return {
    question: firstUser ? stripMentions(firstUser.content || '').trim().slice(0, 70) : '—',
    hasBlocked,
    feasibleCount,
    nextStep,
  }
}

// Extract numbered questions from a CONTEXT QUESTIONS block.
function parseContextQuestions(content) {
  if (!content) return null
  // Match "CONTEXT QUESTIONS:" with optional markdown bold (**) and whitespace variants
  const match = content.match(/\**CONTEXT QUESTIONS\**\s*:\s*\n([\s\S]*?)(?=\n\s*\**(?:ASSUMPTIONS|ANSWER|EVIDENCE|NEXT STEPS|SOLUTION PLAN)\**\s*:|\n\n\n|$)/i)
  if (!match) return null
  const qs = match[1]
    .split('\n')
    .map(l => l.replace(/^\s*\d+[\.\)]\s*/, '').trim())
    .filter(l => l.length > 8 && l.includes('?'))  // only real questions, not statements
  return qs.length ? qs : null
}

// Strip CONTEXT QUESTIONS block from prose so it doesn't render twice
// (we render it as a styled card instead).
function stripContextQuestions(content) {
  if (!content) return content
  return content.replace(/\**CONTEXT QUESTIONS\**\s*:\s*\n[\s\S]*?(?=\n\s*\**(?:ASSUMPTIONS|ANSWER|EVIDENCE|NEXT STEPS|SOLUTION PLAN)\**\s*:|\n\n\n|$)/i, '').trim()
}

// Build a structured task context summary from all messages in the conversation.
// Used to populate the Task Context card in the right panel.
function parseTaskContext(msgs) {
  if (!msgs || msgs.length < 1) return null
  const firstUser = msgs.find(m => m.role === 'user')
  if (!firstUser) return null
  const goal = stripMentions(firstUser.content || '').trim()

  const evidenceLines = []
  const assumptions = []
  let widgetType = null

  for (const m of msgs) {
    if (m.role !== 'assistant' || !m.content) continue
    // Collect evidence citations
    const evMatch = m.content.match(/EVIDENCE\s*:\s*\n([\s\S]*?)(?=\n\s*[A-Z ]{4,}\s*:|$)/i)
    if (evMatch) {
      evMatch[1].split('\n')
        .map(l => l.replace(/^[-•*\s]+/, '').trim())
        .filter(l => l.startsWith('[From') && l.length > 10)
        .slice(0, 3)
        .forEach(l => evidenceLines.push(l))
    }
    // Collect assumptions (non-trivial ones)
    const asMatch = m.content.match(/ASSUMPTIONS\s*:\s*\n([\s\S]*?)(?=\n\s*ANSWER\s*:)/i)
    if (asMatch) {
      asMatch[1].split('\n')
        .map(l => l.replace(/^[-•*\s]+/, '').trim())
        .filter(l => l.length > 5 && !/^none$/i.test(l))
        .slice(0, 2)
        .forEach(l => assumptions.push(l))
    }
    // Widget type from finalize synthesis
    const wtMatch = m.content.match(/WIDGET TYPE\s*:\s*(.+)/i)
    if (wtMatch) widgetType = wtMatch[1].trim()
  }

  const uniqueEvidence = [...new Set(evidenceLines)].slice(0, 5)
  const uniqueAssumptions = [...new Set(assumptions)].slice(0, 3)
  if (!goal && !uniqueEvidence.length) return null

  return { goal, evidence: uniqueEvidence, assumptions: uniqueAssumptions, widgetType }
}

function detectAgents(text) {
  const mentioned = []
  for (const a of AGENTS) {
    if (new RegExp(`@${a}\\b`, 'i').test(text)) mentioned.push(a)
  }
  return mentioned.length ? mentioned : [DEFAULT_AGENT]
}

function stripMentions(text) {
  let out = text
  for (const a of AGENTS) {
    out = out.replace(new RegExp(`@${a}\\b`, 'gi'), '').trim()
  }
  return out.replace(/\s+/g, ' ').trim()
}

// Parse an agent response for a `BUILD: type=X, id=Y` line. Returns
// {type, id} or null. Forgiving on spacing.
function parseBuildHook(content) {
  if (!content) return null
  const m = content.match(/BUILD:\s*type\s*=\s*([a-z]+)\s*,\s*id\s*=\s*([a-zA-Z0-9._-]+)/)
  if (!m) return null
  return { type: m[1], id: m[2] }
}

// Extract the first fenced python block (or any fenced block) from an
// agent message. Returns the inner code string, or null. Used by the
// Build flow to auto-save the agent's draft as the widget's logic_code.
function parseCodeBlock(content) {
  if (!content) return null
  const m = content.match(/```(?:python)?\s*\n([\s\S]*?)```/)
  return m ? m[1].trim() : null
}

// Split a mixed prose + ```code blocks``` message into ordered segments
// for rendering. Each segment is {type: 'text', text} or
// {type: 'code', lang, code}. Used by the message renderer so code reads
// as code (monospace, dark background, copy button) instead of prose.
function splitMessageContent(content) {
  if (!content) return []
  const segments = []
  const regex = /```(\w*)\s*\n([\s\S]*?)```/g
  let lastIdx = 0
  let m
  while ((m = regex.exec(content)) !== null) {
    if (m.index > lastIdx) {
      const txt = content.slice(lastIdx, m.index)
      if (txt.trim()) segments.push({ type: 'text', text: txt })
    }
    segments.push({ type: 'code', lang: m[1] || 'code', code: m[2] })
    lastIdx = regex.lastIndex
  }
  if (lastIdx < content.length) {
    const tail = content.slice(lastIdx)
    if (tail.trim()) segments.push({ type: 'text', text: tail })
  }
  return segments.length ? segments : [{ type: 'text', text: content }]
}

// ─── Structured text rendering ─────────────────────────────────────
// Each named section (EVIDENCE, SOLUTION PLAN, NEXT STEPS, …) renders
// as a distinct colored card. Prose before any header renders plainly.

const NUM_ITEM_STYLE = {
  display: 'flex', alignItems: 'flex-start', marginBottom: 7, lineHeight: 1.55,
}
const NUM_BADGE_STYLE = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 18, height: 18, borderRadius: '50%',
  background: '#21262d', border: '1px solid #30363d',
  fontSize: 10, fontWeight: 700, color: '#8b949e',
  flexShrink: 0, marginRight: 8, marginTop: 2,
}
const BULLET_ITEM_STYLE = {
  display: 'flex', alignItems: 'flex-start', marginBottom: 5, lineHeight: 1.55,
}

// Per-section visual config: accent color, card background, border color
const SECTION_CFG = {
  'ASSUMPTIONS':          { color: '#8b949e', bg: '#161b22', border: '#30363d' },
  'ANSWER':               { color: '#79c0ff', bg: '#0d1926', border: '#1c4172' },
  'EVIDENCE':             { color: '#58a6ff', bg: '#0b1829', border: '#1461b5' },
  'SOLUTION PLAN':        { color: '#e3b341', bg: '#1a1500', border: '#6d5100' },
  'NEXT STEPS':           { color: '#3fb950', bg: '#0b1a0f', border: '#1a4a25' },
  'NEXT STEP':            { color: '#3fb950', bg: '#0b1a0f', border: '#1a4a25' },
  'CAPABILITY GAP CHECK': { color: '#d2a8ff', bg: '#140d22', border: '#4d2d8a' },
  'READY TO BUILD':       { color: '#3fb950', bg: '#0b1a0f', border: '#1a4a25' },
}
const KNOWN_SECTIONS = new Set(Object.keys(SECTION_CFG)
  .concat(['CONTEXT QUESTIONS', 'CLARIFYING QUESTIONS']))

function renderInlineMd(text) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/)
  if (parts.length === 1) return text
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**'))
      return <strong key={i}>{p.slice(2, -2)}</strong>
    if (p.startsWith('`') && p.endsWith('`'))
      return <code key={i} style={{ fontFamily: 'ui-monospace,monospace', fontSize: '0.88em',
        background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 3 }}>{p.slice(1, -1)}</code>
    return p
  })
}

function renderLines(lines) {
  const els = []
  let k = 0
  for (const line of lines) {
    const t = line.trim()
    if (!t) { els.push(<div key={k++} style={{ height: 4 }} />); continue }
    if (t === '---') {
      els.push(<hr key={k++} style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.07)', margin: '6px 0' }} />)
      continue
    }
    const nm = t.match(/^(\d+)[.)]\s+(.+)/)
    if (nm) {
      els.push(
        <div key={k++} style={NUM_ITEM_STYLE}>
          <span style={NUM_BADGE_STYLE}>{nm[1]}</span>
          <span style={{ flex: 1 }}>{renderInlineMd(nm[2])}</span>
        </div>
      )
      continue
    }
    const bm = t.match(/^[-•*→]\s+(.+)/)
    if (bm) {
      const isGap = bm[1].includes('✗') || bm[1].includes('GAP') || bm[1].includes('CANNOT')
      const isOk  = bm[1].includes('✓')
      els.push(
        <div key={k++} style={{ ...BULLET_ITEM_STYLE,
          color: isGap ? '#f85149' : isOk ? '#3fb950' : '#c9d1d9' }}>
          <span style={{ marginRight: 8, flexShrink: 0, color: isGap ? '#f85149' : isOk ? '#3fb950' : '#58a6ff' }}>
            {isGap ? '✗' : isOk ? '✓' : '·'}
          </span>
          <span style={{ flex: 1 }}>{renderInlineMd(bm[1])}</span>
        </div>
      )
      continue
    }
    els.push(<div key={k++} style={{ marginBottom: 3, lineHeight: 1.55 }}>{renderInlineMd(t)}</div>)
  }
  return <>{els}</>
}

function parseIntoSections(text) {
  const lines = text.split('\n')
  const sections = []
  let name = null
  let buf = []
  for (const line of lines) {
    const t = line.trim()
    const hm = t.match(/^([A-Z][A-Z\s()]+[A-Z]):\s*$/)
    const sname = hm ? hm[1].trim() : null
    if (sname && KNOWN_SECTIONS.has(sname)) {
      if (buf.length || name !== null) sections.push({ name, lines: buf })
      name = sname
      buf = []
    } else {
      buf.push(line)
    }
  }
  if (buf.length || name !== null) sections.push({ name, lines: buf })
  return sections
}

function StructuredText({ text }) {
  if (!text) return null
  const sections = parseIntoSections(text)
  return (
    <>
      {sections.map((sec, i) => {
        const cfg = SECTION_CFG[sec.name]
        const hasContent = sec.lines.some(l => l.trim())
        // Plain prose (before any header) — no card wrapper
        if (!sec.name) {
          return <div key={i}>{renderLines(sec.lines)}</div>
        }
        // Sections handled by the separate CTX form — skip prose render
        if (sec.name === 'CONTEXT QUESTIONS' || sec.name === 'CLARIFYING QUESTIONS') return null
        // Named section card
        const accentColor = cfg ? cfg.color : '#6e7681'
        const bgColor     = cfg ? cfg.bg    : '#161b22'
        const borderColor = cfg ? cfg.border: '#30363d'
        if (!hasContent) return null
        return (
          <div key={i} style={{
            margin: '8px 0', borderRadius: 6, overflow: 'hidden',
            border: `1px solid ${borderColor}`,
            borderLeft: `3px solid ${accentColor}`,
            background: bgColor,
          }}>
            <div style={{
              padding: '4px 10px', fontSize: 10, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 0.8,
              color: accentColor,
              borderBottom: `1px solid ${borderColor}`,
              background: `${bgColor}`,
            }}>
              {sec.name}
            </div>
            <div style={{ padding: '8px 12px', fontSize: 13 }}>
              {renderLines(sec.lines)}
            </div>
          </div>
        )
      })}
    </>
  )
}

const CODE_BOX = {
  margin: '8px 0',
  borderRadius: 6,
  overflow: 'hidden',
  background: '#0d1117',
  border: '1px solid #30363d',
}
const CODE_BOX_HEADER = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '4px 10px',
  background: '#161b22',
  borderBottom: '1px solid #30363d',
  fontSize: 11,
  color: '#8b949e',
  fontFamily: 'ui-monospace, monospace',
}
const CODE_BOX_PRE = {
  margin: 0,
  padding: '10px 12px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  lineHeight: 1.5,
  color: '#c9d1d9',
  whiteSpace: 'pre',
  overflowX: 'auto',
}
const COPY_BTN = {
  border: '1px solid #30363d',
  background: 'transparent',
  color: '#8b949e',
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: 'inherit',
  padding: '2px 8px',
  borderRadius: 3,
}

function CodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (_) {
      /* clipboard API requires secure context; ignore silently */
    }
  }
  return (
    <div style={CODE_BOX}>
      <div style={CODE_BOX_HEADER}>
        <span>{lang}</span>
        <button style={COPY_BTN} onClick={handleCopy} title="Copy to clipboard">
          {copied ? '✓ Copied' : '⧉ Copy'}
        </button>
      </div>
      <pre style={CODE_BOX_PRE}>{code}</pre>
    </div>
  )
}

const BUILD_BTN = {
  marginTop: 10,
  padding: '6px 14px',
  border: '1px solid #2da44e',
  borderRadius: 6,
  background: '#2da44e',
  color: '#fff',
  fontSize: 12,
  cursor: 'pointer',
  fontWeight: 500,
}
const BUILD_BTN_ERR = { ...BUILD_BTN, background: '#cf222e', borderColor: '#cf222e' }
const DEFAULT_BUILD_SCREEN = 'sales_report'

// Pull labeled fields out of a structured spec message (DATA SPEC / UI SPEC).
// `fields` is the ordered list of labels to look for. Values span until the
// next field label (or end of content). Multi-line values are collapsed to
// single spaced strings so they fit in a tight card layout.
function parseSpecFields(content, fields) {
  if (!content) return {}
  const out = {}
  const ordered = [...fields]
  for (let i = 0; i < ordered.length; i++) {
    const name = ordered[i]
    // Stop boundary: any of the OTHER field labels, or BUILD: line, or end
    const others = ordered
      .filter((_, k) => k !== i)
      .concat(['BUILD'])
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')
    const re = new RegExp(
      `${name}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:${others})\\s*:|\\n\\s*\`\`\`|$)`,
      'i',
    )
    const m = content.match(re)
    if (m) {
      const val = m[1].trim().replace(/\s*\n\s*/g, ' · ')
      if (val && val.toLowerCase() !== 'n/a') out[name] = val
    }
  }
  return out
}

// Extract a SOLUTION PLAN section from an assistant message — the body
// between "SOLUTION PLAN:" and the next ALL-CAPS section header (or end).
function parseSolutionPlan(content) {
  if (!content) return null
  const re = /SOLUTION PLAN\s*:\s*\n([\s\S]*?)(?=\n\s*(?:NEXT STEPS|BUILD|EVIDENCE|ANSWER|ASSUMPTIONS)\s*:|\n```|$)/i
  const m = content.match(re)
  if (!m) return null
  return m[1].trim().replace(/\n{3,}/g, '\n\n')
}

// Walk messages back-to-front and pull the most-recent of each kind so the
// side panel always reflects the current best-known plan.
//
// PREREQUISITES are aggregated from ALL agent messages with a SOLUTION
// PLAN (most recent first) so the user sees every blocker that's been
// raised, not just the last one — schema work from earlier turns stays
// relevant even after the FINALIZE synthesis runs.
function extractStepsData(messages) {
  let lastUser = null
  let lastBackendSynth = null
  let lastFrontendSynth = null
  let lastCodeMsg = null
  let lastBuildMsg = null
  const prerequisites = []  // [{agent, plan}] — latest first
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!lastUser && m.role === 'user') lastUser = m
    if (!lastBackendSynth && m.role === 'assistant' && m.agent === 'backend' && /SOURCE\s*TABLE\s*:/i.test(m.content || '')) {
      lastBackendSynth = m
    }
    if (!lastFrontendSynth && m.role === 'assistant' && m.agent === 'frontend' && /WIDGET\s*TYPE\s*:/i.test(m.content || '')) {
      lastFrontendSynth = m
    }
    if (!lastCodeMsg && m.role === 'assistant' && parseCodeBlock(m.content)) {
      lastCodeMsg = m
    }
    if (!lastBuildMsg && m.role === 'assistant' && parseBuildHook(m.content)) {
      lastBuildMsg = m
    }
    if (m.role === 'assistant') {
      const plan = parseSolutionPlan(m.content)
      if (plan) prerequisites.push({ agent: m.agent, plan })
    }
  }
  return {
    userQuestion: lastUser ? stripMentions(lastUser.content || '').trim() : '',
    prerequisites,  // ordered latest-first
    dataSpec: lastBackendSynth
      ? parseSpecFields(lastBackendSynth.content, [
          'SOURCE TABLE', 'COLUMNS USED', 'FILTERS', 'GROUPING', 'SQL APPROACH', 'NOTES',
        ])
      : null,
    dataAgent: lastBackendSynth ? 'backend' : null,
    uiSpec: lastFrontendSynth
      ? parseSpecFields(lastFrontendSynth.content, [
          'WIDGET TYPE', 'LAYOUT', 'KEY PROPS', 'NOTES',
        ])
      : null,
    uiAgent: lastFrontendSynth ? 'frontend' : null,
    code: lastCodeMsg ? parseCodeBlock(lastCodeMsg.content) : null,
    build: lastBuildMsg ? parseBuildHook(lastBuildMsg.content) : null,
    buildMessage: lastBuildMsg,
  }
}

// One step card with label + body. Empty mode shows dashed border.
function TaskContextCard({ context }) {
  if (!context || !context.goal) return null
  return (
    <div style={TASK_CTX_CARD}>
      <div style={TASK_CTX_TITLE}>🗂 Task Context</div>
      <div style={TASK_CTX_FIELD}>
        <div style={TASK_CTX_KEY}>Goal</div>
        <div style={TASK_CTX_VAL}>
          {context.goal.slice(0, 140)}{context.goal.length > 140 ? '…' : ''}
        </div>
      </div>
      {context.widgetType && (
        <div style={TASK_CTX_FIELD}>
          <div style={TASK_CTX_KEY}>Widget</div>
          <div><span style={TASK_CTX_CHIP}>{context.widgetType}</span></div>
        </div>
      )}
      {context.evidence.length > 0 && (
        <div style={TASK_CTX_FIELD}>
          <div style={TASK_CTX_KEY}>Evidence gathered</div>
          <div>
            {context.evidence.map((e, i) => (
              <div key={i} style={{ ...TASK_CTX_VAL, fontSize: 11, marginTop: 2, color: '#8b949e' }}>{e}</div>
            ))}
          </div>
        </div>
      )}
      {context.assumptions.length > 0 && (
        <div style={TASK_CTX_FIELD}>
          <div style={TASK_CTX_KEY}>Assumptions</div>
          <div>
            {context.assumptions.map((a, i) => (
              <div key={i} style={{ ...TASK_CTX_VAL, fontSize: 11, marginTop: 2, color: '#e3b341' }}>· {a}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ContextQuestionsCard({ questions }) {
  if (!questions || !questions.length) return null
  return (
    <div style={CTX_Q_SECTION}>
      <div style={CTX_Q_LABEL}>🔍 Clarifying questions</div>
      {questions.map((q, i) => (
        <div key={i} style={CTX_Q_ITEM}>
          <span style={CTX_Q_NUM}>{i + 1}</span>
          <span>{q}</span>
        </div>
      ))}
    </div>
  )
}

// Parse inline (opt A / opt B / opt C) options from a question string.
// Returns array of option strings, or null if no options found.
function parseQuestionOptions(q) {
  const m = q.match(/\(([^)]{4,})\)\s*$/)
  if (!m) return null
  const opts = m[1].split(/\s*\/\s*/).map(s => s.trim()).filter(s => s.length > 0)
  return opts.length >= 2 ? opts : null
}

// Strip the trailing (opt A / opt B) part from question display text.
function stripQuestionOptions(q) {
  return q.replace(/\s*\([^)]+\)\s*$/, '').trim()
}

function guessInputType(q) {
  if (parseQuestionOptions(q)) return 'option-select'   // has inline (A / B / C)
  const lower = q.toLowerCase()
  // Only trigger widget-select for questions explicitly asking about output/UI format.
  // Avoid matching "table" or "chart" when they appear in schema-context sentences.
  if (/output format|widget type|which format|what format|how.{0,20}display|what.{0,20}visuali|ui format/.test(lower)) {
    return 'widget-select'
  }
  return 'text'
}

const WIDGET_TYPE_OPTIONS = ['table', 'chart', 'text', 'number', 'input', 'button']

function ContextForm({ questions, onSubmit, busy }) {
  const [answers, setAnswers] = useState(() => questions.map(() => ''))
  const [submitted, setSubmitted] = useState(false)

  const setAnswer = (i, val) => setAnswers(prev => {
    const next = [...prev]
    next[i] = val
    return next
  })

  const handleSubmit = () => {
    const formatted = answers
      .map((a, i) => `${i + 1}. ${a.trim() || '(not specified)'}`)
      .join('\n')
    setSubmitted(true)
    onSubmit(formatted)
  }

  const hasAnyAnswer = answers.some(a => a.trim())

  return (
    <div style={CTX_Q_SECTION}>
      <div style={CTX_Q_LABEL}>🔍 Help the agent — pick or type your answers</div>
      {questions.map((q, i) => {
        const inputType = guessInputType(q)
        const inlineOpts = inputType === 'option-select' ? parseQuestionOptions(q) : null
        const displayQ = inlineOpts ? stripQuestionOptions(q) : q
        const buttonOptions = inlineOpts || (inputType === 'widget-select' ? WIDGET_TYPE_OPTIONS : null)
        return (
          <div key={i} style={CTX_FORM_QUESTION}>
            <div style={{ ...CTX_Q_ITEM, marginBottom: 8, alignItems: 'flex-start' }}>
              <span style={CTX_Q_NUM}>{i + 1}</span>
              <span style={{ fontSize: 13, color: '#c9d1d9', flex: 1 }}>{displayQ}</span>
            </div>
            {buttonOptions ? (
              <>
                <div style={CTX_FORM_BTN_GROUP}>
                  {buttonOptions.map(opt => (
                    <button
                      key={opt}
                      style={answers[i] === opt ? CTX_FORM_TYPE_BTN_ACTIVE : CTX_FORM_TYPE_BTN}
                      onClick={() => setAnswer(i, answers[i] === opt ? '' : opt)}
                      disabled={busy || submitted}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  style={{
                    ...CTX_FORM_INPUT,
                    marginTop: 6,
                    fontSize: 12,
                    opacity: 0.75,
                    borderStyle: 'dashed',
                  }}
                  value={buttonOptions.includes(answers[i]) ? '' : answers[i]}
                  onChange={e => setAnswer(i, e.target.value)}
                  placeholder="or type your own answer…"
                  disabled={busy || submitted}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && hasAnyAnswer && !submitted && !busy) {
                      e.preventDefault()
                      handleSubmit()
                    }
                  }}
                />
              </>
            ) : (
              <input
                type="text"
                style={CTX_FORM_INPUT}
                value={answers[i]}
                onChange={e => setAnswer(i, e.target.value)}
                placeholder="Your answer…"
                disabled={busy || submitted}
                onKeyDown={e => {
                  if (e.key === 'Enter' && hasAnyAnswer && !submitted && !busy) {
                    e.preventDefault()
                    handleSubmit()
                  }
                }}
              />
            )}
          </div>
        )
      })}
      <button
        style={{
          ...CTX_FORM_SUBMIT,
          opacity: (!hasAnyAnswer || submitted || busy) ? 0.45 : 1,
          cursor: (!hasAnyAnswer || submitted || busy) ? 'default' : 'pointer',
        }}
        onClick={handleSubmit}
        disabled={!hasAnyAnswer || busy || submitted}
      >
        {submitted ? '✓ Sent' : 'Submit answers →'}
      </button>
    </div>
  )
}

// Combined form shown when both @backend and @frontend have pending questions.
// Renders sections per agent, one Submit collects everything.
function CombinedContextForm({ sections, onSubmit, busy }) {
  const [answers, setAnswers] = useState(() =>
    sections.map(s => s.questions.map(() => ''))
  )
  const [submitted, setSubmitted] = useState(false)

  const setAnswer = (si, qi, val) => setAnswers(prev => {
    const next = prev.map(s => [...s])
    next[si][qi] = val
    return next
  })

  const hasAnyAnswer = answers.some(s => s.some(a => a.trim()))

  const handleSubmit = () => {
    const parts = sections.map((s, si) => {
      const sectionAnswers = s.questions
        .map((_, qi) => `${qi + 1}. ${answers[si][qi].trim() || '(not specified)'}`)
        .join('\n')
      return `@${s.agent}:\n${sectionAnswers}`
    })
    setSubmitted(true)
    onSubmit(parts.join('\n\n'))
  }

  return (
    <div style={CTX_Q_SECTION}>
      <div style={CTX_Q_LABEL}>🔍 Help both agents — answer all questions then submit</div>
      {sections.map((s, si) => (
        <div key={si} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: s.agent === 'backend' ? '#e36209' : '#1f6feb',
            textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            @{s.agent}
          </div>
          {s.questions.map((q, qi) => {
            const inlineOpts = parseQuestionOptions(q)
            const displayQ = inlineOpts ? stripQuestionOptions(q) : q
            return (
              <div key={qi} style={CTX_FORM_QUESTION}>
                <div style={{ ...CTX_Q_ITEM, marginBottom: 6, alignItems: 'flex-start' }}>
                  <span style={CTX_Q_NUM}>{qi + 1}</span>
                  <span style={{ fontSize: 13, color: '#c9d1d9', flex: 1 }}>{displayQ}</span>
                </div>
                {inlineOpts ? (
                  <>
                    <div style={CTX_FORM_BTN_GROUP}>
                      {inlineOpts.map(opt => (
                        <button
                          key={opt}
                          style={answers[si][qi] === opt ? CTX_FORM_TYPE_BTN_ACTIVE : CTX_FORM_TYPE_BTN}
                          onClick={() => setAnswer(si, qi, answers[si][qi] === opt ? '' : opt)}
                          disabled={busy || submitted}
                        >{opt}</button>
                      ))}
                    </div>
                    <input
                      type="text"
                      style={{ ...CTX_FORM_INPUT, marginTop: 6, fontSize: 12, opacity: 0.75, borderStyle: 'dashed' }}
                      value={inlineOpts.includes(answers[si][qi]) ? '' : answers[si][qi]}
                      onChange={e => setAnswer(si, qi, e.target.value)}
                      placeholder="or type your own answer…"
                      disabled={busy || submitted}
                    />
                  </>
                ) : (
                  <input
                    type="text"
                    style={CTX_FORM_INPUT}
                    value={answers[si][qi]}
                    onChange={e => setAnswer(si, qi, e.target.value)}
                    placeholder="Your answer…"
                    disabled={busy || submitted}
                  />
                )}
              </div>
            )
          })}
        </div>
      ))}
      <button
        style={{
          ...CTX_FORM_SUBMIT,
          opacity: (!hasAnyAnswer || submitted || busy) ? 0.45 : 1,
          cursor: (!hasAnyAnswer || submitted || busy) ? 'default' : 'pointer',
        }}
        onClick={handleSubmit}
        disabled={!hasAnyAnswer || busy || submitted}
      >
        {submitted ? '✓ Sent' : 'Submit all answers →'}
      </button>
    </div>
  )
}

function ResumeBanner({ messages, activeId }) {
  if (!activeId || !messages || messages.length < 2) return null
  const s = buildResumeSummary(messages)
  if (!s) return null
  return (
    <div style={RESUME_BANNER}>
      <span style={RESUME_LABEL}>↩ Resuming</span>
      <span style={RESUME_Q}>"{s.question}{s.question.length >= 70 ? '…' : ''}"</span>
      {s.hasBlocked && (
        <span style={{ ...RESUME_TAG, color: '#f85149', background: '#3d1515', border: '1px solid #6e1c1c' }}>
          ⚠ blocked
        </span>
      )}
      {!s.hasBlocked && s.feasibleCount > 0 && (
        <span style={{ ...RESUME_TAG, color: '#3fb950', background: '#0c2011', border: '1px solid #1a3a25' }}>
          ✓ feasible
        </span>
      )}
      {s.nextStep && <span style={RESUME_NEXT}>→ {s.nextStep}</span>}
    </div>
  )
}

function StepCard({ label, empty, children }) {
  return (
    <div style={empty ? STEP_CARD_EMPTY : STEP_CARD}>
      <div style={STEP_LABEL}>{label}</div>
      {empty ? <div style={STEP_BODY_MUTED}>—</div> : <div style={STEP_BODY}>{children}</div>}
    </div>
  )
}

// Render the right-hand task pipeline. Cards are TASK-oriented (what
// must happen to ship), not agent-oriented. Agent attribution shows as
// a subtle source tag on cards that came from an agent's synthesis.
// Prerequisites card surfaces SOLUTION PLAN content (e.g. DDL) so
// blockers don't get buried in chat.
function StepsPanel({ steps, messages, setErrMsg }) {
  const {
    userQuestion,
    prerequisites,
    dataSpec, dataAgent,
    uiSpec, uiAgent,
    code,
    build, buildMessage,
  } = steps

  const taskCtx = parseTaskContext(messages)

  let stepNum = 0
  const nextStep = () => `${++stepNum}`

  return (
    <div className="dark-scroll" style={STEPS_PANEL}>
      <TaskContextCard context={taskCtx} />
      <div style={STEPS_TITLE}>📋 Plan to Ship the Widget</div>

      <StepCard label={`${nextStep()} · Question`} empty={!userQuestion}>
        {userQuestion}
      </StepCard>
      <div style={STEP_ARROW}>↓</div>

      {/* PREREQUISITES — shows DDL / scaffolding steps from any
          SOLUTION PLAN in the conversation. Renders only when present. */}
      {prerequisites.length > 0 && (
        <>
          <div style={{ ...STEP_CARD, borderColor: '#b08800', background: '#1c1600' }}>
            <div style={{ ...STEP_LABEL, color: '#e3b341' }}>
              {nextStep()} · 🔧 Prerequisites
            </div>
            <div style={{ ...STEP_BODY, marginBottom: 6 }}>
              Run these before building — surfaced from agent solution plans:
            </div>
            {prerequisites.map((pre, idx) => (
              <div key={idx} style={{ marginTop: 8 }}>
                <div style={{ ...STEP_FIELD_KEY, color: '#e3b341' }}>
                  from @{pre.agent}{prerequisites.length > 1 ? ` (#${idx + 1})` : ''}
                </div>
                <pre style={STEP_CODE_PRE}>
                  {pre.plan}
                </pre>
              </div>
            ))}
          </div>
          <div style={STEP_ARROW}>↓</div>
        </>
      )}

      <StepCard
        label={`${nextStep()} · Data approach${dataAgent ? ` · from @${dataAgent}` : ''}`}
        empty={!dataSpec || Object.keys(dataSpec).length === 0}
      >
        {dataSpec &&
          Object.entries(dataSpec).map(([k, v]) => (
            <div key={k} style={STEP_FIELD}>
              <div style={STEP_FIELD_KEY}>{k.toLowerCase()}</div>
              <div style={STEP_FIELD_VAL}>{v}</div>
            </div>
          ))}
      </StepCard>
      <div style={STEP_ARROW}>↓</div>

      <StepCard
        label={`${nextStep()} · UI approach${uiAgent ? ` · from @${uiAgent}` : ''}`}
        empty={!uiSpec || Object.keys(uiSpec).length === 0}
      >
        {uiSpec &&
          Object.entries(uiSpec).map(([k, v]) => (
            <div key={k} style={STEP_FIELD}>
              <div style={STEP_FIELD_KEY}>{k.toLowerCase()}</div>
              <div style={STEP_FIELD_VAL}>{v}</div>
            </div>
          ))}
      </StepCard>
      <div style={STEP_ARROW}>↓</div>

      <StepCard label={`${nextStep()} · Code (drafted)`} empty={!code}>
        {code && <pre style={STEP_CODE_PRE}>{code}</pre>}
      </StepCard>
      <div style={STEP_ARROW}>↓</div>

      {build ? (
        <div style={STEP_BUILD_CARD}>
          <div style={{ ...STEP_LABEL, color: '#3fb950' }}>{nextStep()} · Build</div>
          <div style={{ ...STEP_BODY, marginBottom: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Ready to ship 🚀</div>
            <code style={{ fontSize: 11, color: '#1f2328' }}>
              {build.id}
            </code>{' '}
            <span style={{ fontSize: 11, color: '#666' }}>· type: {build.type}</span>
          </div>
          <BuildButton
            type={build.type}
            id={build.id}
            contextMessage={buildMessage?.content || ''}
            userQuestion={userQuestion}
            onError={setErrMsg}
          />
        </div>
      ) : (
        <StepCard label={`${nextStep()} · Build`} empty>—</StepCard>
      )}
    </div>
  )
}

function deriveTitle(firstUserMessage) {
  const cleaned = stripMentions(firstUserMessage).trim()
  if (!cleaned) return 'New chat'
  return cleaned.length <= 40 ? cleaned : cleaned.slice(0, 40) + '…'
}

// ─── BuildButton — hand-off into /editor ───────────────────────────
// Creates the suggested widget via POST /api/widget (idempotent enough —
// 409 = "already exists" is treated as success since the user just wants
// to jump into the editor on that widget). Navigates with `select=` to
// auto-pick the widget and `prefill=` to drop the agent's evidence into
// the code-gen chat input.

function BuildButton({ type, id, contextMessage, userQuestion = '', onError }) {
  const draftedCode = parseCodeBlock(contextMessage)

  const handleClick = async () => {
    try {
      // 1. Create the widget (idempotent: 409 = already exists, fine)
      const r = await fetch('/api/widget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screen_id: DEFAULT_BUILD_SCREEN,
          widget_id: id,
          type,
        }),
      })
      if (!r.ok && r.status !== 409) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${r.status}`)
      }

      // 2. If the agent drafted code, save it as the widget's logic_code
      //    so the preview is live before /editor even loads. On failure,
      //    we still navigate — user can fix in /editor.
      if (draftedCode) {
        try {
          await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              screen_id: DEFAULT_BUILD_SCREEN,
              widget_id: id,
              logic_code: draftedCode,
            }),
          })
        } catch (e) {
          onError && onError(`save: ${String(e.message || e)}`)
        }
      }

      // 3. Build the prefill as a code-gen brief: user's original ask
      //    on top, then the agent's structured plan (ANSWER / EVIDENCE /
      //    NEXT STEPS) stripped of protocol bits (BUILD: line +
      //    ```code block``` — those are for the build flow, not the
      //    code-gen AI). End with a clear directive so the code-gen AI
      //    treats this as a spec to implement.
      const agentBrief = (contextMessage || '')
        .replace(/```[\s\S]*?```/g, '')      // drop code blocks
        .replace(/^BUILD:.*$/m, '')          // drop protocol line
        .replace(/\n{3,}/g, '\n\n')          // collapse extra blank lines
        .trim()
      const briefParts = []
      if (userQuestion) briefParts.push(`USER ASK: ${userQuestion}`)
      if (agentBrief) {
        briefParts.push('')
        briefParts.push('PLAN BRIEF (synthesised from /plan discovery chat):')
        briefParts.push(agentBrief)
      }
      briefParts.push('')
      briefParts.push(
        `Implement render(params) for this ${type} widget based on the brief above. ` +
          `Output ONLY the Python function.`,
      )
      const prefill = briefParts.join('\n')

      const params = new URLSearchParams({
        screen: DEFAULT_BUILD_SCREEN,
        select: id,
        prefill,
      })
      window.location.href = `/editor?${params.toString()}`
    } catch (e) {
      onError && onError(`build: ${String(e.message || e)}`)
    }
  }

  const label = draftedCode ? `Build ${id} (with code) →` : `Build ${id} →`
  const tooltip = draftedCode
    ? `Create ${type} '${id}', save the drafted code, and open in editor`
    : `Create ${type} '${id}' and open in editor`
  return (
    <button style={BUILD_BTN} onClick={handleClick} title={tooltip}>
      {label}
    </button>
  )
}

// ─── component ─────────────────────────────────────────────────────

export default function PlanPage() {
  // Conversation list (sidebar) + currently-loaded conversation
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])

  // Chat input + status
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState(null)
  const scrollRef = useRef(null)

  // Initial sidebar load
  useEffect(() => {
    refreshSidebar()
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, busy])

  const refreshSidebar = async () => {
    try {
      const r = await fetch('/api/conversations')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const list = await r.json()
      setConversations(list)
    } catch (e) {
      setErrMsg(`sidebar: ${String(e.message || e)}`)
    }
  }

  const loadConversation = async (id) => {
    try {
      const r = await fetch(`/api/conversations/${id}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setActiveId(data.id)
      setMessages(data.messages || [])
      setErrMsg(null)
    } catch (e) {
      setErrMsg(`load: ${String(e.message || e)}`)
    }
  }

  const newChat = () => {
    setActiveId(null)
    setMessages([])
    setDraft('')
    setErrMsg(null)
  }

  const deleteConversation = async (id, e) => {
    e.stopPropagation()
    if (!confirm('Delete this conversation?')) return
    try {
      const r = await fetch(`/api/conversations/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      if (activeId === id) newChat()
      await refreshSidebar()
    } catch (e) {
      setErrMsg(`delete: ${String(e.message || e)}`)
    }
  }

  // Create a new conversation lazily on first send, returning its id.
  const ensureActiveId = async (firstUserMessage) => {
    if (activeId) return activeId
    try {
      const r = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: deriveTitle(firstUserMessage) }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setActiveId(data.id)
      return data.id
    } catch (e) {
      setErrMsg(`create: ${String(e.message || e)}`)
      return null
    }
  }

  // Save current messages to the active conversation. Best-effort —
  // failures show as errMsg but don't block the next chat turn.
  const saveMessages = async (id, msgs) => {
    if (!id) return
    try {
      const r = await fetch(`/api/conversations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: msgs }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    } catch (e) {
      setErrMsg(`save: ${String(e.message || e)}`)
    }
  }

  // Ask one agent, appending the streamed response to messages and returning
  // the final updated array (so we can chain agents and then save once).
  const askAgent = async (agent, cleanPrompt, baseHistory) => {
    const placeholderIdx = baseHistory.length
    // Push the placeholder synchronously into local state
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', agent, content: '' },
    ])
    let finalContent = ''
    try {
      await streamSSEPost(
        `${SSE_BACKEND_BASE}/ai/discuss`,
        { prompt: cleanPrompt, agent, history: baseHistory },
        (ev) => {
          if (ev.event === 'token' && ev.data?.text) {
            finalContent += ev.data.text
            setMessages((prev) => {
              const copy = [...prev]
              const last = copy[placeholderIdx]
              if (last && last.role === 'assistant' && last.agent === agent) {
                copy[placeholderIdx] = { ...last, content: last.content + ev.data.text }
              }
              return copy
            })
          } else if (ev.event === 'error') {
            setErrMsg(`@${agent}: ${ev.data?.message || 'error'}`)
          }
        },
      )
    } catch (e) {
      setErrMsg(`@${agent}: ${String(e.message || e)}`)
    }
    return [...baseHistory, { role: 'assistant', agent, content: finalContent }]
  }

  const send = async (overrideText) => {
    const text = (overrideText !== undefined ? overrideText : draft).trim()
    if (!text || busy) return
    // On the very first turn (no history yet), always call both agents so
    // @backend can ask about data and @frontend can ask about UI in parallel.
    // When the combined form submits answers it prefixes sections with @backend:
    // and @frontend: — detect both and route to both agents.
    // After that, respect explicit @mentions or fall back to @backend only.
    const isCombinedAnswer = text.includes('@backend:') && text.includes('@frontend:')
    const agents = messages.length === 0 || isCombinedAnswer ? AGENTS : detectAgents(text)
    const cleanPrompt = stripMentions(text) || text

    const userMsg = { role: 'user', content: text }
    let snapshot = [...messages, userMsg]
    setMessages(snapshot)
    if (overrideText === undefined) setDraft('')
    setBusy(true)
    setErrMsg(null)

    // Lazy-create the conversation on first user turn so the sidebar
    // doesn't fill with empties.
    const id = await ensureActiveId(text)

    // Run agents sequentially, but gate @frontend if @backend is still
    // asking schema questions. @frontend analysis depends on confirmed data;
    // running it before schema is resolved produces a confusing premature block.
    let frontendDeferred = false
    for (const agent of agents) {
      snapshot = await askAgent(agent, cleanPrompt, snapshot)
      if (agent === 'backend' && agents.includes('frontend')) {
        if (parseContextQuestions(snapshot[snapshot.length - 1].content)) {
          frontendDeferred = true
          break  // @frontend will auto-join once schema is resolved
        }
      }
    }

    // Auto-trigger @frontend on the turn @backend resolves its schema questions
    // (no new CONTEXT QUESTIONS in response) if @frontend hasn't spoken yet.
    if (!frontendDeferred && !agents.includes('frontend')) {
      const hadPending = messages.some(
        m => m.role === 'assistant' && m.agent === 'backend' && parseContextQuestions(m.content)
      )
      const frontendSpoke = messages.some(m => m.role === 'assistant' && m.agent === 'frontend')
      const latestBackend = snapshot.slice().reverse().find(
        m => m.role === 'assistant' && m.agent === 'backend'
      )
      if (hadPending && !frontendSpoke && latestBackend && !parseContextQuestions(latestBackend.content)) {
        snapshot = await askAgent('frontend', cleanPrompt, snapshot)
      }
    }

    // Persist + refresh sidebar (so newest moves to top + new title shows)
    await saveMessages(id, snapshot)
    await refreshSidebar()
    setBusy(false)
  }

  // Joint synthesis: ask @backend for DATA SPEC, then @frontend for UI SPEC
  // (which sees the backend's spec in conversation history). The frontend
  // response emits BUILD: + code draft so the user can click Build to
  // hand off to the editor. Sequential so messages don't interleave.
  const finalize = async () => {
    if (busy || messages.length === 0 || !activeId) return
    setBusy(true)
    setErrMsg(null)

    // Backend synthesis
    const backendUser = {
      role: 'user',
      content: `@backend ${FINALIZE_BACKEND_PROMPT}`,
    }
    let snapshot = [...messages, backendUser]
    setMessages(snapshot)
    snapshot = await askAgent('backend', FINALIZE_BACKEND_PROMPT, snapshot)

    // Frontend synthesis (with backend's spec now in history)
    const frontendUser = {
      role: 'user',
      content: `@frontend ${FINALIZE_FRONTEND_PROMPT}`,
    }
    snapshot = [...snapshot, frontendUser]
    setMessages(snapshot)
    snapshot = await askAgent('frontend', FINALIZE_FRONTEND_PROMPT, snapshot)

    await saveMessages(activeId, snapshot)
    await refreshSidebar()
    setBusy(false)
  }

  return (
    <div className="plan-page" style={PAGE}>
      {/* ─── Sidebar ─────────────────────────────────────────── */}
      <div style={SIDEBAR}>
        <div style={SIDEBAR_HEADER}>
          <button style={NEW_BTN} onClick={newChat}>+ New Chat</button>
        </div>
        <div className="dark-scroll" style={SIDEBAR_LIST}>
          {conversations.length === 0 && (
            <div style={CONV_EMPTY}>No saved chats yet.</div>
          )}
          {conversations.map((c) => {
            const isActive = c.id === activeId
            const rowStyle = isActive ? { ...CONV_ROW, ...CONV_ROW_ACTIVE } : CONV_ROW
            return (
              <div
                key={c.id}
                style={rowStyle}
                onClick={() => loadConversation(c.id)}
                onMouseEnter={(e) => {
                  const x = e.currentTarget.querySelector('button')
                  if (x) x.style.visibility = 'visible'
                }}
                onMouseLeave={(e) => {
                  const x = e.currentTarget.querySelector('button')
                  if (x) x.style.visibility = 'hidden'
                }}
                title={c.title}
              >
                <span style={CONV_TITLE}>{c.title}</span>
                <button
                  style={CONV_DELETE}
                  onClick={(e) => deleteConversation(c.id, e)}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ─── Main pane ────────────────────────────────────────── */}
      <div style={MAIN}>
        <div style={HEADER}>
          <span style={TITLE}>LogicLive · Plan</span>
          <a style={NAV_LINK} href="/editor?screen=sales_report">→ open editor</a>
        </div>

        <div ref={scrollRef} className="dark-scroll" style={TRANSCRIPT}>
          <ResumeBanner messages={messages} activeId={activeId} />
          {messages.length === 0 && (
            <div style={HINT}>
              Discovery chat. Ask two AI experts about what's possible <em>before</em> you build.
              <br /><br />
              Examples:
              <ul>
                <li><code>@backend</code> can we get sales for the last 2 months by product?</li>
                <li><code>@frontend</code> can we render that as a stacked bar chart?</li>
                <li><code>@backend</code> <code>@frontend</code> can we add a customer-segmentation breakdown?</li>
              </ul>
              Default agent is <code>@backend</code> if you don't tag one. Both agents follow the
              CLAUDE.md-style discipline (cite evidence, state assumptions, honest limits).
              Conversations auto-save and survive refresh.
            </div>
          )}

          {(() => {
            // Find the index of the LATEST assistant message with a BUILD:
            // hook — only that one shows the Build button so iteration
            // stays clean. Older synthesis attempts read as history only.
            // Exception: suppress Build button if @frontend has a pending
            // CONTEXT QUESTIONS after the build message — the user must
            // answer the architecture question first, otherwise the build
            // would be wired incorrectly.
            let lastBuildIdx = -1
            for (let k = messages.length - 1; k >= 0; k--) {
              if (
                messages[k].role === 'assistant' &&
                parseBuildHook(messages[k].content)
              ) {
                lastBuildIdx = k
                break
              }
            }
            // Check if @frontend has a pending (unanswered) CONTEXT QUESTIONS
            // after the build message. If so, hold the Build button.
            if (lastBuildIdx !== -1) {
              const frontendPendingAfterBuild = messages.some((m, idx) =>
                idx > lastBuildIdx &&
                m.role === 'assistant' &&
                m.agent === 'frontend' &&
                parseContextQuestions(m.content)
              )
              if (frontendPendingAfterBuild) lastBuildIdx = -1
            }
            // Find all assistant messages with context questions that are
            // AFTER the last user message — those are "pending" and get the
            // interactive form. Earlier ones (already answered) stay static.
            let lastUserIdx = -1
            for (let k = messages.length - 1; k >= 0; k--) {
              if (messages[k].role === 'user') { lastUserIdx = k; break }
            }
            const ctxQFormIndices = new Set()
            for (let k = lastUserIdx + 1; k < messages.length; k++) {
              if (messages[k].role === 'assistant' && parseContextQuestions(messages[k].content)) {
                ctxQFormIndices.add(k)
              }
            }
            // When multiple agents both have pending question forms in the same
            // round, combine them into one form rendered on the LAST pending
            // message only. Earlier pending messages show nothing (no duplicate
            // forms, no stale Submit buttons).
            const ctxQFormArray = [...ctxQFormIndices]
            const combinedFormIdx = ctxQFormArray.length > 1
              ? ctxQFormArray[ctxQFormArray.length - 1]
              : null
            // Build combined questions list: [{agent, questions}]
            const combinedSections = ctxQFormArray.map(idx => ({
              agent: messages[idx].agent,
              questions: parseContextQuestions(messages[idx].content),
            }))
            return messages.map((m, i) => {
            const style =
              m.role === 'user'
                ? MSG_USER
                : parseContextQuestions(m.content)
                ? MSG_CTX_Q
                : m.agent === 'backend'
                ? MSG_BACKEND
                : MSG_FRONTEND
            const ctxQuestions = m.role === 'assistant' ? parseContextQuestions(m.content) : null
            const displayContent = ctxQuestions ? stripContextQuestions(m.content) : m.content
            const label = m.role === 'user' ? 'you' : `@${m.agent}`
            // Only the LAST assistant message with a BUILD: hook shows
            // the Build button. Earlier ones are history.
            const build =
              i === lastBuildIdx ? parseBuildHook(m.content) : null
            // Walk back from this assistant message to find the user's
            // original question — that's what should prefill the editor's
            // chat input, not our internal protocol text.
            let userQuestion = ''
            if (build) {
              for (let k = i - 1; k >= 0; k--) {
                if (messages[k].role === 'user') {
                  userQuestion = stripMentions(messages[k].content || '').trim()
                  break
                }
              }
            }
            return (
              <div key={i} style={style}>
                {m.role === 'assistant' ? (
                  <div style={{
                    ...MSG_HEADER_BAR,
                    color: AGENT_ACCENT[m.agent] || '#8b949e',
                    background: m.agent === 'backend' ? '#1f1a08' : m.agent === 'frontend' ? '#0a1a0d' : '#0d1117',
                    borderBottom: `1px solid ${m.agent === 'backend' ? '#2e2508' : m.agent === 'frontend' ? '#102016' : '#21262d'}`,
                  }}>
                    <span>@{m.agent}</span>
                    {isBlockedMessage(m.content) && (
                      <span style={BLOCKED_BADGE}>⚠ blocked</span>
                    )}
                  </div>
                ) : (
                  <div style={{ ...MSG_HEADER_BAR, color: '#388bfd', background: '#0d1926', borderBottom: '1px solid #1c3358' }}>you</div>
                )}
                <div style={m.role === 'user' ? undefined : MSG_BODY}>
                  {displayContent
                    ? splitMessageContent(displayContent).map((seg, j) =>
                        seg.type === 'code' ? (
                          <CodeBlock key={j} lang={seg.lang} code={seg.code} />
                        ) : (
                          <StructuredText key={j} text={seg.text} />
                        ),
                      )
                    : m.role === 'assistant'
                    ? '…thinking'
                    : ''}
                  {ctxQuestions && ctxQFormIndices.has(i) ? (
                    combinedFormIdx !== null && i === combinedFormIdx ? (
                      // Combined form: all pending agents' questions in one form
                      <CombinedContextForm
                        sections={combinedSections}
                        onSubmit={(text) => send(text)}
                        busy={busy}
                      />
                    ) : combinedFormIdx !== null ? (
                      // Earlier pending form — hidden, replaced by combined form above
                      null
                    ) : (
                      // Single agent — normal form
                      <ContextForm
                        questions={ctxQuestions}
                        onSubmit={(text) => send(text)}
                        busy={busy}
                      />
                    )
                  ) : (
                    <ContextQuestionsCard questions={ctxQuestions} />
                  )}
                </div>
                {build && (
                  <BuildButton
                    type={build.type}
                    id={build.id}
                    contextMessage={m.content}
                    userQuestion={userQuestion}
                    onError={(msg) => setErrMsg(msg)}
                  />
                )}
              </div>
            )
            })
          })()}

          {/* Hint shown after a Build hook exists, nudging iteration */}
          {(() => {
            // Cheap re-check — duplicates the lastBuildIdx computation but
            // keeps this hint conditional self-contained for readability.
            let has = false
            for (let k = messages.length - 1; k >= 0; k--) {
              if (
                messages[k].role === 'assistant' &&
                parseBuildHook(messages[k].content)
              ) {
                has = true
                break
              }
            }
            if (!has) return null
            return (
              <div style={{ ...HINT, marginTop: 8, fontStyle: 'normal', color: '#8b949e' }}>
                💡 Review the plan above. Type a follow-up (e.g.{' '}
                <code>@backend filter to top 3</code>) to refine, then click{' '}
                <strong>Finalize Plan</strong> again — or click the green{' '}
                <strong>Build →</strong> button when you're happy with it.
              </div>
            )
          })()}

          {errMsg && <div style={ERR}>{errMsg}</div>}
        </div>

        <div style={INPUT_BAR}>
          <div style={INPUT_INNER}>
            <textarea
              className="plan-input"
              style={INPUT}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder="Ask @backend or @frontend… (Enter to send, Shift+Enter for newline)"
              disabled={busy}
            />
            {messages.length > 0 && (
              <button
                style={FINALIZE_BTN}
                onClick={finalize}
                disabled={busy}
                title="Ask both agents to produce the final DATA SPEC + UI SPEC for the widget"
              >
                📋 Finalize Plan
              </button>
            )}
            <button style={SEND_BTN} onClick={send} disabled={!draft.trim() || busy}>
              {busy ? '…' : 'Send'}
            </button>
          </div>
          <div style={{ ...INPUT_INNER, ...TAG_HINT }}>
            Tag @backend for data questions, @frontend for UI questions. Both tags = both answer.
            Click <strong>Finalize Plan</strong> when ready to get the joint DATA + UI spec for handoff.
          </div>
        </div>
      </div>

      {/* ─── Right pipeline panel ────────────────────────────── */}
      <StepsPanel
        steps={extractStepsData(messages)}
        messages={messages}
        setErrMsg={setErrMsg}
      />
    </div>
  )
}
