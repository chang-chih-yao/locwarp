"""The backend sends the Cookie header verbatim (order + duplicate names
kept) and applies the site's Set-Cookie renewals to it, like a browser."""
import asyncio
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
import services.pipi_mushroom as pm  # noqa: E402

seen: list[str] = []
SET = {
    "/renew": ["pm_site_session=NEW; path=/; secure; HttpOnly; SameSite=Lax"],
    "/same": ["pm_site_session=NEW; expires=Fri, 01 Jan 2100 00:00:00 GMT; path=/"],
    "/drop": ["_ga=; Max-Age=0; path=/", "a=1; expires=Thu, 01 Jan 1970 00:00:00 GMT", "z=9; path=/"],
    "/none": [],
}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        seen.append(self.headers.get("Cookie"))
        self.send_response(200)
        for h in SET[self.path]:
            self.send_header("Set-Cookie", h)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"{}")


srv = HTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
pm.BASE_URL = f"http://127.0.0.1:{srv.server_address[1]}/"

raw = "Cookie: a=1; pm_site_session=OLD;\n pm_site_session=FRESH; _ga=G; bad; =x"
assert pm.normalize_cookie_header(raw) == "a=1; pm_site_session=OLD; pm_site_session=FRESH; _ga=G"
assert pm.parse_cookie_header(raw) == {"a": "1", "pm_site_session": "FRESH", "_ga": "G"}

saved: list[str] = []


async def main():
    c = pm.PipiMushroomClient(on_cookie_renewed=saved.append)
    c.set_cookie(raw)
    assert saved == [], "set_cookie itself must not report a renewal"
    http = c._http()
    for path in ("/renew", "/same", "/drop", "/none"):
        r = await http.get(path.lstrip("/"))
        c._absorb_set_cookies(r)
    await c.aclose()
    return c


c = asyncio.run(main())
srv.shutdown()
for s in seen:
    print("sent:", s)
print("saved:", saved)
assert seen == [
    "a=1; pm_site_session=OLD; pm_site_session=FRESH; _ga=G",
    "a=1; pm_site_session=NEW; pm_site_session=NEW; _ga=G",
    "a=1; pm_site_session=NEW; pm_site_session=NEW; _ga=G",
    "pm_site_session=NEW; pm_site_session=NEW; z=9",
], seen
assert saved == [
    "a=1; pm_site_session=NEW; pm_site_session=NEW; _ga=G",
    "pm_site_session=NEW; pm_site_session=NEW; z=9",
], saved
assert c.cookie_header == saved[-1] and c.configured
print("verbatim header + Set-Cookie renewal OK")
