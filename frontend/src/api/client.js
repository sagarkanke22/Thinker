// Frontend API client — all calls go through /api which Vite proxies to
// the FastAPI backend at http://127.0.0.1:8000.
//
// Functions:
//   fetchScreen(screenId)               — list widgets on a screen
//   renderWidget(screenId, widgetId, params) — get config-with-data for one widget

const API = '/api'

async function getJSON(url) {
  const r = await fetch(url)
  if (!r.ok) {
    let detail = `HTTP ${r.status}`
    try {
      const body = await r.json()
      if (body && body.detail) detail = body.detail
    } catch (_) {
      // not JSON — leave detail as-is
    }
    throw new Error(detail)
  }
  return r.json()
}

export function fetchScreen(screenId) {
  return getJSON(`${API}/screen?screen_id=${encodeURIComponent(screenId)}`)
}

export function renderWidget(screenId, widgetId, params = {}) {
  const q = new URLSearchParams({
    screen_id: screenId,
    widget_id: widgetId,
    params: JSON.stringify(params),
  })
  return getJSON(`${API}/render?${q.toString()}`)
}
