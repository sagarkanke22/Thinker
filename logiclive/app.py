"""LogicLive FastAPI app — backend entry point.

Endpoints:
  - /health          : liveness probe (Step 3)
  - /render          : SDUI render for one widget on one screen (Step 6)

Later steps add: /screen (Step 8), /params (Step 10), /action (Step 11),
/logic + /save (Step 16), /events SSE (Step 17), /ai/generate (Step 20).
"""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from logiclive.agents import build_agent_prompt
from logiclive.ai import (
    build_prompt,
    get_db_schema_text,
    get_sample_rows_text,
    get_widget_base_config,
    get_widget_prior_logic,
    stream_llm,
)
from logiclive.db import Conversation, SessionLocal, Widget, init_db
from logiclive.sandbox import exec_logic
from logiclive.widgets_registry import KNOWN_TYPES, merge_render


# SSE subscribers — one asyncio.Queue per open /events connection. Saved
# globally; publish_widget_changed fans out to every queue on /save.
_subscribers: list[asyncio.Queue] = []


async def publish_widget_changed(screen_id: str, widget_id: str) -> None:
    """Best-effort fan-out. Subscribers that fail (full queue, dead client)
    are skipped — they will be cleaned up by their /events loop."""
    payload = {
        "type": "widget-changed",
        "screen_id": screen_id,
        "widget_id": widget_id,
    }
    for q in list(_subscribers):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


class ActionRequest(BaseModel):
    """POST /action body. Pydantic does NOT enforce non-empty strings —
    explicit truthy guards live in the handler per [C021]/[L026]."""
    screen_id: str | None = None
    widget_id: str | None = None
    params: dict | None = None


class SaveRequest(BaseModel):
    """POST /save body. NOTE: there is intentionally NO base_config field
    here — [C015] says the editor edits logic_code ONLY. Extra fields a
    client tries to send are ignored by Pydantic's default model config."""
    screen_id: str | None = None
    widget_id: str | None = None
    logic_code: str | None = None  # None = clear the logic_code


class ConversationCreateRequest(BaseModel):
    """POST /conversations body. Title is optional — first PUT will
    typically auto-derive it from the first user message."""
    title: str | None = None


class ConversationUpdateRequest(BaseModel):
    """PUT /conversations/{id} body. Either field may be omitted; only
    provided fields are written. messages REPLACES the entire array."""
    title: str | None = None
    messages: list[dict] | None = None


class DiscussRequest(BaseModel):
    """POST /ai/discuss body. One turn in the discovery chat at /plan.
    `agent` is which specialist answers (backend | frontend).
    `history` is the prior messages (each {role, agent?, content}) so the
    agent has full conversational context. Not persisted server-side."""
    prompt: str | None = None
    agent: str | None = None
    history: list[dict] | None = None


class AIGenerateRequest(BaseModel):
    """POST /ai/generate body. [C021]/[L026] — explicit truthy guards
    on all three fields live in the handler.

    `mode` controls the response shape:
      generate (default) — Python code, /save-applicable
      explain | review | optimize — prose, NOT applicable

    `history` is the per-widget chat conversation (most recent ~10 turns,
    [{role, content}]) so multi-turn references like "add a LIMIT" know
    what "it" refers to (the prior code, not just the schema). Optional.
    """
    screen_id: str | None = None
    widget_id: str | None = None
    prompt: str | None = None
    mode: str | None = "generate"
    history: list[dict] | None = None


class TestRequest(BaseModel):
    """POST /test body. Used by the editor's Test button to run a
    candidate logic_code WITHOUT persisting it to the DB. Returns
    captured stdout + result so the dev can debug.

    No screen_id / widget_id needed — this is purely transient.
    """
    logic_code: str | None = None
    params: dict | None = None


class CreateWidgetRequest(BaseModel):
    """POST /widget body. Creates a new Widget row with a server-side
    default base_config for the chosen type. AI fills in logic_code
    afterwards via the existing /ai/generate flow."""
    screen_id: str | None = None
    widget_id: str | None = None
    type: str | None = None


# [C015] base_config templates are HUMAN-defined here, not AI-generated.
# When user clicks "+ Add Widget" the backend stamps the appropriate
# template into the DB row. AI then fills in logic_code only.
WIDGET_TEMPLATES: dict[str, dict] = {
    "text":   {"type": "text",   "props": {"tag": "p"}},
    "input":  {"type": "input",  "props": {"kind": "text", "placeholder": ""}},
    "button": {"type": "button", "props": {"label": "Click me"}},
    "table":  {"type": "table",  "props": {"columns": []}},
    "chart":  {"type": "chart",  "props": {"layout": {"title": "Untitled"}}, "data": []},
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="LogicLive",
    description="Server-Driven UI platform with DB-resident logic, "
                "editable by hand or via a scoped AI chat.",
    version="0.1.0",
    lifespan=lifespan,
)

