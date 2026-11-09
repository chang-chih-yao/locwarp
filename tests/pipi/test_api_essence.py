"""GET and PUT /api/pipi/essence through FastAPI TestClient against a TEMP
settings file (the user's real ~/.locwarp/settings.json is never read or
written), with the client's essence_marks / set_essence_mark stubbed (no
network).

Locks the response shapes `{marks: [...]}` and `{wiltingMs}`, that errors map
to HTTP the same way as items (the layer reads `code` and, on 429,
`retry_after`), that PUT hands the id to the client with its own type, and
that a PUT body with a bad field is refused before the client is called, so
nothing malformed is written to the user's site account.
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
import config  # noqa: E402

tmp = Path(tempfile.mkdtemp()) / "settings.json"
config.SETTINGS_FILE = tmp  # must happen before `import main`

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from services.pipi_mushroom import PipiError  # noqa: E402

assert main.SETTINGS_FILE == tmp, "main must use the temp settings file"
real = Path.home() / ".locwarp" / "settings.json"
real_before = real.read_bytes() if real.exists() else None

MARKS = [{"id": "9c19ee876ae44a5f9a92b68d602cc1ea.16", "bloomedMs": 1794222404790, "wiltingMs": 1794305204790}]
outcome: dict = {"marks": MARKS}


async def fake_marks():
    if "error" in outcome:
        raise outcome["error"]
    return outcome["marks"]


main.app_state.pipi_client.essence_marks = fake_marks
c = TestClient(main.app)  # no `with` -> lifespan (device scan) not run

r = c.get("/api/pipi/essence")
assert r.status_code == 200 and r.json() == {"marks": MARKS}, (r.status_code, r.text)
print("ok  200 -> {marks: [...]} as the client returned them")

for err, status, detail in (
    (PipiError("pipi_rate_limited", 429, retry_after=41.6), 429, {"code": "pipi_rate_limited", "retry_after": 42}),
    (PipiError("pipi_login_required", 401), 401, {"code": "pipi_login_required"}),
    (PipiError("pipi_no_cookie", 400), 400, {"code": "pipi_no_cookie"}),
    (PipiError("pipi_unavailable", 502, "boom"), 502, {"code": "pipi_unavailable"}),
):
    outcome["error"] = err
    r = c.get("/api/pipi/essence")
    assert r.status_code == status and r.json() == {"detail": detail}, (err.code, r.status_code, r.text)
    print(f"ok  {err.code:20s} -> HTTP {status} {detail}")

# ── PUT ──────────────────────────────────────────────────────────────
BLOOM = 1794222404790
WILT = 1794305204790
set_calls: list[tuple] = []
set_outcome: dict = {"wiltingMs": WILT}


async def fake_set(mark_id, bloomed_ms, collected):
    set_calls.append((mark_id, bloomed_ms, collected))
    if "error" in set_outcome:
        raise set_outcome["error"]
    return {"wiltingMs": set_outcome["wiltingMs"]}


main.app_state.pipi_client.set_essence_mark = fake_set

r = c.put("/api/pipi/essence", json={"id": MARKS[0]["id"], "bloomedMs": BLOOM, "collected": True})
assert r.status_code == 200 and r.json() == {"wiltingMs": WILT}, (r.status_code, r.text)
r = c.put("/api/pipi/essence", json={"id": 123456, "bloomedMs": BLOOM, "collected": False})
assert r.status_code == 200, (r.status_code, r.text)
assert set_calls == [(MARKS[0]["id"], BLOOM, True), (123456, BLOOM, False)], set_calls
assert type(set_calls[1][0]) is int, set_calls
print("ok  PUT 200 -> {wiltingMs}; the id reaches the client with its own type (str or int)")

GOOD = {"id": MARKS[0]["id"], "bloomedMs": BLOOM, "collected": True}
BAD_BODIES = [
    # id: strict str or int only, non-blank, bounded.
    {**GOOD, "id": True}, {**GOOD, "id": 7.5}, {**GOOD, "id": 7.0}, {**GOOD, "id": None},
    {**GOOD, "id": ""}, {**GOOD, "id": "   "}, {**GOOD, "id": "x" * 129}, {**GOOD, "id": 2**53}, {**GOOD, "id": -(2**53)},
    {**GOOD, "id": {"a": 1}}, {**GOOD, "id": [1]},
    {k: v for k, v in GOOD.items() if k != "id"},
    # bloomedMs: a positive integer; the frontend only offers the button then.
    {**GOOD, "bloomedMs": 0}, {**GOOD, "bloomedMs": -1}, {**GOOD, "bloomedMs": BLOOM + 0.5},
    {**GOOD, "bloomedMs": float(BLOOM)}, {**GOOD, "bloomedMs": str(BLOOM)}, {**GOOD, "bloomedMs": True},
    {**GOOD, "bloomedMs": None}, {k: v for k, v in GOOD.items() if k != "bloomedMs"},
    # collected: a real boolean.
    {**GOOD, "collected": "true"}, {**GOOD, "collected": 1}, {**GOOD, "collected": 0},
    {**GOOD, "collected": None}, {k: v for k, v in GOOD.items() if k != "collected"},
]
set_calls.clear()
for body in BAD_BODIES:
    r = c.put("/api/pipi/essence", json=body)
    assert r.status_code == 422, (body, r.status_code, r.text)
assert set_calls == [], ("a bad body must never reach the client", set_calls)
# The limits are not off by one: the longest id and the largest safe integer pass.
for body in ({**GOOD, "id": "x" * 128}, {**GOOD, "id": 2**53 - 1}, {**GOOD, "id": -(2**53 - 1)}, {**GOOD, "bloomedMs": 1}):
    r = c.put("/api/pipi/essence", json=body)
    assert r.status_code == 200, (body, r.status_code, r.text)
print(f"ok  PUT {len(BAD_BODIES)} bad bodies -> 422 without calling the client; the limits themselves pass")

for err, status, detail in (
    (PipiError("pipi_rate_limited", 429, retry_after=41.6), 429, {"code": "pipi_rate_limited", "retry_after": 42}),
    (PipiError("pipi_login_required", 401), 401, {"code": "pipi_login_required"}),
    (PipiError("pipi_no_cookie", 400), 400, {"code": "pipi_no_cookie"}),
    (PipiError("pipi_unavailable", 502, "boom"), 502, {"code": "pipi_unavailable"}),
):
    set_outcome["error"] = err
    r = c.put("/api/pipi/essence", json=GOOD)
    assert r.status_code == status and r.json() == {"detail": detail}, (err.code, r.status_code, r.text)
    print(f"ok  PUT {err.code:20s} -> HTTP {status} {detail}")

assert (real.read_bytes() if real.exists() else None) == real_before, "the real settings.json must not change"
print("ok  real ~/.locwarp/settings.json untouched")
