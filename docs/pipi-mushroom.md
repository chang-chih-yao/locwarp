# Pipi Mushroom 蘑菇地圖 layer (2026-11-04)

Map overlay showing the mushrooms, flowers and smoke points that
[pipimushroom.com](https://pipimushroom.com/mfmap.aspx) (蘑菇地圖 tab) marks,
with teleport / navigate buttons in each popup. The data needs the user's own
Google login on that site, so LocWarp proxies it with the user's browser
cookie. A Chrome extension keeps that cookie in sync.

Contracts for editing these files: `.claude/rules/pipi-mushroom.md`.
Tests: `tests/pipi/`.

## Pieces

| Part | File | Role |
| --- | --- | --- |
| Protocol client | `backend/services/pipi_mushroom.py` | API session, AES/HMAC envelope, throttle, cache, Set-Cookie renewal, item normalisation |
| API | `backend/api/pipi.py` | `GET /api/pipi/status`, `PUT/DELETE /api/pipi/cookie`, `GET /api/pipi/items` |
| Settings | `backend/main.py` (`AppState`) | `pipi_cookie`, `pipi_cookie_source` (`manual`/`extension`), `pipi_cookie_updated_at` in `~/.locwarp/settings.json` |
| Layer | `frontend/src/hooks/usePipiMushroomLayer.ts` | fetch on pan/zoom, markers, popups, status polling |
| Panel | `frontend/src/components/PipiMushroomPanel.tsx` | on/off, kind chips, cookie paste/clear, status |
| Button | `frontend/src/components/MapView.tsx` | mushroom button in the left Leaflet bar: click toggles, right-click opens the panel |
| Extension | `extensions/pipi-cookie-sync/` | pushes the browser's Cookie header to `127.0.0.1:8777` (user guide: its `README.md`) |

## Site protocol (reverse-engineered from `Scripts/dist/api-security.min.js`, `mfmap.min.js`)

1. `GET /ApiSession.ashx` (with cookies) →
   `{ok, a: token, b: AES key b64, c: HMAC key b64, d: expiresUtc, authExpiresUtc}`.
   `authExpiresUtc` is null when not logged in; it is the cheapest login check.
2. Requests: `POST {a: token, b: Date.now(), c: nonce (18 B), d: iv (16 B),
   e: AES-CBC/PKCS7(JSON), f: HMAC-SHA256(c, "a.b.c.d.e")}`, all base64.
3. Responses with `secure: true` carry `{d: iv, e: ciphertext, f: HMAC("token.d.e")}`;
   anything else is plain JSON (errors).
4. `Handlers/MfMapData.ashx` modes: `filters`, `items`, `clusters`,
   `poi-report-candidates`. All of them need login and answer 401 otherwise.
   `items` takes `{regionCode, zoom, north, south, east, west}` and is only
   used at zoom ≥ 14 (the site switches to clusters below). `regionCode` is
   TW / HK / MA (Malaysia), using the same boxes as the site (`region_for`).
5. `Handlers/MapData.ashx {mode: "allcategories"}` is public. The live smoke
   test uses it to prove the envelope still works.
6. Anti-debugging: `api-security.min.js` runs a `debugger` loop, so DevTools
   stalls on the map page (Ctrl+F8 disables breakpoints). The page is
   `X-Frame-Options: DENY`, so it can't be embedded. The site sends
   `Retry-After` and `X-Pikmin-Rate-Limit-*` headers.

Cookies the site sets are all `HttpOnly; Secure; SameSite=Lax`:
`pm_site_session`, `PikminVisitor`, `ASP.NET_SessionId` (a session cookie),
plus `pm_site_visitor` and `PikminV2.Refresh`. GA, Ads and consent cookies are
also present but the server ignores them.

Login lifetime: `authExpiresUtc` sits about 15 minutes ahead and is extended
on use. Observed: 15:40:38Z was extended to 15:55:23Z.

## Throttling (deliberate; keep it)

- **Frontend:**
  - 700 ms debounce after map moves.
  - A query box padded by 25%; no refetch while the view stays inside it.
  - 60 s refresh.
  - At most 1500 markers.
  - Stops on `pipi_no_cookie`, `pipi_login_required` and `pipi_cookie_invalid`.
  - Backs off by `retry_after` on 429.
- **Backend:**
  - One upstream call at a time, at least 1 s apart.
  - 30 s cache per viewport.
  - `Retry-After` honoured (5–900 s).
  - No `items` call below zoom 14 or outside TW/HK/MA.

## Cookie: how it gets to LocWarp

- **Manual:** the panel's help text has the user open `https://pipimushroom.com/ApiSession.ashx`
  (plain JSON, so no debugger trap) and copy the request's `cookie` header
  from DevTools → Network.
- **Extension (v1.1):**
  1. The service worker fetches `ApiSession.ashx` itself with
     `credentials: 'include'`.
  2. A `webRequest.onBeforeSendHeaders` listener (with `extraHeaders`)
     captures the `Cookie` header Chrome attaches. It only takes requests
     whose initiator is the extension's own origin.
  3. The same response's `authExpiresUtc` tells whether the profile is
     logged in.
  4. It sends `PUT /api/pipi/cookie {cookie, source: "extension"}`.
- **Backend:**
  - Verifies the cookie on a throwaway client (`filters` call) and stores
    the header as renewed during that check.
  - Sends the header verbatim: order and repeated names are kept, never
    rebuilt from a dict.
  - Applies `Set-Cookie` from every response to it and persists renewals
    through `on_cookie_renewed`.
- **Extension pushes can't clobber a working cookie:** a logged-out or
  unverifiable push is not adopted while the stored cookie still works
  (`adopted: false`). A manual paste always replaces it.

### Why not `chrome.cookies.getAll()` (the v1.0 bug)

v1.0 built the header from `chrome.cookies.getAll({url: "https://pipimushroom.com/"})`.
LocWarp's check reported "not logged in", while the same Chrome profile was
logged in.

1. **Wrong first diagnosis: "the extension is in another Chrome profile".**
   The pushed set lacked the `_ga*` and `FC*` cookies the logged-in tab had.
2. **Disproved.** The three ad cookies (`__gads`, `__gpi`, `__eoi`) had
   identical value hashes in both. A probe cookie set with `document.cookie`
   in the logged-in tab also showed up in the extension's next push.
3. **Attribute test.** Probe cookies were set in the tab and compared with
   what the extension pushed:
   - Every `Secure` variant came through (host-only and `Domain=`,
     `SameSite=Lax` and `None`).
   - No non-`Secure` variant came through.
   - The missing `_ga*` and `FC*` cookies are exactly the non-Secure ones.
4. **Result.** The server-side cookies getAll returned were a stale,
   logged-out set, while the browser was sending a logged-in one. The
   Chrome-side mechanism was not pinned down. Capturing the real request
   header sidesteps it, and v1.1 was confirmed working by the user.

## Diagnosing without leaking the cookie

- Print cookie **names and `sha256(value)[:12]`** only, never values. This is
  enough to compare what the browser, the extension and `settings.json` hold.
- To see exactly what the extension pushes, stop LocWarp. Then run a
  throwaway HTTP server on `127.0.0.1:8777` that answers `GET /api/pipi/status`
  and `PUT /api/pipi/cookie` and logs names + hashes. Change a pipimushroom
  cookie in the browser to trigger a sync.
- For a login check from the backend side: `GET ApiSession.ashx` with the
  stored cookie, then look at `authExpiresUtc`. A logged-out `mfmap.aspx`
  302s to `/login.aspx`.

## Open items / not yet verified (as of 2026-11-04)

- **Long sessions.** It isn't proven that the backend's Set-Cookie renewal
  keeps LocWarp logged in past ~15 minutes. The site may renew only through
  the page's own refresh flow (`PikminV2.Refresh`). In that case, LocWarp
  relies on the extension re-pushing whenever the browser's cookies change,
  which happens while a pipimushroom tab is in use.
- **Installed app wipes the cookie.** `~/.locwarp/settings.json` is shared
  with the installed app. An installed build older than this feature
  rewrites the file without the `pipi_*` keys. The extension re-pushes
  within a minute once a build with this feature runs again.