# [C017] CORS for the Vite dev server. Tight allowlist — no wildcards in prod.
# Vite may auto-bump from 5173 → 5174/5186/etc when the port is busy, so the
# allowlist covers a small range of dev-only ports. Also needed for the SSE
# bypass: ChatPanel hits backend directly instead of proxying through Vite.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):(517[0-9]|518[0-9])$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    """FastAPI dependency yielding a DB session; closes after request.

    Override via app.dependency_overrides[get_db] in tests.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/health")
def health() -> dict:
    """Liveness probe — returns {'status': 'ok'} when the app is running."""
    return {"status": "ok"}


@app.get("/render")
def render(
    screen_id: Annotated[str | None, Query()] = None,
    widget_id: Annotated[str | None, Query()] = None,
    params: Annotated[str, Query()] = "{}",
    db: Session = Depends(get_db),
) -> dict:
    """Fetch widget logic_code, execute in sandbox, return render envelope.

    [C017] Response: {type, props, data?, style?, error?}
    [C021/L026] Pydantic with default=None silently passes missing fields —
                explicit truthy guards inside the handler instead.
    """
    # [C021] / [L026] explicit guards — do not trust Pydantic defaults
    if not screen_id:
        raise HTTPException(status_code=400, detail="screen_id required")
    if not widget_id:
        raise HTTPException(status_code=400, detail="widget_id required")

    # Parse the params JSON (URL-encoded by the client)
    try:
        parsed_params = json.loads(params) if params else {}
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="params must be valid JSON")
    if not isinstance(parsed_params, dict):
        raise HTTPException(status_code=400, detail="params must be a JSON object")

    widget = db.get(Widget, (screen_id, widget_id))
    if widget is None:
        raise HTTPException(
            status_code=404,
            detail=f"widget not found: {screen_id}/{widget_id}",
        )

    base_config = widget.base_config or {}
    widget_type = base_config.get("type")
    if widget_type not in KNOWN_TYPES:
        raise HTTPException(
            status_code=500,
            detail=f"unknown widget type in base_config: {widget_type!r}",
        )

    # Static widget — no logic_code, just echo base_config
    if not widget.logic_code:
        return {
            "type": widget_type,
            "props": dict(base_config.get("props", {})),
        }

    # [C016] fresh sandbox per render — guaranteed by subprocess invocation
    sandbox_result = exec_logic(widget.logic_code, parsed_params)
    return merge_render(widget_type, base_config, sandbox_result)


