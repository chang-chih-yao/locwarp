"""GET /api/pipi/essence through FastAPI TestClient against a TEMP settings
file (the user's real ~/.locwarp/settings.json is never read or written),
with the client's essence_marks stubbed (no network).

Locks the response shape `{marks: [...]}` and that errors map to HTTP the
same way as items: the layer reads `code` and, on 429, `retry_after` to set
its back-off before it reads the list again.
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

assert (real.read_bytes() if real.exists() else None) == real_before, "the real settings.json must not change"
print("ok  real ~/.locwarp/settings.json untouched")
