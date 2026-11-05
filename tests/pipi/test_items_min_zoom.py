"""PipiMushroomClient.items() refuses zoom 14 without contacting the site,
and serves zoom 15. At zoom 14 the site's items API only returns mushrooms
and smoke ending within 5 minutes, so 15 is the first zoom worth a request;
the backend refuses lower ones even if the frontend sends them. No network:
`request` is faked and counts its calls. Zoom is hard-coded and
MIN_ITEMS_ZOOM is not read, so lowering it back to 14 turns this red."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
import services.pipi_mushroom as pm  # noqa: E402

ITEM = {"id": 7, "itemKind": "flower", "lat": 25.0478, "lng": 121.5170}
calls: list[dict] = []


async def fake_request(endpoint, payload):
    calls.append(payload)
    return {"nowMs": 1_762_318_560_000, "items": [dict(ITEM)]}


c = pm.PipiMushroomClient()
c.request = fake_request
# Around Taipei Main Station, inside the TW box, so a request that passes the
# zoom check goes on to the cache and `request`.
TAIPEI = (25.06, 25.03, 121.54, 121.49)

try:
    asyncio.run(c.items(*TAIPEI, 14))
except pm.PipiError as e:
    assert e.code == "pipi_zoom_too_low", e.code
    assert e.status == 400, e.status
else:
    raise AssertionError("zoom 14 must raise pipi_zoom_too_low")
assert calls == [], ("zoom 14 must not reach the site", calls)
print("ok  zoom 14: pipi_zoom_too_low (HTTP 400), request called 0 times")

result = asyncio.run(c.items(*TAIPEI, 15))
assert len(calls) == 1, ("zoom 15 must reach the site once", calls)
assert calls[0]["mode"] == "items" and calls[0]["zoom"] == 15, calls[0]
assert result["region"] == "TW", result
assert [it["id"] for it in result["items"]] == [7], result["items"]
print("ok  zoom 15: request called once with zoom=15, items returned")
