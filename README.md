# LogicLive

> Server-Driven UI for internal tools. Business logic lives in a database
> and can be edited by hand or via a scoped **local** AI chat. No deploy
> needed for logic changes.

**Status:** MVP build for the Damco Builder Challenge (Track A — Engineer).
This README will grow in the polish phase (Step 23 of the build plan).

---

## What it is

LogicLive splits an internal tool into two layers:

- **UI config** (`base_config`) — declarative widget shape per row in the
  `widgets` table. Written by a developer, version-controlled. The frontend
  is a generic config-renderer that knows 5 widget types
  (text · input · button · table · chart) and nothing app-specific.
- **Business logic** (`logic_code`) — Python source per widget, stored in
  SQLite. Edited by hand in an in-app Monaco editor, or via a chat that
  talks to a **local Ollama model**. Executed in a fresh sandboxed
  subprocess per `/render` call.

Backend = FastAPI · Frontend = React + Vite · AI = Ollama (local).
**No API key. No data leaves your machine.**

---

## Prerequisites

1. **Python 3.11+**
2. **Node.js 18+ and npm**
3. **Ollama** — required for the AI chat features (build Steps 19-21).

   ```bash
   # Install Ollama: https://ollama.ai/download
   ollama pull qwen2.5-coder:7b
   ollama serve   # daemon on http://localhost:11434
   ```

   You can swap in another code model by overriding `OLLAMA_MODEL`
   in `.env`. Editing widgets *by hand* in the in-app Monaco editor
   works without Ollama running.

---

## Quickstart

```bash
# 1. clone this repo
cd LogicLive

# 2. backend deps inside a venv
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"

# 3. seed the demo screen
.venv/bin/python examples/seed.py

# 4. terminal A — run the backend
.venv/bin/uvicorn logiclive.app:app --reload

# 5. terminal B — run the frontend
cd frontend && npm install && npm run dev
```

Then open:

- <http://localhost:5173/app?screen=sales_report> — end-user view
- <http://localhost:5173/editor?screen=sales_report> — dev editor with chat

---

## Architecture

```
┌──────────────────── BROWSER ────────────────────┐
│                                                  │
│   /app?screen=X            /editor?screen=X      │
│   ┌─────────────┐          ┌──────────────────┐ │
│   │ AppRenderer │          │ Editor           │ │
│   │ ─────────── │          │ ┌────┬────┬────┐ │ │
│   │ Text / Input│          │ │Tree│Code│Chat│ │ │
│   │ Button/Table│          │ │    │Edit│    │ │ │
│   │ Chart       │          │ │    ├────┤    │ │ │
│   │             │          │ │    │Pvw │    │ │ │
│   └─────────────┘          │ └────┴────┴────┘ │ │
│                            └──────────────────┘ │
│              │                       │           │
└──────────────┼───────────────────────┼───────────┘
               │   /api/* (Vite proxy :5173 → :8000)
               ▼                       ▼
┌──────────────── FASTAPI BACKEND ────────────────┐
│                                                  │
│   GET  /render   POST /action   POST /save       │
│   GET  /logic    GET  /screen   GET  /events SSE │
│   POST /ai/generate SSE                          │
│                                                  │
│       │                 │                        │
│       ▼                 ▼                        │
│   ┌────────┐    ┌──────────────────┐            │
│   │ SQLite │    │ Subprocess       │            │
│   │ widgets│    │ sandbox          │            │
│   │ table  │    │ • timeout 5s     │            │
│   │        │    │ • RLIMIT_AS      │            │
│   │ screen │    │ • restricted     │            │
│   │ _id    │    │   builtins       │            │
│   │ widget │    │ • allowlist      │            │
│   │ _id    │    │   imports        │            │
│   │ base   │    └──────────────────┘            │
│   │ _config│                                     │
│   │ logic  │    ┌──────────────────┐            │
│   │ _code  │    │ Ollama HTTP      │ ─→ local   │
│   └────────┘    │ /api/generate    │   model    │
│                 │ [C018] prompt    │ (qwen2.5)  │
│                 └──────────────────┘            │
└──────────────────────────────────────────────────┘

C014 vocab : widget_id · screen_id · base_config · logic_code
C015      : base_config is human-only · logic_code is dev-OR-AI
C016      : fresh sandbox per /render call
C019      : every generated logic ends with explicit `return`
```

| Layer | Tech | Role |
|---|---|---|
| Frontend | React 18 + Vite 5 | Generic SDUI renderer + editor |
| Backend | FastAPI + SQLAlchemy 2 | `/render`, `/save`, `/events` (SSE), … |
| DB | SQLite | One row per widget: `(screen_id, widget_id, base_config, logic_code)` |
| Sandbox | Subprocess + `RLIMIT_AS` | Each `/render` call execs Python in isolation |
| Charts | react-plotly.js + plotly.js-dist-min | Chart widget |
| Code editor | Monaco | Python editing inside the browser |
| AI | Ollama (local) | Code generation scoped to one widget handler |

