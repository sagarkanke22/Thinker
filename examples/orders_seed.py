"""Seed the orders table with 30 realistic May 2026 sales rows.

Run:   python examples/orders_seed.py
       (or .venv/bin/python examples/orders_seed.py)

Idempotent — wipes orders then inserts.

The sales_report demo widgets (text.total_kpi, table.results, chart.revenue)
query this table via sqlite3 from inside the sandbox. Re-seeding here
changes what the widgets show without changing any widget code.
"""
from __future__ import annotations

from sqlalchemy import delete

from logiclive.db import Order, SessionLocal, init_db


# (date, product, qty, revenue) — 30 rows across May 2026, 5 products
ORDERS: list[tuple[str, str, int, int]] = [
    # ── Week 1 ─────────────────────────────────────────────────
    ("2026-05-01", "Coke 500ml",       12,  600),
    ("2026-05-01", "Sprite 500ml",      8,  400),
    ("2026-05-02", "Coke 500ml",       14,  700),
    ("2026-05-03", "Fanta 500ml",       9,  450),
    ("2026-05-04", "Coke Zero 500ml",  11,  550),
    ("2026-05-05", "Coke 500ml",       18,  900),
    ("2026-05-06", "Sprite 500ml",      7,  350),
    ("2026-05-07", "Fanta 500ml",       6,  300),
    # ── Week 2 ─────────────────────────────────────────────────
    ("2026-05-08", "Coke 500ml",       16,  800),
    ("2026-05-08", "Diet Coke 500ml",  10,  500),
    ("2026-05-09", "Coke Zero 500ml",  13,  650),
    ("2026-05-10", "Sprite 500ml",      9,  450),
    ("2026-05-11", "Coke 500ml",       20, 1000),
    ("2026-05-12", "Diet Coke 500ml",   8,  400),
    ("2026-05-13", "Fanta 500ml",       8,  400),
    ("2026-05-14", "Coke Zero 500ml",  12,  600),
    # ── Week 3 ─────────────────────────────────────────────────
    ("2026-05-15", "Coke Zero 500ml",  15,  750),
    ("2026-05-16", "Coke 500ml",       19,  950),
    ("2026-05-17", "Diet Coke 500ml",  11,  550),
    ("2026-05-18", "Coke 500ml",       17,  850),
    ("2026-05-19", "Sprite 500ml",      6,  300),
    ("2026-05-20", "Fanta 500ml",      10,  500),
    ("2026-05-21", "Coke Zero 500ml",  14,  700),
    # ── Week 4 ─────────────────────────────────────────────────
    ("2026-05-22", "Sprite 500ml",     10,  500),
    ("2026-05-23", "Coke 500ml",       22, 1100),
    ("2026-05-24", "Diet Coke 500ml",  12,  600),
    ("2026-05-25", "Fanta 500ml",       7,  350),
    ("2026-05-26", "Coke Zero 500ml",  16,  800),
    ("2026-05-27", "Coke 500ml",       21, 1050),
    ("2026-05-28", "Fanta 500ml",      11,  550),
]


def seed() -> int:
    """Wipe + re-seed orders. Returns rows inserted."""
    init_db()
    with SessionLocal() as session:
        session.execute(delete(Order))
        for date, product, qty, revenue in ORDERS:
            session.add(
                Order(date=date, product=product, qty=qty, revenue=revenue)
            )
        session.commit()
    return len(ORDERS)


if __name__ == "__main__":
    n = seed()
    print(f"Seeded {n} orders into orders table")
