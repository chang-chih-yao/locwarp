---
paths:
  - "backend/services/pipi_mushroom.py"
  - "backend/api/pipi.py"
  - "frontend/src/hooks/usePipiMushroomLayer.ts"
  - "frontend/src/components/PipiMushroomPanel.tsx"
  - "frontend/src/pipiFlowers.ts"
  - "frontend/src/pipiEssence.ts"
  - "frontend/src/pipiFruit.ts"
  - "frontend/src/pipiFetchPlanner.ts"
  - "frontend/src/pipiMarkerSelection.ts"
  - "extensions/pipi-cookie-sync/**"
  - "tests/pipi/**"
  - "tests/frontend/test_pipi_flowers.ts"
  - "tests/frontend/test_pipi_essence.ts"
  - "tests/frontend/test_pipi_fruit.ts"
  - "tests/frontend/test_pipi_fetch_planner.ts"
  - "tests/frontend/test_pipi_marker_selection.ts"
---

# Pipi Mushroom 蘑菇地圖 layer + cookie-sync extension

Protocol, design history, and open items: `docs/pipi-mushroom.md`.

- Send the stored Cookie header verbatim and keep `_absorb_set_cookies` applying the site's renewals: the login lasts ~15 min and is extended on use, and browsers can hold repeated cookie names whose order matters.
- Build the extension's cookie from the captured request header (`webRequest.onBeforeSendHeaders` + `extraHeaders` on its own `ApiSession.ashx` fetch), not `chrome.cookies.getAll()`, which drops the non-Secure cookies that carry the login. `chrome.cookies` is only a change detector.
- `PUT /api/pipi/cookie`: validate before touching the live client, and let an extension push replace a stored cookie only when it is logged in or the stored one is dead (`adopted`). A manual paste always replaces it.
- Never return, log, or print cookie values; diagnostics print names plus `sha256(value)[:12]`. Tests use a temp `SETTINGS_FILE`, because `~/.locwarp/settings.json` is the user's real file and is shared with the installed app.
- Throttles on requests to the site may be tightened, never loosened (backend `MIN_INTERVAL`, `CACHE_TTL`, `MIN_ITEMS_ZOOM`, `Retry-After`; frontend debounce, padded-bbox reuse, `PIPI_MIN_ZOOM`, `STOP_CODES`, one 拿過精華 list read (`GET /api/pipi/essence`) per fetch loop, one 拿過精華 set (`PUT /api/pipi/essence`) per press or per 撈水果 that walked onto its flower (自動標記), and none for a flower still saving (`createEssenceSaver`)): the site rate-limits and runs anti-bot checks. Both min zooms are 15 and must stay equal: at zoom 14 the site only returns mushrooms and smoke ending within 5 minutes. This covers request volume only; LocWarp's own 點位上限 (`PIPI_MAX_MARKERS`) is not a throttle and may change either way. The extension must not contact the site while LocWarp is down, while in sync, or while logged out.
- Escape every site-provided string rendered in the map, and accept images only as `Content/...` paths under `https://pipimushroom.com/`. Markers use `map.wrapLatLngBounds` + `lngShift`, so keep both when changing fetch bounds.
- After editing the extension, bump `manifest.json` `version`; the user must click ↻ in `chrome://extensions` to load it.
- Tests (repo root): `node tests/pipi/test_extension.js`, `.venv/Scripts/python.exe tests/pipi/test_cookie_header.py`, `.venv/Scripts/python.exe tests/pipi/test_api_cookie.py`, `.venv/Scripts/python.exe tests/pipi/test_cache_now_ms.py`, `.venv/Scripts/python.exe tests/pipi/test_items_min_zoom.py`, `.venv/Scripts/python.exe tests/pipi/test_essence_client.py`, `.venv/Scripts/python.exe tests/pipi/test_api_essence.py`, and for the frontend modules `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"`. `tests/pipi/check_live_anonymous.py` hits the live site anonymously; run it only after the site's scripts change.
