"""A cache hit in PipiMushroomClient.items() reports the server time *now*,
not the time it was cached: the frontend derives its server-clock offset
from now_ms, so a stale value delays expiry / ribbon checks and popup
countdowns by up to CACHE_TTL. No network: `request` is faked and the
module's monotonic clock is replaced."""
import asyncio
import sys
import time
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
import services.pipi_mushroom as pm  # noqa: E402

# Swap the module's whole `time`, never `pm.time.monotonic = ...`: that is
# the stdlib module, and asyncio's event loop also runs on time.monotonic.
clock = {"t": 1000.0}
pm.time = types.SimpleNamespace(monotonic=lambda: clock["t"], time=time.time)

N = 1_762_318_560_000
ITEM = {"id": 7, "itemKind": "flower", "lat": 25.067756, "lng": 121.493156}
calls = {"n": 0}


async def fake_request(endpoint, payload):
    # A different nowMs per upstream call, so a refetch can't pass for
    # "old value + elapsed time".
    k = calls["n"]
    calls["n"] += 1
    return {"nowMs": N + k * 1_000_000, "items": [dict(ITEM)]}


c = pm.PipiMushroomClient()
c.request = fake_request
BBOX = (25.07, 25.06, 121.50, 121.49, 17)


def fetch_at(t):
    clock["t"] = t
    return asyncio.run(c.items(*BBOX))


first = fetch_at(1000.0)
assert calls["n"] == 1, calls
assert first["now_ms"] == N, first["now_ms"]
print("ok  first call: upstream once, now_ms == nowMs")

hit = fetch_at(1023.0)
assert calls["n"] == 1, ("23 s later must still be a cache hit", calls)
assert hit["now_ms"] == N + 23_000, ("hit must add the cache age", hit["now_ms"] - N)
assert {**hit, "now_ms": None} == {**first, "now_ms": None}, ("other fields come from the cache unchanged", hit)
print("ok  hit after 23 s: no upstream call, now_ms == nowMs + 23000")

again = fetch_at(1025.0)
assert calls["n"] == 1, calls
assert again["now_ms"] == N + 25_000, ("each hit ages from the cached value, not the last hit", again["now_ms"] - N)
print("ok  hit after 25 s: now_ms == nowMs + 25000 (cached entry not mutated)")

fresh = fetch_at(1000.0 + pm.CACHE_TTL + 1)
assert calls["n"] == 2, ("past CACHE_TTL must refetch", calls)
assert fresh["now_ms"] == N + 1_000_000, ("refetch uses the new nowMs", fresh["now_ms"] - N)
print("ok  past CACHE_TTL: upstream again, now_ms == second nowMs")
