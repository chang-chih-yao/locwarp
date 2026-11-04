"""Manual smoke test for backend/services/pipi_mushroom.py against the LIVE
site with an anonymous session (no real cookie, ~3 requests). Run it after
the site changes its scripts: it proves the encrypt/sign/verify/decrypt
envelope still works and that protected modes still answer 401."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from services.pipi_mushroom import (  # noqa: E402
    PipiError, PipiMushroomClient, _parse_utc, parse_cookie_header, region_for,
)


async def main() -> None:
    assert parse_cookie_header("Cookie: a=1; b=x=y;\n c = 3") == {"a": "1", "b": "x=y", "c": "3"}
    assert region_for(24.77, 121.02) == "TW" and region_for(22.3, 114.17) == "HK"
    assert region_for(3.14, 101.69) == "MA" and region_for(35.68, 139.76) is None
    assert abs(_parse_utc("2026-11-04T14:42:52.9987077Z") - 1793803372.998707) < 0.01
    print("pure helpers ok")

    c = PipiMushroomClient()
    c.set_cookie("dummy=1")
    # 1) public endpoint: proves encrypt + sign + verify + decrypt round trip
    j = await c.request("Handlers/MapData.ashx", {"mode": "allcategories"})
    print("MapData allcategories ok, keys:", sorted(j.keys())[:8],
          "session auth:", c._session.auth_expires_at)
    # 2) protected endpoint must map to pipi_login_required
    try:
        await c.items(24.79, 24.76, 121.06, 120.98, 15)
        print("UNEXPECTED: items succeeded anonymously")
    except PipiError as e:
        print("items anonymous ->", e.code, e.status, repr(e.message))
    # 3) zoom guard + region outside coverage, no upstream call
    try:
        await c.items(24.79, 24.76, 121.06, 120.98, 12)
    except PipiError as e:
        print("zoom 12 ->", e.code)
    print("tokyo ->", (await c.items(35.70, 35.66, 139.80, 139.72, 15))["region"])
    await c.aclose()


asyncio.run(main())
