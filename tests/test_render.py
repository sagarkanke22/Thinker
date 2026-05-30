"""Tests for the /render endpoint in logiclive/app.py.

Validation criteria from the flow file:
  - missing_screen_id_returns_400
  - missing_widget_id_returns_400
  - happy_path_returns_config
  - logic_error_returns_error_field
"""
from __future__ import annotations

import json
import os
import tempfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from logiclive.app import app, get_db
from logiclive.db import Base, Widget, make_engine


@pytest.fixture
def client():
    """TestClient wired to an isolated SQLite DB seeded with known widgets."""
    fd, path = tempfile.mkstemp(suffix=".test_render.db")
    os.close(fd)
    engine = make_engine(f"sqlite:///{path}")
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    with TestSession() as s:
        s.add_all([
            # 1. happy text widget — logic returns children
            Widget(
                screen_id="t",
                widget_id="hello",
                base_config={"type": "text", "props": {"style": {"fontSize": 16}}},
                logic_code=(
                    "def render(params):\n"
                    "    name = params.get('name', 'world')\n"
                    "    return {'children': f'hi {name}'}\n"
                ),
            ),
            # 2. table widget with data + props override
            Widget(
                screen_id="t",
                widget_id="grid",
                base_config={
                    "type": "table",
                    "props": {"columns": ["product", "qty"]},
                },
                logic_code=(
                    "def render(params):\n"
                    "    return {\n"
                    "        'data': [{'product': 'X', 'qty': 5}],\n"
                    "        'props': {'footer': 'Total: 5'},\n"
                    "    }\n"
                ),
            ),
            # 3. widget whose logic raises — exercises error envelope
            Widget(
                screen_id="t",
                widget_id="broken",
                base_config={"type": "text"},
                logic_code="def render(params):\n    return 1 / 0\n",
            ),
            # 4. static widget — no logic_code
            Widget(
                screen_id="t",
                widget_id="static",
                base_config={"type": "text", "props": {"children": "always-this"}},
                logic_code=None,
            ),
            # 5. unknown type — exercises 500 guard
            Widget(
                screen_id="t",
                widget_id="alien",
                base_config={"type": "frobnicator"},
                logic_code=None,
            ),
        ])
        s.commit()

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()

    engine.dispose()
    if os.path.exists(path):
        os.remove(path)


def test_missing_screen_id_returns_400(client):
    r = client.get("/render", params={"widget_id": "hello"})
    assert r.status_code == 400
    assert "screen_id" in r.json()["detail"]


def test_missing_widget_id_returns_400(client):
    r = client.get("/render", params={"screen_id": "t"})
    assert r.status_code == 400
    assert "widget_id" in r.json()["detail"]


def test_empty_string_screen_id_also_returns_400(client):
    """[C021] explicit truthy check — empty string must not slip through."""
    r = client.get("/render", params={"screen_id": "", "widget_id": "hello"})
    assert r.status_code == 400


def test_invalid_json_params_returns_400(client):
    r = client.get("/render", params={"screen_id": "t", "widget_id": "hello",
                                       "params": "not-json"})
    assert r.status_code == 400
    assert "params" in r.json()["detail"]


def test_non_object_params_returns_400(client):
    r = client.get("/render", params={"screen_id": "t", "widget_id": "hello",
                                       "params": "[1,2,3]"})
    assert r.status_code == 400


def test_widget_not_found_returns_404(client):
    r = client.get("/render", params={"screen_id": "t", "widget_id": "ghost"})
    assert r.status_code == 404


def test_happy_path_returns_config(client):
    r = client.get("/render", params={
        "screen_id": "t",
        "widget_id": "hello",
        "params": json.dumps({"name": "sagar"}),
    })
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "text"
    assert body["children"] == "hi sagar"
    assert body["props"]["style"] == {"fontSize": 16}  # from base_config


def test_table_widget_merges_data_and_props_overrides(client):
    r = client.get("/render", params={"screen_id": "t", "widget_id": "grid"})
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "table"
    assert body["data"] == [{"product": "X", "qty": 5}]
    assert body["props"]["columns"] == ["product", "qty"]
    assert body["props"]["footer"] == "Total: 5"


def test_logic_error_returns_error_field(client):
    r = client.get("/render", params={"screen_id": "t", "widget_id": "broken"})
    # endpoint itself returns 200 — sandbox catches the runtime error
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "text"
    assert "error" in body
    assert body["error"]["type"] == "runtime"
    assert "ZeroDivisionError" in body["error"]["message"]


def test_static_widget_no_logic_returns_base_config(client):
    r = client.get("/render", params={"screen_id": "t", "widget_id": "static"})
    assert r.status_code == 200
    body = r.json()
    assert body == {"type": "text", "props": {"children": "always-this"}}


def test_unknown_widget_type_returns_500(client):
    r = client.get("/render", params={"screen_id": "t", "widget_id": "alien"})
    assert r.status_code == 500
    assert "frobnicator" in r.json()["detail"]


# ───────────────────────────────────────────────────────────────────
# /logic + /save (Step 16)
# ───────────────────────────────────────────────────────────────────

def test_logic_missing_screen_returns_400(client):
    r = client.get("/logic", params={"widget_id": "hello"})
    assert r.status_code == 400


def test_logic_missing_widget_returns_400(client):
    r = client.get("/logic", params={"screen_id": "t"})
    assert r.status_code == 400


def test_logic_not_found_returns_404(client):
    r = client.get("/logic", params={"screen_id": "t", "widget_id": "ghost"})
    assert r.status_code == 404


