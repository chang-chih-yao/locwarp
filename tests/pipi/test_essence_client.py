"""PipiMushroomClient.essence_marks() reads the account's 拿過精華 marks
(GLOSSARY.md) from the site's FlowerEssenceData endpoint, and
set_essence_mark() marks or cancels one. No network: `request` is faked and
records every call, like test_items_min_zoom.py.

What this locks:
- the endpoint and the exact `{action: "list"}` payload, the site's own call;
- normalisation into `{id: str, bloomedMs: int, wiltingMs: int}`, so the
  frontend's identity rule sees one shape whatever type the site sends;
- an answer with no `items` list is pipi_unavailable, not an empty list;
- the set payload `{action: "set", mapObjectId, bloomedTimeMs, collected}`
  with the id's own type, and its answer read as `{wiltingMs}` (0 when unset);
- no cache: every call reaches `request`, because the list is read once per
  fetch loop and a cached answer would hide marks made on the phone;
- PipiError from `request` (login, rate limit) propagates unchanged from both
  methods, so the API maps it to the same HTTP codes as items.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
import services.pipi_mushroom as pm  # noqa: E402

BLOOM = 1_762_318_560_000
WILT = BLOOM + 23 * 3600 * 1000

calls: list[tuple[str, dict]] = []
reply: dict = {}


async def fake_request(endpoint, payload):
    calls.append((endpoint, payload))
    return reply


c = pm.PipiMushroomClient()
c.request = fake_request

# ── payload ──────────────────────────────────────────────────────────
reply = {"items": []}
asyncio.run(c.essence_marks())
assert calls == [("Handlers/FlowerEssenceData.ashx", {"action": "list"})], calls
print("ok  list: one call to Handlers/FlowerEssenceData.ashx with exactly {action: list}")

# ── normalisation ───────────────────────────────────────────────────
reply = {"items": [
    # A numeric id becomes a string; surrounding spaces go.
    {"mapObjectId": 123456, "bloomedTimeMs": BLOOM, "wiltingTimeMs": WILT},
    {"mapObjectId": "  abc-7  ", "bloomedTimeMs": BLOOM, "wiltingTimeMs": WILT},
    # A fractional bloom time is floored, matching the identity rule.
    {"mapObjectId": "frac", "bloomedTimeMs": BLOOM + 0.9, "wiltingTimeMs": WILT},
    # Dropped: empty id, blank id, missing id, bloom 0, negative, string, missing.
    {"mapObjectId": "", "bloomedTimeMs": BLOOM, "wiltingTimeMs": WILT},
    {"mapObjectId": "   ", "bloomedTimeMs": BLOOM, "wiltingTimeMs": WILT},
    {"bloomedTimeMs": BLOOM, "wiltingTimeMs": WILT},
    {"mapObjectId": {"x": 1}, "bloomedTimeMs": BLOOM, "wiltingTimeMs": WILT},
    {"mapObjectId": True, "bloomedTimeMs": BLOOM, "wiltingTimeMs": WILT},
    # A float id: Python's "7.0" would never equal the frontend's String(7.0) "7".
    {"mapObjectId": 7.0, "bloomedTimeMs": BLOOM, "wiltingTimeMs": WILT},
    {"mapObjectId": "zero", "bloomedTimeMs": 0, "wiltingTimeMs": WILT},
    {"mapObjectId": "neg", "bloomedTimeMs": -5, "wiltingTimeMs": WILT},
    {"mapObjectId": "str", "bloomedTimeMs": str(BLOOM), "wiltingTimeMs": WILT},
    {"mapObjectId": "nobloom", "wiltingTimeMs": WILT},
    {"mapObjectId": "bool", "bloomedTimeMs": True, "wiltingTimeMs": WILT},
    # Kept with wiltingMs 0: missing, null, string, negative, non-finite.
    {"mapObjectId": "nowilt", "bloomedTimeMs": BLOOM},
    {"mapObjectId": "nullwilt", "bloomedTimeMs": BLOOM, "wiltingTimeMs": None},
    {"mapObjectId": "strwilt", "bloomedTimeMs": BLOOM, "wiltingTimeMs": str(WILT)},
    {"mapObjectId": "negwilt", "bloomedTimeMs": BLOOM, "wiltingTimeMs": -1},
    {"mapObjectId": "infwilt", "bloomedTimeMs": BLOOM, "wiltingTimeMs": float("inf")},
    # Not a dict at all.
    "garbage", None, 42,
]}
marks = asyncio.run(c.essence_marks())
assert marks == [
    {"id": "123456", "bloomedMs": BLOOM, "wiltingMs": WILT},
    {"id": "abc-7", "bloomedMs": BLOOM, "wiltingMs": WILT},
    {"id": "frac", "bloomedMs": BLOOM, "wiltingMs": WILT},
    {"id": "nowilt", "bloomedMs": BLOOM, "wiltingMs": 0},
    {"id": "nullwilt", "bloomedMs": BLOOM, "wiltingMs": 0},
    {"id": "strwilt", "bloomedMs": BLOOM, "wiltingMs": 0},
    {"id": "negwilt", "bloomedMs": BLOOM, "wiltingMs": 0},
    {"id": "infwilt", "bloomedMs": BLOOM, "wiltingMs": 0},
], marks
assert all(type(m["bloomedMs"]) is int and type(m["wiltingMs"]) is int for m in marks), marks
print("ok  normalise: id -> trimmed str, bloomedMs floored int, bad rows dropped, bad wiltingMs -> 0")

# The site's format changed and sends no `items` list: an error, not an
# empty list. An empty list would show every 拿過精華 flower with no hint;
# pipi_unavailable makes the panel say 精華標記讀取失敗 (user story 33).
for bad in ({}, {"items": None}, {"items": "x"}, {"items": {"a": 1}}):
    reply = bad
    try:
        asyncio.run(c.essence_marks())
    except pm.PipiError as e:
        assert (e.code, e.status) == ("pipi_unavailable", 502), (bad, e.code, e.status)
    else:
        raise AssertionError(f"{bad} must raise pipi_unavailable, not read as no marks")
reply = {"items": []}
assert asyncio.run(c.essence_marks()) == []
print("ok  missing or non-list items -> pipi_unavailable; items: [] -> no marks")

# ── no cache ─────────────────────────────────────────────────────────
calls.clear()
reply = {"items": [{"mapObjectId": 1, "bloomedTimeMs": BLOOM, "wiltingTimeMs": WILT}]}
asyncio.run(c.essence_marks())
asyncio.run(c.essence_marks())
assert len(calls) == 2, ("each read must reach the site; no cache", calls)
print("ok  no cache: two calls -> request called twice")

# ── errors propagate unchanged ───────────────────────────────────────
for err in (pm.PipiError("pipi_login_required", 401),
            pm.PipiError("pipi_rate_limited", 429, retry_after=42.0)):
    async def failing(endpoint, payload, err=err):
        raise err
    c.request = failing
    try:
        asyncio.run(c.essence_marks())
    except pm.PipiError as e:
        assert e is err, (e, err)
    else:
        raise AssertionError(f"{err.code} must propagate")
print("ok  errors: pipi_login_required and pipi_rate_limited propagate as the same PipiError")

# ── set ──────────────────────────────────────────────────────────────
c.request = fake_request
REAL_ID = "9c19ee876ae44a5f9a92b68d602cc1ea.16"
calls.clear()
reply = {"ok": True, "mark": {"mapObjectId": REAL_ID, "bloomedTimeMs": BLOOM, "wiltingTimeMs": WILT}}
assert asyncio.run(c.set_essence_mark(REAL_ID, BLOOM, True)) == {"wiltingMs": WILT}
# The id keeps its type: the site's own page sends the raw items value, and
# a number turned into a string (or back) might not match its record.
asyncio.run(c.set_essence_mark(123456, BLOOM, False))
assert calls == [
    ("Handlers/FlowerEssenceData.ashx", {"action": "set", "mapObjectId": REAL_ID, "bloomedTimeMs": BLOOM, "collected": True}),
    ("Handlers/FlowerEssenceData.ashx", {"action": "set", "mapObjectId": 123456, "bloomedTimeMs": BLOOM, "collected": False}),
], calls
assert type(calls[1][1]["mapObjectId"]) is int, calls
print("ok  set: {action: set, mapObjectId, bloomedTimeMs, collected} with the id's own type; returns mark.wiltingTimeMs")

# No usable wilting time in the answer -> 0, which the layer replaces with
# the flower's own wiltingMs, like the site does.
for bad in ({"ok": True}, {"ok": True, "mark": None}, {"ok": True, "mark": "x"},
            {"ok": True, "mark": {}}, {"ok": True, "mark": {"wiltingTimeMs": None}},
            {"ok": True, "mark": {"wiltingTimeMs": str(WILT)}}, {"ok": True, "mark": {"wiltingTimeMs": True}}):
    reply = bad
    assert asyncio.run(c.set_essence_mark(REAL_ID, BLOOM, True)) == {"wiltingMs": 0}, bad
reply = {"ok": True, "mark": {"wiltingTimeMs": WILT + 0.7}}
got = asyncio.run(c.set_essence_mark(REAL_ID, BLOOM, True))
assert got == {"wiltingMs": WILT} and type(got["wiltingMs"]) is int, got
print("ok  set: no mark / no valid wiltingTimeMs -> 0; a fractional one is floored")

calls.clear()
asyncio.run(c.set_essence_mark(REAL_ID, BLOOM, True))
asyncio.run(c.set_essence_mark(REAL_ID, BLOOM, True))
assert len(calls) == 2, ("each set must reach the site; no cache", calls)
print("ok  set: no cache: two calls -> request called twice")

for err in (pm.PipiError("pipi_login_required", 401),
            pm.PipiError("pipi_rate_limited", 429, retry_after=42.0)):
    async def failing(endpoint, payload, err=err):
        raise err
    c.request = failing
    try:
        asyncio.run(c.set_essence_mark(REAL_ID, BLOOM, True))
    except pm.PipiError as e:
        assert e is err, (e, err)
    else:
        raise AssertionError(f"set: {err.code} must propagate")
print("ok  set: errors: pipi_login_required and pipi_rate_limited propagate as the same PipiError")