@app.post("/action")
def action(
    payload: ActionRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Run a widget's logic_code as an action (button click).

    Response shape: { ok: bool, result?: dict, error?: { type, message } }
    Distinct from /render's envelope — callers care about success/failure,
    not a render config.
    """
    # [C021]/[L026] explicit guards on Pydantic body fields
    if not payload.screen_id:
        raise HTTPException(status_code=400, detail="screen_id required")
    if not payload.widget_id:
        raise HTTPException(status_code=400, detail="widget_id required")

    widget = db.get(Widget, (payload.screen_id, payload.widget_id))
    if widget is None:
        raise HTTPException(
            status_code=404,
            detail=f"widget not found: {payload.screen_id}/{payload.widget_id}",
        )

    if not widget.logic_code:
        return {"ok": True, "result": None}

    # [C016] fresh sandbox per action
    sandbox_result = exec_logic(widget.logic_code, payload.params or {})
    if "error" in sandbox_result:
        return {"ok": False, "error": sandbox_result["error"]}
    return {"ok": True, "result": sandbox_result}


@app.get("/logic")
def get_logic(
    screen_id: Annotated[str | None, Query()] = None,
    widget_id: Annotated[str | None, Query()] = None,
    db: Session = Depends(get_db),
) -> dict:
    """Return the logic_code for one widget. Used by the in-app CodeEditor."""
    if not screen_id:
        raise HTTPException(status_code=400, detail="screen_id required")
    if not widget_id:
        raise HTTPException(status_code=400, detail="widget_id required")

    widget = db.get(Widget, (screen_id, widget_id))
    if widget is None:
        raise HTTPException(
            status_code=404,
            detail=f"widget not found: {screen_id}/{widget_id}",
        )

    return {
        "screen_id": screen_id,
        "widget_id": widget_id,
        "logic_code": widget.logic_code,
    }


@app.post("/save")
async def save_logic(
    payload: SaveRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Write logic_code for one widget. [C015] — base_config is NEVER
    touched here. SaveRequest has no base_config field; we only update
    widget.logic_code.

    After commit, publishes a 'widget-changed' SSE event so any open
    LivePreview iframe refreshes immediately.
    """
    if not payload.screen_id:
        raise HTTPException(status_code=400, detail="screen_id required")
    if not payload.widget_id:
        raise HTTPException(status_code=400, detail="widget_id required")

    widget = db.get(Widget, (payload.screen_id, payload.widget_id))
    if widget is None:
        raise HTTPException(
            status_code=404,
            detail=f"widget not found: {payload.screen_id}/{payload.widget_id}",
        )

    # [C015] Explicit: only logic_code is touched. base_config is left as-is.
    widget.logic_code = payload.logic_code
    db.commit()

    await publish_widget_changed(payload.screen_id, payload.widget_id)

    return {
        "ok": True,
        "screen_id": payload.screen_id,
        "widget_id": payload.widget_id,
    }


@app.post("/widget")
async def create_widget(
    payload: CreateWidgetRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Create a new Widget row with a server-side default base_config.
    [C015] base_config comes from WIDGET_TEMPLATES — never from a client.
    logic_code is left NULL — the user fills it in via the editor or AI.

    Fires a 'widget-changed' SSE event so any open sidebar refreshes.
    """
    # [C021]/[L026] explicit truthy guards
    if not payload.screen_id:
        raise HTTPException(status_code=400, detail="screen_id required")
    if not payload.widget_id:
        raise HTTPException(status_code=400, detail="widget_id required")
    if not payload.type:
        raise HTTPException(status_code=400, detail="type required")
    if payload.type not in WIDGET_TEMPLATES:
        raise HTTPException(
            status_code=400,
            detail=f"unknown type: {payload.type!r}. Allowed: {sorted(WIDGET_TEMPLATES)}",
        )

    existing = db.get(Widget, (payload.screen_id, payload.widget_id))
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=f"widget already exists: {payload.screen_id}/{payload.widget_id}",
        )

    widget = Widget(
        screen_id=payload.screen_id,
        widget_id=payload.widget_id,
        base_config=dict(WIDGET_TEMPLATES[payload.type]),
        logic_code=None,
    )
    db.add(widget)
    db.commit()

    await publish_widget_changed(payload.screen_id, payload.widget_id)

    return {
        "ok": True,
        "screen_id": payload.screen_id,
        "widget_id": payload.widget_id,
        "type": payload.type,
    }


@app.delete("/widget/{screen_id}/{widget_id}")
async def delete_widget(
    screen_id: str,
    widget_id: str,
    db: Session = Depends(get_db),
) -> dict:
    """Hard-delete a widget. Fires `widget-changed` so any open LivePreview
    re-fetches the screen and drops the now-missing widget."""
    widget = db.get(Widget, (screen_id, widget_id))
    if widget is None:
        raise HTTPException(
            status_code=404,
            detail=f"widget not found: {screen_id}/{widget_id}",
        )
    db.delete(widget)
    db.commit()
    await publish_widget_changed(screen_id, widget_id)
    return {"ok": True, "screen_id": screen_id, "widget_id": widget_id}


@app.post("/test")
def test_logic(payload: TestRequest) -> dict:
    """Run a candidate logic_code in the sandbox WITHOUT persisting.

    Response:
      { "ok": bool, "result": dict, "stdout": str, "stderr": str,
        "duration_ms": int, "error"?: { type, message } }

    `result` is the dict returned by render(params) — or an error
    envelope from the sandbox. `stdout` is whatever the user code
    printed. `stderr` is subprocess stderr. `duration_ms` is how long
    the sandbox call took (wall-clock).

    Powers the editor's Test button — dev can vet AI-generated or
    hand-written code before clicking Save.
    """
    import time
    # [C021]/[L026] explicit truthy guard
    if not payload.logic_code:
        raise HTTPException(status_code=400, detail="logic_code required")

    t0 = time.perf_counter()
    # [C016] fresh sandbox per test
    envelope = exec_logic(
        payload.logic_code,
        payload.params or {},
        capture_stdout=True,
    )
    duration_ms = int((time.perf_counter() - t0) * 1000)
    result = envelope["result"]
    return {
        "ok": "error" not in result,
        "result": result,
        "stdout": envelope.get("stdout", ""),
        "stderr": envelope.get("stderr", ""),
        "duration_ms": duration_ms,
    }


@app.post("/ai/generate")
async def ai_generate(
    payload: AIGenerateRequest,
    db: Session = Depends(get_db),
):
    """Stream a generated `render(params)` function from the local Ollama
    model. Response is SSE:
      - event: token       data: {"text": str, "retry"?: true}
      - event: done        data: {"full_text": str, "has_return": bool, "retried": bool}
      - event: error       data: {"message": str}

    [C019] If the first attempt's text lacks the `return` keyword, append a
    fixup directive and retry ONCE.
    """
    # [C021]/[L026] explicit guards
    if not payload.screen_id:
        raise HTTPException(status_code=400, detail="screen_id required")
    if not payload.widget_id:
        raise HTTPException(status_code=400, detail="widget_id required")
    if not payload.prompt:
        raise HTTPException(status_code=400, detail="prompt required")

    mode = (payload.mode or "generate").lower()
    if mode not in {"generate", "explain", "review", "optimize"}:
        raise HTTPException(status_code=400, detail=f"unknown mode: {mode}")

    # [C018] assemble the full prompt synchronously (uses the request's DB session)
    full_prompt = build_prompt(
        payload.prompt,
        schema_text=get_db_schema_text(db.bind),
        sample_rows_text=get_sample_rows_text(db),
        base_config=get_widget_base_config(
            db, payload.screen_id, payload.widget_id
        ),
        prior_logic=get_widget_prior_logic(
            db, payload.screen_id, payload.widget_id
        ),
        mode=mode,
        history=payload.history or [],
    )

    async def stream():
        first_out: list[str] = []
        try:
            async for token in stream_llm(full_prompt):
                first_out.append(token)
                yield {"event": "token", "data": json.dumps({"text": token})}
        except Exception as e:
            yield {"event": "error",
                   "data": json.dumps({"message": str(e)})}
            return

        first_text = "".join(first_out)
        retried = False
        final_text = first_text

        # [C019] retry-once on missing explicit return — generate mode only.
        # Prose modes (explain/review/optimize) don't produce code.
        if mode == "generate" and "return" not in first_text:
            retried = True
            fixup_prompt = (
                full_prompt
                + "\n\nIMPORTANT: Your previous attempt did NOT end with "
                "an explicit `return` of a dict. Regenerate the function "
                "ending with `return {...}`."
            )
            retry_out: list[str] = []
            try:
                async for token in stream_llm(fixup_prompt):
                    retry_out.append(token)
                    yield {
                        "event": "token",
                        "data": json.dumps({"text": token, "retry": True}),
                    }
            except Exception as e:
                yield {"event": "error",
                       "data": json.dumps({"message": f"fixup failed: {e}"})}
                return
            final_text = "".join(retry_out)

        yield {
            "event": "done",
            "data": json.dumps({
                "full_text": final_text,
                "has_return": "return" in final_text,
                "retried": retried,
                "mode": mode,
            }),
        }

    return EventSourceResponse(stream())


@app.get("/conversations")
def list_conversations(db: Session = Depends(get_db)) -> list[dict]:
    """Sidebar feed for /plan. Newest first. Excludes the messages payload
    to keep the response small — sidebar only needs id/title/updated_at."""
    stmt = select(Conversation).order_by(Conversation.updated_at.desc())
    rows = db.execute(stmt).scalars().all()
    return [
        {
            "id": c.id,
            "title": c.title,
            "updated_at": c.updated_at.isoformat(),
        }
        for c in rows
    ]


@app.get("/conversations/{conv_id}")
def get_conversation(conv_id: int, db: Session = Depends(get_db)) -> dict:
    """Full payload — used when user clicks a conversation in the sidebar."""
    c = db.get(Conversation, conv_id)
    if c is None:
        raise HTTPException(status_code=404, detail=f"conversation {conv_id} not found")
    return {
        "id": c.id,
        "title": c.title,
        "messages": c.messages or [],
        "updated_at": c.updated_at.isoformat(),
    }


@app.post("/conversations")
def create_conversation(
    payload: ConversationCreateRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Create an empty conversation, return its id. Client immediately
    starts PUT'ing messages as the user chats."""
    c = Conversation(title=(payload.title or "New chat"), messages=[])
    db.add(c)
    db.commit()
    db.refresh(c)
    return {
        "id": c.id,
        "title": c.title,
        "messages": [],
        "updated_at": c.updated_at.isoformat(),
    }


@app.put("/conversations/{conv_id}")
def update_conversation(
    conv_id: int,
    payload: ConversationUpdateRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Auto-save endpoint — frontend calls this after every chat turn.
    messages REPLACES the existing array (not a delta)."""
    c = db.get(Conversation, conv_id)
    if c is None:
        raise HTTPException(status_code=404, detail=f"conversation {conv_id} not found")
    if payload.messages is not None:
        c.messages = payload.messages
    if payload.title is not None:
        c.title = payload.title
    db.commit()
    return {"ok": True, "id": c.id}


@app.delete("/conversations/{conv_id}")
def delete_conversation(conv_id: int, db: Session = Depends(get_db)) -> dict:
    """Hard-delete a saved conversation."""
    c = db.get(Conversation, conv_id)
    if c is None:
        raise HTTPException(status_code=404, detail=f"conversation {conv_id} not found")
    db.delete(c)
    db.commit()
    return {"ok": True, "id": conv_id}


@app.post("/ai/discuss")
async def ai_discuss(
    payload: DiscussRequest,
    db: Session = Depends(get_db),
):
    """Stream a specialist agent's prose answer for the /plan discovery chat.

    SSE events:
      - event: token  data: {"text": str}
      - event: done   data: {"agent": str}
      - event: error  data: {"message": str}

    No [C019] retry — this is prose, not code; no `return` to require.
    """
    # [C021]/[L026] explicit guards
    if not payload.prompt:
        raise HTTPException(status_code=400, detail="prompt required")
    if not payload.agent:
        raise HTTPException(status_code=400, detail="agent required")
    if payload.agent not in {"backend", "frontend"}:
        raise HTTPException(
            status_code=400,
            detail=f"unknown agent: {payload.agent!r}. Allowed: backend, frontend",
        )

    full_prompt = build_agent_prompt(
        agent=payload.agent,
        user_prompt=payload.prompt,
        history=payload.history or [],
        db=db,
    )

    async def stream():
        try:
            async for token in stream_llm(full_prompt):
                yield {"event": "token", "data": json.dumps({"text": token})}
        except Exception as e:
            yield {"event": "error",
                   "data": json.dumps({"message": str(e)})}
            return
        yield {"event": "done", "data": json.dumps({"agent": payload.agent})}

    return EventSourceResponse(stream())


@app.get("/events")
async def events():
    """Server-Sent Events stream. Emits 'widget-changed' events when /save
    fires; heartbeat 'ping' every 20s so proxies don't kill idle connections."""
    async def stream():
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        _subscribers.append(q)
        try:
            while True:
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=20.0)
                    yield {
                        "event": "widget-changed",
                        "data": json.dumps(payload),
                    }
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "keepalive"}
        finally:
            if q in _subscribers:
                _subscribers.remove(q)

    return EventSourceResponse(stream())


@app.get("/screen")
def screen(
    screen_id: Annotated[str | None, Query()] = None,
    db: Session = Depends(get_db),
) -> dict:
    """List the widgets that compose a screen — used by the AppRenderer
    to know what to fetch via /render."""
    if not screen_id:
        raise HTTPException(status_code=400, detail="screen_id required")

    stmt = (
        select(Widget.widget_id, Widget.base_config)
        .where(Widget.screen_id == screen_id)
        .order_by(Widget.sort_order, Widget.widget_id)
    )
    rows = db.execute(stmt).all()
    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"no widgets for screen_id={screen_id!r}",
        )
    return {
        "screen_id": screen_id,
        "widgets": [
            {
                "widget_id": r.widget_id,
                "type": (r.base_config or {}).get("type"),
            }
            for r in rows
        ],
    }


class ReorderRequest(BaseModel):
    widget_ids: list[str]


@app.put("/screen/order")
def reorder_widgets(
    screen_id: Annotated[str | None, Query()] = None,
    body: ReorderRequest = None,
    db: Session = Depends(get_db),
) -> dict:
    """Persist widget display order for a screen. widget_ids is the full
    ordered list — each widget gets sort_order = its index in the list."""
    if not screen_id:
        raise HTTPException(status_code=400, detail="screen_id required")
    for idx, widget_id in enumerate(body.widget_ids):
        widget = db.get(Widget, (screen_id, widget_id))
        if widget:
            widget.sort_order = idx
    db.commit()
    return {"ok": True}