def test_logic_returns_code_for_widget_with_logic(client):
    r = client.get("/logic", params={"screen_id": "t", "widget_id": "hello"})
    assert r.status_code == 200
    body = r.json()
    assert body["screen_id"] == "t"
    assert body["widget_id"] == "hello"
    assert "def render(params)" in body["logic_code"]


def test_logic_returns_null_for_static_widget(client):
    r = client.get("/logic", params={"screen_id": "t", "widget_id": "static"})
    assert r.status_code == 200
    assert r.json()["logic_code"] is None


def test_save_updates_logic_code(client):
    new_code = "def render(params):\n    return {'children': 'changed!'}\n"
    r = client.post("/save", json={
        "screen_id": "t",
        "widget_id": "hello",
        "logic_code": new_code,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    # Confirm via /logic
    r2 = client.get("/logic", params={"screen_id": "t", "widget_id": "hello"})
    assert r2.json()["logic_code"] == new_code


def test_save_can_clear_logic_code(client):
    r = client.post("/save", json={
        "screen_id": "t",
        "widget_id": "hello",
        "logic_code": None,
    })
    assert r.status_code == 200
    r2 = client.get("/logic", params={"screen_id": "t", "widget_id": "hello"})
    assert r2.json()["logic_code"] is None


def test_save_does_not_touch_base_config(client):
    """[C015] base_config is human-only; /save must not modify it even if
    a misbehaving client sends one."""
    # Sneak a base_config field — Pydantic should ignore it
    r = client.post("/save", json={
        "screen_id": "t",
        "widget_id": "hello",
        "logic_code": "def render(p): return {'children': 'x'}",
        "base_config": {"type": "EVIL_OVERRIDE", "props": {"hacked": True}},
    })
    assert r.status_code == 200
    # The render should still return type=text (from the original base_config)
    r2 = client.get("/render", params={"screen_id": "t", "widget_id": "hello"})
    body = r2.json()
    assert body["type"] == "text"  # unchanged
    assert "hacked" not in (body.get("props", {}) or {})


def test_save_missing_screen_returns_400(client):
    r = client.post("/save", json={"widget_id": "x", "logic_code": "pass"})
    assert r.status_code == 400


def test_save_missing_widget_returns_400(client):
    r = client.post("/save", json={"screen_id": "t", "logic_code": "pass"})
    assert r.status_code == 400


def test_save_unknown_widget_returns_404(client):
    r = client.post("/save", json={
        "screen_id": "t",
        "widget_id": "ghost",
        "logic_code": "pass",
    })
    assert r.status_code == 404


# ───────────────────────────────────────────────────────────────────
# /ai/generate (Step 20) — stream_ollama is monkeypatched so the tests
# don't need a live Ollama daemon.
# ───────────────────────────────────────────────────────────────────

def _good_stream_factory():
    """Returns a fake stream_ollama that emits a valid render function."""
    async def fake(prompt, *args, **kwargs):
        for tok in ["def render(params):\n", "    return ",
                    "{'children': 'mocked'}\n"]:
            yield tok
    return fake


def _retry_stream_factory():
    """First call yields bad output (no `return`); retry yields good."""
    async def fake(prompt, *args, **kwargs):
        if "IMPORTANT" in prompt:
            for tok in ["def render(p):\n", "    return ",
                        "{'x': 1}\n"]:
                yield tok
        else:
            for tok in ["def render(p):\n", "    pass\n"]:
                yield tok
    return fake


def _erroring_stream_factory():
    async def fake(prompt, *args, **kwargs):
        if False:
            yield ""  # make it an async generator
        raise RuntimeError("ollama down")
    return fake


def test_ai_generate_missing_screen_returns_400(client):
    r = client.post("/ai/generate", json={"widget_id": "x", "prompt": "y"})
    assert r.status_code == 400


def test_ai_generate_missing_widget_returns_400(client):
    r = client.post("/ai/generate", json={"screen_id": "t", "prompt": "y"})
    assert r.status_code == 400


def test_ai_generate_missing_prompt_returns_400(client):
    r = client.post("/ai/generate", json={"screen_id": "t", "widget_id": "hello"})
    assert r.status_code == 400


def test_ai_generate_happy_path_emits_token_and_done_events(client, monkeypatch):
    monkeypatch.setattr("logiclive.app.stream_ollama", _good_stream_factory())
    r = client.post("/ai/generate", json={
        "screen_id": "t", "widget_id": "hello", "prompt": "say hi",
    })
    assert r.status_code == 200
    body = r.text
    assert "event: token" in body
    assert "event: done" in body
    assert "def render" in body
    assert "has_return" in body
    assert '"retried": false' in body


def test_ai_generate_C019_retries_when_no_return(client, monkeypatch):
    """[C019] proof: if attempt 1 lacks `return`, server retries once with
    a fixup directive; final output has has_return=true + retried=true."""
    monkeypatch.setattr("logiclive.app.stream_ollama", _retry_stream_factory())
    r = client.post("/ai/generate", json={
        "screen_id": "t", "widget_id": "hello", "prompt": "anything",
    })
    assert r.status_code == 200
    body = r.text
    # Retry tokens should be marked
    assert '"retry": true' in body
    # Final done payload should report has_return=true and retried=true
    assert '"has_return": true' in body
    assert '"retried": true' in body


def test_ai_generate_propagates_ollama_errors(client, monkeypatch):
    monkeypatch.setattr("logiclive.app.stream_ollama", _erroring_stream_factory())
    r = client.post("/ai/generate", json={
        "screen_id": "t", "widget_id": "hello", "prompt": "anything",
    })
    assert r.status_code == 200  # SSE response starts before the error
    body = r.text
    assert "event: error" in body
    assert "ollama down" in body
