"""Exercise /api/pipi/* through FastAPI TestClient against a TEMP settings
file (the user's real ~/.locwarp/settings.json is never read or written)
and with check_login stubbed (no network)."""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
import config  # noqa: E402

tmp = Path(tempfile.mkdtemp()) / "settings.json"
config.SETTINGS_FILE = tmp  # must happen before `import main`

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from services.pipi_mushroom import PipiError, PipiMushroomClient  # noqa: E402

assert main.SETTINGS_FILE == tmp, "main must use the temp settings file"
real = Path.home() / ".locwarp" / "settings.json"
real_before = real.read_bytes() if real.exists() else None

dead: set[str] = set()   # cookies that stopped working
calls = {"n": 0}


async def fake_check(self):
    calls["n"] += 1
    v = self._cookies.get("v", "")
    if v.startswith("down"):
        raise PipiError("pipi_unavailable", 502)
    if not v.startswith("good") or v in dead:
        raise PipiError("pipi_login_required", 401)


PipiMushroomClient.check_login = fake_check
main.app_state.pipi_client.set_cookie("")
main.app_state._pipi_cookie = ""
c = TestClient(main.app)  # no `with` -> lifespan (device scan) not run


def put(cookie, source):
    r = c.put("/api/pipi/cookie", json={"cookie": cookie, "source": source})
    return r.json()


def stored():
    return main.app_state._pipi_cookie, main.app_state._pipi_cookie_source


def check(label, resp, adopted, logged_in, expect_stored):
    assert resp["adopted"] is adopted and resp["logged_in"] is logged_in, (label, resp)
    assert stored()[0] == expect_stored, (label, stored())
    print(f"ok  {label:58s} -> {resp}")


check("ext, nothing stored, logged out -> adopt (better than none)", put("v=bad0", "extension"), True, False, "v=bad0")
check("manual good -> adopt", put("v=good1", "manual"), True, True, "v=good1")
check("ext logged out while good stored -> keep good", put("v=bad1", "extension"), False, False, "v=good1")
check("ext site down while good stored -> keep good", put("v=down1", "extension"), False, False, "v=good1")
check("ext good -> adopt", put("v=good2", "extension"), True, True, "v=good2")
dead.add("good2")
check("stored died, ext logged out -> adopt", put("v=bad2", "extension"), True, False, "v=bad2")
check("manual logged out -> always adopt", put("v=good3", "manual") and put("v=bad3", "manual"), True, False, "v=bad3")
s = c.get("/api/pipi/status").json()
assert s["source"] == "manual" and s["configured"]
print("status", s)
print("bad source ->", c.put("/api/pipi/cookie", json={"cookie": "a=1", "source": "evil"}).status_code)
saved = json.loads(tmp.read_text(encoding="utf-8"))
assert saved["pipi_cookie"] == "v=bad3" and saved["pipi_cookie_source"] == "manual"
print("delete", c.delete("/api/pipi/cookie").json())
assert (real.read_bytes() if real.exists() else None) == real_before, "real settings.json was modified!"
print("real settings.json untouched; check_login calls:", calls["n"])
