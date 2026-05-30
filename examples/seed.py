"""Seed the demo `sales_report` screen from YAML.

Run:    python examples/seed.py
Effect: wipes any existing widgets for `screen_id == sales_report` and
        re-inserts them from examples/sales_report.yaml.

Idempotent — safe to re-run.

[C014] YAML uses canonical SDUI vocab (screen_id, widget_id, base_config,
       logic_code).
"""
from __future__ import annotations

from pathlib import Path

import yaml
from sqlalchemy import delete

from logiclive.db import SessionLocal, Widget, init_db


YAML_PATH = Path(__file__).parent / "sales_report.yaml"


def seed_from_yaml(yaml_path: Path = YAML_PATH) -> int:
    """Wipe + re-insert widgets from a single YAML file.

    Returns the number of widget rows inserted.
    """
    with yaml_path.open() as f:
        spec = yaml.safe_load(f)

    screen_id = spec["screen_id"]
    widgets = spec["widgets"]

    init_db()
    with SessionLocal() as session:
        session.execute(delete(Widget).where(Widget.screen_id == screen_id))
        for w in widgets:
            session.add(
                Widget(
                    screen_id=screen_id,
                    widget_id=w["widget_id"],
                    base_config=w["base_config"],
                    logic_code=w.get("logic_code"),
                )
            )
        session.commit()
    return len(widgets)


if __name__ == "__main__":
    n = seed_from_yaml()
    print(f"Seeded {n} widgets for screen_id='sales_report' from {YAML_PATH.name}")
