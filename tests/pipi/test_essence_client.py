"""PipiMushroomClient.essence_marks() reads the account's 拿過精華 marks
(GLOSSARY.md) from the site's FlowerEssenceData endpoint. No network:
`request` is faked and records every call, like test_items_min_zoom.py.

What this locks:
- the endpoint and the exact `{action: "list"}` payload, the site's own call;
- normalisation into `{id: str, bloomedMs: int, wiltingMs: int}`, so the
  frontend's identity rule sees one shape whatever type the site sends;
- no cache: every call reaches `request`, because the list is read once per
  fetch loop and a cached answer would hide marks made on the phone;
- PipiError from `request` (login, rate limit) propagates unchanged, so the
  API maps it to the same HTTP codes as items.
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

# The site sends no `items` key, or not a list: an empty list, not a crash.
for bad in ({}, {"items": None}, {"items": "x"}, {"items": {"a": 1}}):
    reply = bad
    assert asyncio.run(c.essence_marks()) == [], bad
print("ok  missing or non-list items -> []")

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
