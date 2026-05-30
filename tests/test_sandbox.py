"""Tests for logiclive/sandbox.py.

Validation criteria from the flow file:
  - happy_path
  - timeout_kill
  - blocked_import
  - exception_caught

Plus extra coverage of the error envelope contract.
"""
from __future__ import annotations

from logiclive.sandbox import exec_logic


def test_happy_path():
    code = """
def render(params):
    return {"type": "text", "children": "hello " + params.get("name", "world")}
"""
    result = exec_logic(code, {"name": "sagar"})
    assert result == {"type": "text", "children": "hello sagar"}


def test_timeout_kill():
    code = """
def render(params):
    while True:
        pass
"""
    result = exec_logic(code, {}, timeout=0.4)
    assert "error" in result
    assert result["error"]["type"] == "timeout"


def test_blocked_import_via_import_statement():
    code = """
def render(params):
    import os
    return {"cwd": os.getcwd()}
"""
    result = exec_logic(code, {})
    assert "error" in result
    assert result["error"]["type"] == "runtime"


def test_blocked_dunder_import_directly():
    code = """
def render(params):
    return {"forced": __import__("os").getcwd()}
"""
    result = exec_logic(code, {})
    assert "error" in result
    assert result["error"]["type"] == "runtime"


def test_exception_caught():
    code = """
def render(params):
    return 1 / 0
"""
    result = exec_logic(code, {})
    assert result["error"]["type"] == "runtime"
    assert "ZeroDivisionError" in result["error"]["message"]


def test_no_render_function_defined():
    code = """
def some_other_function(params):
    return {"hi": "bye"}
"""
    result = exec_logic(code, {})
    assert result["error"]["type"] == "no_render"


def test_render_returns_non_dict():
    code = """
def render(params):
    return [1, 2, 3]
"""
    result = exec_logic(code, {})
    assert result["error"]["type"] == "non_dict"


def test_render_returns_non_json_serializable():
    code = """
def render(params):
    return {"set_thing": {1, 2, 3}}
"""
    result = exec_logic(code, {})
    assert result["error"]["type"] == "non_serializable"


def test_allowlisted_modules_available():
    """math, datetime, sqlite3, statistics, json available without import."""
    code = """
def render(params):
    return {
        "pi_round": round(math.pi, 4),
        "year": datetime.datetime(2026, 1, 1).year,
        "mean": statistics.mean([1, 2, 3]),
    }
"""
    result = exec_logic(code, {})
    assert "error" not in result
    assert result == {"pi_round": 3.1416, "year": 2026, "mean": 2}


def test_user_print_does_not_pollute_output():
    """If user code prints, stdout should still be valid JSON for us."""
    code = """
def render(params):
    print("garbage that should be swallowed")
    print("more garbage")
    return {"clean": True}
"""
    result = exec_logic(code, {})
    assert result == {"clean": True}


def test_params_threading():
    code = """
def render(params):
    return {"echo": params}
"""
    result = exec_logic(code, {"a": 1, "b": ["x", "y"], "c": {"nested": True}})
    assert result == {"echo": {"a": 1, "b": ["x", "y"], "c": {"nested": True}}}


def test_syntax_error_returns_runtime():
    code = "def render(params):\n    return {{{"  # broken syntax
    result = exec_logic(code, {})
    assert result["error"]["type"] == "runtime"
