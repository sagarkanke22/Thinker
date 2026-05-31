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

const SSE_BACKEND_BASE =
  import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'

const AGENTS = ['backend', 'frontend']
const DEFAULT_AGENT = 'backend'

// ─── styles ────────────────────────────────────────────────────────

const PAGE = {
  display: 'flex',
  height: '100%',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  background: '#fafbfc',
}
const SIDEBAR = {
  width: 240,
  borderRight: '1px solid #d0d7de',
  background: '#f6f8fa',
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
}
const SIDEBAR_HEADER = {
  padding: 10,
  borderBottom: '1px solid #d0d7de',
}
const NEW_BTN = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #2da44e',
  borderRadius: 6,
  background: '#2da44e',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 500,
}
const SIDEBAR_LIST = { flex: 1, overflowY: 'auto', padding: 6 }
const CONV_ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  margin: '2px 0',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  color: '#333',
}
const CONV_ROW_ACTIVE = { background: '#dbedff' }
const CONV_TITLE = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const CONV_DELETE = {
  border: 'none',
  background: 'transparent',
  color: '#888',
  cursor: 'pointer',
  fontSize: 14,
  padding: '0 4px',
  visibility: 'hidden',
}
const CONV_EMPTY = {
  color: '#888',
  fontStyle: 'italic',
  fontSize: 12,
  padding: 10,
}

const MAIN = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
}

// ─── Steps side-panel styles (right column) ───────────────────────

const STEPS_PANEL = {
  width: 360,
  flexShrink: 0,
  borderLeft: '1px solid #d0d7de',
  background: '#f6f8fa',
  overflowY: 'auto',
  padding: 16,
  boxSizing: 'border-box',
}
const STEPS_TITLE = {
  fontSize: 14,
  fontWeight: 600,
  color: '#1f2328',
  marginBottom: 14,
  paddingBottom: 8,
  borderBottom: '1px solid #d0d7de',
  letterSpacing: 0.2,
}
const STEP_CARD = {
  background: '#fff',
  border: '1px solid #d0d7de',
  borderRadius: 10,
  padding: '12px 14px',
  position: 'relative',
  boxShadow: '0 1px 0 rgba(27,31,36,0.04)',
}
const STEP_CARD_EMPTY = {
  ...STEP_CARD,
  background: '#fafbfc',
  borderStyle: 'dashed',
  borderColor: '#d8dee4',
  boxShadow: 'none',
}
const STEP_LABEL = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  color: '#57606a',
  marginBottom: 8,
  fontWeight: 700,
}
const STEP_BODY = {
  fontSize: 13,
  color: '#1f2328',
  lineHeight: 1.5,
  wordBreak: 'break-word',
}
const STEP_BODY_MUTED = { ...STEP_BODY, color: '#9aa3ad', fontStyle: 'italic' }
// Stacked field layout — label above value, much friendlier in a narrow
// column than the side-by-side grid (which truncated long SQL).
const STEP_FIELD = { marginTop: 8 }
const STEP_FIELD_KEY = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#8a94a0',
  fontWeight: 600,
  marginBottom: 2,
}
const STEP_FIELD_VAL = {
  fontSize: 12,
  color: '#1f2328',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  overflowWrap: 'anywhere',
  lineHeight: 1.4,
}
const STEP_ARROW = {
  textAlign: 'center',
  color: '#8957e5',
  fontSize: 20,
  lineHeight: 1,
  margin: '8px 0',
  fontWeight: 600,
}
const STEP_BUILD_CARD = {
  ...STEP_CARD,
  background: 'linear-gradient(180deg, #f1faf3 0%, #e6f5ea 100%)',
  borderColor: '#7ec895',
  boxShadow: '0 2px 6px rgba(46,160,67,0.15)',
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
  border: '1px solid #1f242c',
}
const HEADER = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 20px',
  borderBottom: '1px solid #d0d7de',
  background: '#fff',
}
const TITLE = { fontSize: 16, fontWeight: 600 }
const NAV_LINK = { fontSize: 12, color: '#0969da', textDecoration: 'none' }
const TRANSCRIPT = {
  flex: 1,
  overflowY: 'auto',
  padding: '16px 20px',
  maxWidth: 900,
  margin: '0 auto',
  width: '100%',
  boxSizing: 'border-box',
}
const HINT = {
  color: '#888',
  fontStyle: 'italic',
  fontSize: 13,
  lineHeight: 1.6,
  padding: '8px 0',
}
const MSG = {
  margin: '12px 0',
  padding: '10px 14px',
  borderRadius: 8,
  fontSize: 14,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}