### Key endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/render`       | Execute one widget's logic, return config-with-data |
| `POST` | `/action`       | Run a button widget's logic (side-effect actions) |
| `POST` | `/save`         | Update a widget's `logic_code` (editor save) |
| `GET`  | `/logic`        | Read a widget's current `logic_code` |
| `GET`  | `/screen`       | List the widgets that compose a screen |
| `GET`  | `/events`       | SSE stream of `widget-changed` events |
| `POST` | `/ai/generate`  | AI rewrites/generates a widget's `logic_code` (Step 20) |

---

## Environment

Copy `.env.example` to `.env` and adjust if you need different ports
or a different Ollama model.

```bash
cp .env.example .env
```

Variables:

| Var | Default | Notes |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `qwen2.5-coder:7b` | Any Ollama-installed model |
| `DB_PATH` | `./logiclive.db` | SQLite file |
| `LOGICLIVE_HOST` | `127.0.0.1` | Backend bind |
| `LOGICLIVE_PORT` | `8000` | Backend port (also Vite proxy target) |
| `FRONTEND_PORT` | `5173` | Vite dev server |

---

## Honest tradeoffs

### Architecture & scale

- **Sandbox** is a Python subprocess with `RLIMIT_AS` + restricted builtins
  (no `__import__`, `eval`, `exec`, `open`, …). Good for MVP and demos;
  for hostile multi-tenant use, switch to containers or WASM-Python
  (Pyodide).
- **AI quality** depends on the local model. `qwen2.5-coder:7b` handles
  small Python functions well but isn't GPT-4. Swap providers in
  `logiclive/ai.py` — both `call_ollama` and `stream_ollama` are pure
  async wrappers around an HTTP endpoint, so any OpenAI-compatible
  endpoint plugs in with a few lines.
- **Multi-worker scale**: the SSE fan-out uses an in-process
  `asyncio.Queue` per subscriber. Single uvicorn worker = fine. For
  `gunicorn -w N`, switch to a shared broker (Redis pub/sub, NATS).
- **Latency**: every interaction is a backend round-trip per affected
  widget. For typical internal-tool data volumes this is fine; for
  high-frequency UIs add caching for static widgets and debouncing for
  inputs (the Input widget already debounces 300ms).
- **Sandbox isolation is process-level only**. Two requests can't share
  module state, but they DO share the parent's filesystem view. Tighten
  this with `os.chroot` or containers for true multi-tenant deployment.

### Code surface & limits

- The widget library has **5 types** by design (not 50). Add one in
  `logiclive/widgets_registry.py` (server) + `frontend/src/widgets/`
  (client) + register in `widgets/index.js`. Total: ~50 lines per type.
- **No layout editor**: UI config is YAML/JSON written by hand. By
  design — see "Deterministic shell, AI brain" below.
- **No real diff view** in the chat — proposed code shows as a code
  block. A polish pass could use `diff-match-patch` or Monaco's diff
  mode.
- **Version history** for `logic_code` isn't kept. Production needs a
  `widget_logic_history` table with insert-on-save + rollback.

### Known papercuts

- **`datetime.utcnow()`** is deprecated in Python 3.12; SQLAlchemy's
  default factory still emits this warning. Migrate to
  `datetime.now(datetime.UTC)` at polish.
- **`asyncio_mode = "auto"`** in `pyproject.toml` is harmless but
  requires `pytest-asyncio` (installed via `[dev]` extra).

### Deterministic shell, AI brain

This is the one architectural decision worth defending in writing:

| Layer | Who edits | Why |
|---|---|---|
| Widget library (text/input/table/chart/button) | Framework devs | Battle-tested, accessible, predictable |
| UI config (`base_config`) | Application devs | Layouts must be reviewable and version-controlled |
| Business logic (`logic_code`) | Application devs **OR** AI | Changes constantly, well-suited to LLM generation |

AI is **deliberately not allowed** to write UI config — the `SaveRequest`
model has no `base_config` field. This sidesteps Bolt/v0's failure mode
where the AI rewrites layouts unpredictably between sessions.

---

## Project layout

```
logiclive/                Python package
  app.py                  FastAPI app + endpoints
  db.py                   SQLAlchemy models + engine factory
  sandbox.py              Subprocess sandbox runner
  ai.py                   Ollama client (Step 19)
  widgets_registry.py     KNOWN_TYPES + merge_render helper

frontend/                 React + Vite app
  src/AppRenderer.jsx     Generic config-renderer (end-user view)
  src/Editor.jsx          3-pane editor shell
  src/widgets/*.jsx       Text, Input, Button, Table, Chart
  src/editor/*.jsx        WidgetTree, CodeEditor, LivePreview, ChatPanel

examples/seed.py          Demo `sales_report` screen
tests/                    pytest — db, sandbox, render, /logic, /save
```

---

## License

MIT.
