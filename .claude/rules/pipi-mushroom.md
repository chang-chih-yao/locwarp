---
paths:
  - "backend/services/pipi_mushroom.py"
  - "backend/api/pipi.py"
  - "frontend/src/hooks/usePipiMushroomLayer.ts"
  - "frontend/src/components/PipiMushroomPanel.tsx"
  - "frontend/src/pipiFlowers.ts"
  - "extensions/pipi-cookie-sync/**"
  - "tests/pipi/**"
  - "tests/frontend/test_pipi_flowers.ts"
---

# Pipi Mushroom 蘑菇地圖 layer + cookie-sync extension

Protocol, design history, and open items: `docs/pipi-mushroom.md`.

- Send the stored Cookie header verbatim and keep `_absorb_set_cookies` applying the site's renewals: the login lasts ~15 min and is extended on use, and browsers can hold repeated cookie names whose order matters.
- Build the extension's cookie from the captured request header (`webRequest.onBeforeSendHeaders` + `extraHeaders` on its own `ApiSession.ashx` fetch), not `chrome.cookies.getAll()`, which drops the non-Secure cookies that carry the login. `chrome.cookies` is only a change detector.
- `PUT /api/pipi/cookie`: validate before touching the live client, and let an extension push replace a stored cookie only when it is logged in or the stored one is dead (`adopted`). A manual paste always replaces it.
- Never return, log, or print cookie values; diagnostics print names plus `sha256(value)[:12]`. Tests use a temp `SETTINGS_FILE`, because `~/.locwarp/settings.json` is the user's real file and is shared with the installed app.
- Keep the throttles (backend `MIN_INTERVAL`, `CACHE_TTL`, `MIN_ITEMS_ZOOM`, `Retry-After`; frontend debounce, padded-bbox reuse, `STOP_CODES`): the site rate-limits and runs anti-bot checks. The extension must not contact the site while LocWarp is down, while in sync, or while logged out.
- Escape every site-provided string rendered in the map, and accept images only as `Content/...` paths under `https://pipimushroom.com/`. Markers use `map.wrapLatLngBounds` + `lngShift`, so keep both when changing fetch bounds.
- After editing the extension, bump `manifest.json` `version`; the user must click ↻ in `chrome://extensions` to load it.
- Tests (repo root): `node tests/pipi/test_extension.js`, `.venv/Scripts/python.exe tests/pipi/test_cookie_header.py`, `.venv/Scripts/python.exe tests/pipi/test_api_cookie.py`, and for the flower rules `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"`. `tests/pipi/check_live_anonymous.py` hits the live site anonymously; run it only after the site's scripts change.