const MSG_USER = { ...MSG, background: '#eaf3ff', border: '1px solid #cfe2ff' }
const MSG_BACKEND = { ...MSG, background: '#fff7e6', border: '1px solid #ffd591' }
const MSG_FRONTEND = { ...MSG, background: '#f6ffed', border: '1px solid #b7eb8f' }
const MSG_HEADER = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 4,
  color: '#555',
}
const ERR = { color: 'crimson', fontSize: 12, padding: '6px 0' }
const INPUT_BAR = {
  borderTop: '1px solid #d0d7de',
  padding: 12,
  background: '#fff',
}
const INPUT_INNER = {
  maxWidth: 900,
  margin: '0 auto',
  display: 'flex',
  gap: 8,
}
const INPUT = {
  flex: 1,
  padding: '8px 12px',
  border: '1px solid #d0d7de',
  borderRadius: 6,
  fontSize: 14,
  fontFamily: 'inherit',
  resize: 'vertical',
  minHeight: 40,
  maxHeight: 200,
}
const SEND_BTN = {
  padding: '8px 18px',
  border: '1px solid #1f6feb',
  borderRadius: 6,
  background: '#1f6feb',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 500,
}
const FINALIZE_BTN = {
  padding: '8px 14px',
  border: '1px solid #8957e5',
  borderRadius: 6,
  background: '#8957e5',
  color: '#fff',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 500,
  whiteSpace: 'nowrap',
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
const TAG_HINT = { fontSize: 11, color: '#888', margin: '4px 0 0 4px' }

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
function StepsPanel({ steps, setErrMsg }) {
  const {
    userQuestion,
    prerequisites,
    dataSpec, dataAgent,
    uiSpec, uiAgent,
    code,
    build, buildMessage,
  } = steps

  let stepNum = 0
  const nextStep = () => `${++stepNum}`

  return (
    <div style={STEPS_PANEL}>
      <div style={STEPS_TITLE}>📋 Plan to Ship the Widget</div>

      <StepCard label={`${nextStep()} · Question`} empty={!userQuestion}>
        {userQuestion}
      </StepCard>
      <div style={STEP_ARROW}>↓</div>

      {/* PREREQUISITES — shows DDL / scaffolding steps from any
          SOLUTION PLAN in the conversation. Renders only when present. */}
      {prerequisites.length > 0 && (
        <>
          <div style={{ ...STEP_CARD, borderColor: '#f4c842', background: '#fffbea' }}>
            <div style={{ ...STEP_LABEL, color: '#9a6700' }}>
              {nextStep()} · 🔧 Prerequisites
            </div>
            <div style={{ ...STEP_BODY, marginBottom: 6 }}>
              Run these before building — surfaced from agent solution plans:
            </div>
            {prerequisites.map((pre, idx) => (
              <div key={idx} style={{ marginTop: 8 }}>
                <div style={{ ...STEP_FIELD_KEY, color: '#9a6700' }}>
                  from @{pre.agent}{prerequisites.length > 1 ? ` (#${idx + 1})` : ''}
                </div>
                <pre style={{ ...STEP_CODE_PRE, background: '#fffaeb', color: '#3d2c00', border: '1px solid #f0d489' }}>
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
          <div style={{ ...STEP_LABEL, color: '#1a7f37' }}>{nextStep()} · Build</div>
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

  const send = async () => {
    const text = draft.trim()
    if (!text || busy) return
    const agents = detectAgents(text)
    const cleanPrompt = stripMentions(text) || text

    const userMsg = { role: 'user', content: text }
    let snapshot = [...messages, userMsg]
    setMessages(snapshot)
    setDraft('')
    setBusy(true)
    setErrMsg(null)

    // Lazy-create the conversation on first user turn so the sidebar
    // doesn't fill with empties.
    const id = await ensureActiveId(text)

    for (const agent of agents) {
      snapshot = await askAgent(agent, cleanPrompt, snapshot)
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
    <div style={PAGE}>
      {/* ─── Sidebar ─────────────────────────────────────────── */}
      <div style={SIDEBAR}>
        <div style={SIDEBAR_HEADER}>
          <button style={NEW_BTN} onClick={newChat}>+ New Chat</button>
        </div>
        <div style={SIDEBAR_LIST}>
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

        <div ref={scrollRef} style={TRANSCRIPT}>
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
            return messages.map((m, i) => {
            const style =
              m.role === 'user'
                ? MSG_USER
                : m.agent === 'backend'
                ? MSG_BACKEND
                : MSG_FRONTEND
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
                <div style={MSG_HEADER}>{label}</div>
                <div>
                  {m.content
                    ? splitMessageContent(m.content).map((seg, j) =>
                        seg.type === 'code' ? (
                          <CodeBlock key={j} lang={seg.lang} code={seg.code} />
                        ) : (
                          <div key={j} style={{ whiteSpace: 'pre-wrap' }}>
                            {seg.text}
                          </div>
                        ),
                      )
                    : m.role === 'assistant'
                    ? '…thinking'
                    : ''}
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
              <div style={{ ...HINT, marginTop: 8, fontStyle: 'normal', color: '#666' }}>
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
        setErrMsg={setErrMsg}
      />
    </div>
  )
}
