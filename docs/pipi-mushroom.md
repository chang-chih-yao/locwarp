# Pipi Mushroom 蘑菇地圖 layer (2026-11-04)

Map overlay showing the mushrooms, flowers and smoke points that
[pipimushroom.com](https://pipimushroom.com/mfmap.aspx) (蘑菇地圖 tab) marks,
with teleport / navigate buttons in each popup, plus 撈水果 on 彩帶花 and
我拿過精華了 on bloomed flowers.
The data needs the user's own
Google login on that site, so LocWarp proxies it with the user's browser
cookie. A Chrome extension keeps that cookie in sync.

Contracts for editing these files: `.claude/rules/pipi-mushroom.md`.
Tests: `tests/pipi/`, `tests/frontend/test_pipi_flowers.ts`, `tests/frontend/test_pipi_essence.ts`, `tests/frontend/test_pipi_fruit.ts`, `tests/frontend/test_pipi_fetch_planner.ts`, `tests/frontend/test_pipi_marker_selection.ts`.

## Pieces

| Part | File | Role |
| --- | --- | --- |
| Protocol client | `backend/services/pipi_mushroom.py` | API session, AES/HMAC envelope, throttle, cache, Set-Cookie renewal, item normalisation, `essence_marks` (the 標記清單, normalised, never cached), `set_essence_mark` (mark or cancel one, never cached) |
| API | `backend/api/pipi.py` | `GET /api/pipi/status`, `PUT/DELETE /api/pipi/cookie`, `GET /api/pipi/items`, `GET /api/pipi/essence` (`{marks: [{id, bloomedMs, wiltingMs}]}`), `PUT /api/pipi/essence` (`{id, bloomedMs, collected}` → `{wiltingMs}`, strict body) |
| Settings | `backend/main.py` (`AppState`) | `pipi_cookie`, `pipi_cookie_source` (`manual`/`extension`), `pipi_cookie_updated_at` in `~/.locwarp/settings.json` |
| Layer | `frontend/src/hooks/usePipiMushroomLayer.ts` | fetch on pan/zoom, markers, popups, status polling, the shared 拿過精華 mark action; `MARKER_PX` is the source of truth for the 標記大小 px, passed to `styles.css` as inline `--pipi-*` properties on the icon's `.pipi-pin-box` |
| Fetch planner | `frontend/src/pipiFetchPlanner.ts` | `createPipiFetchPlanner` (`plan` / `record`): whether a settled view hides the markers, reuses the last fetch or fetches again; owns the last-fetch record, `PIPI_MIN_ZOOM` and the 60 s `PIPI_FRESH_MS` (also the forced-refresh period). `shouldReadEssence` / `recordEssenceRead`: whether this fetch loop still has to read the 標記清單. The layer only acts on its decisions |
| Marker selection | `frontend/src/pipiMarkerSelection.ts` | `selectPipiMarkers`, `PIPI_MAX_MARKERS`: which of the 該顯示的點位 to draw past the 點位上限 (nearest by 畫面框距離, plus the open popup's point), whether that is a 上限截斷, and whether the view itself is short of points (畫面內缺點). The layer supplies the filter and the projection |
| Flower rules | `frontend/src/pipiFlowers.ts` | `isCommonFlower`, `ribbonEndMs`, `passesFlowerFilter`, `fmtRibbonCountdown`, `canCollectFruit`, `canMarkEssence`: 普花 / 彩帶花 checks, the 花的子篩選, the popup's 彩帶期 countdown (see Flowers below), and which items offer 撈水果 and 我拿過精華了 |
| 拿過精華 rules | `frontend/src/pipiEssence.ts` | `essenceMarkId`, `marksFromList`, `marksFromSet`, `essenceTaken`, `ESSENCE_NOT_LOADED`, `createEssenceSaver`: a mark's identity, the 標記狀態 (with 還沒讀到 apart from an empty list), replacing it from the list, updating it from a set answer, whether a point is 拿過精華 at a server time, and the set action with its 存檔中 list (the layer injects the PUT and the state update). The layer passes the 拿過精華 answer to `passesFlowerFilter` |
| 撈水果 | `frontend/src/pipiFruit.ts` | `fruitStartPoint`, `runFruitApproach`: the start point and the teleport → navigate flow behind the popup's 瞬移+撈水果 button (see 撈水果 below). `App.tsx` `handleCollectFruit` supplies the single-device or group calls |
| Panel | `frontend/src/components/PipiMushroomPanel.tsx` | on/off, kind chips, flower sub-filters (只顯示彩帶, 顯示普花, 顯示拿過精華的花, which shows 拿過精華 flowers with a ✓; disabled while 花 is off, ticks kept), 標記大小 (小 30 / 中 40 / 大 50 px, initially 中, saved as `locwarp.pipi_marker_size`), cookie paste/clear, status, and a 精華標記讀取失敗 line while the last 標記清單 read failed |
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
   used at zoom ≥ 14 (the site switches to clusters below). At zoom 14 the
   site's server only returns mushrooms and smoke ending within 5 minutes; it
   returns the full data from zoom 15 (see "Items by zoom" below). The site's
   own page draws everything only from zoom 16 (`mfMapDetailZoom`). `regionCode` is
   TW / HK / MA (Malaysia), using the same boxes as the site (`region_for`).
5. `Handlers/FlowerEssenceData.ashx` holds the account's 拿過精華 marks
   (GLOSSARY.md). `{action: "list"}` returns them all, any region (see
   "The 標記清單" below). `{action: "set", mapObjectId, bloomedTimeMs,
   collected}` marks one bloom (`collected: false` cancels it). Same
   envelope, needs login.
6. `Handlers/MapData.ashx {mode: "allcategories"}` is public. The live smoke
   test uses it to prove the envelope still works.
7. Anti-debugging: `api-security.min.js` runs a `debugger` loop, so DevTools
   stalls on the map page (Ctrl+F8 disables breakpoints). The page is
   `X-Frame-Options: DENY`, so it can't be embedded. The site sends
   `Retry-After` and `X-Pikmin-Rate-Limit-*` headers.

Items by zoom (measured 2026-11-05 afternoon through the local backend):
around Taipei Main Station (25.0478, 121.5170), assuming a 1400×850 map, with
the bbox padded by 25% like the frontend does.

| `zoom` sent | Query box | Site returned |
| --- | --- | --- |
| 14 | the zoom-14 view | 227–230 items: mushrooms 133–136, smoke 94, flowers 0; all ending within 5 minutes |
| 15 | the same zoom-14 view | 5580 items: flowers 3500, mushrooms 1984, smoke 96 |
| 14 | the zoom-15 view | 73 items, again only mushrooms and smoke ending within 5 minutes |
| 15 | the zoom-15 view | 2191 items, 1578 of them flowers |

The site goes by the request's `zoom`, not the size of the box. When the site
changes, send one bbox at zoom 14 and at zoom 15 and compare them to recheck
the threshold. `/api/pipi/items` now refuses zoom 14 itself, so call
`PipiMushroomClient.request` directly with a logged-in cookie for that.

The 標記清單 (measured 2026-11-09 through the local backend, with one mark
the user had just made on the site; details in
`.scratch/pipi-flower-essence/issues/01-hide-essence-taken.md`):

- The answer is `{ok, items: [...]}`, with no `nowMs`. Each row has
  `mapObjectId` (a string such as `9c19ee876ae44a5f9a92b68d602cc1ea.16`),
  `bloomedTimeMs` and `wiltingTimeMs` (integer ms, 23 h apart), and
  `collected: true`. The site's script never reads `collected` from the list,
  and LocWarp doesn't either.
- Cross-check: the marked flower (a 黃色萬壽菊 at 24.790423, 120.988557)
  came back from zoom-15 `items` with `id` and `bloomedMs` equal to the row's
  `mapObjectId` and `bloomedTimeMs`, and the same wilting time. So both sides
  give one identity, the site's own rule (`mfmap.min.js`, 2026-11-09):
  trimmed `String(id)`, `|`, floored bloom ms; none without an id or a bloom
  time > 0 (`essenceMarkId`). LocWarp also counts a string bloom time as
  unset, like the flower rules.
- In that `items` sample (62 items, 49 flowers) every `id` was a string and
  every flower time an integer.
- The backend normalises each row to `{id: str, bloomedMs: int, wiltingMs: int}`
  and drops a row without an identity. An unset or invalid wilting time
  becomes 0, which never counts as 拿過精華.
- An answer with no `items` list is `pipi_unavailable`, a failed read, not
  an empty list. Unlike an empty map from `items`, no marks would quietly
  show every 拿過精華 flower without the 精華標記讀取失敗 line. An account
  with no marks at all hasn't been measured yet (ticket 03's account still
  held another mark); one list read once it is empty settles it.

Setting a mark (measured 2026-11-10 through the local backend, one mark and
one cancel on a bloomed flower; details in
`.scratch/pipi-flower-essence/issues/03-manual-mark.md`):

- `mapObjectId` and `bloomedTimeMs` go out as items gave them, with their
  own types, like the site's page sends them.
- A cancel answers `{ok: true, mark: {mapObjectId, bloomedTimeMs,
  wiltingTimeMs: 0, collected: false}}`.
- A mark answers `mark.wiltingTimeMs` with the flower's wilting time. This is
  inferred, not seen: the mark's raw answer wasn't logged, but the backend,
  which reads only that field (0 when unset), returned the flower's wilting
  time.
- After a cancel the row is gone from the list; it doesn't stay with
  `collected: false`. So every row in the list is still a mark.
- The backend returns `{wiltingMs}` from `mark.wiltingTimeMs`, 0 when unset.

Cookies the site sets are all `HttpOnly; Secure; SameSite=Lax`:
`pm_site_session`, `PikminVisitor`, `ASP.NET_SessionId` (a session cookie),
plus `pm_site_visitor` and `PikminV2.Refresh`. GA, Ads and consent cookies are
also present but the server ignores them.

Login lifetime: `authExpiresUtc` sits about 15 minutes ahead and is extended
on use. Observed: 15:40:38Z was extended to 15:55:23Z.

## Flowers: item format and the 花的子篩選 (2026-11-05)

Sources, to re-check when the site changes:

- Site behaviour: `Scripts/dist/mfmap.min.js`, downloaded 2026-11-05.
- Data format: one items API sample through LocWarp (Taipei, zoom 15):
  851 items, 600 flowers, 267 of them 普花, 2 彩帶花.

Terms follow `GLOSSARY.md` (花種, 花苞, 普花, 彩帶花). All the rules below
live in `frontend/src/pipiFlowers.ts`, so a site format change is fixed there.

**Item format.** The backend forwards `key`, `state`, `bloomedMs` and
`wiltingMs` as the site sends them, without type checks.

- A flower's `key` is `f:<colour>:<variety>`; `displayName` is the 花種's
  Chinese name.
- 花苞 have `state` `Leaf` or `Bud` and the same `key` as the flower they
  grow into. Their `bloomedMs` and `wiltingMs` are 0. The site also labels
  `Pre-Flower` as 花苞; the sample had none, so its time fields are unknown.
- A bloomed flower wilts 23 h after `bloomedMs`.

**普花** (`isCommonFlower`) is an exact `key` match, which also catches their 花苞:

| key | 花種 |
| --- | --- |
| `f:White:Common` | 白色花朵 |
| `f:Red:Common` | 紅色花朵 |
| `f:Yellow:Common` | 黃色花朵 |
| `f:Blue:Common` | 藍色花朵 |

Other 花種 of the same colour (`f:White:Geranium`, `f:White:Cherryblossom`)
are not 普花, and neither is a future `f:Purple:Common`. There is no
"`Common` variety" rule and no name matching.

**花苞:** `state` normalised as the site does it (trim, drop spaces,
underscores and hyphens, lowercase) is `leaf`, `bud` or `preflower`.

**彩帶花** (`ribbonEndMs`) needs all of these:

- `itemKind` is `flower` and it is not a 花苞. The sample's 花苞 already
  fail on their zero times; this rule covers `Pre-Flower`, whose times are
  unknown.
- `bloomedMs` and `wiltingMs` are finite numbers > 0. Anything else, a
  string included, counts as unset.
- `bloomedMs ≤ now < wiltingMs` and `now < bloomedMs + 60 min`.

The 彩帶期 ends at the earlier of `bloomedMs + 60 min` and `wiltingMs`. The
site's own check is the same idea: bloomed, within 60 min of `bloomedMs`,
not wilted. `now` is server time (local clock + the `now_ms` offset), like
the layer's expiry checks. The site uses the local clock, so the two can
disagree slightly when the local clock is off.

The popup re-runs `ribbonEndMs` when it opens and, for a 彩帶花, adds a
countdown line. `fmtRibbonCountdown` always writes it as `m:ss`, never with
hours, so a popup opened at the exact bloom ms reads `60:00`.

**花的子篩選** (`passesFlowerFilter`): three sub-filters saved together as
`locwarp.pipi_flower_filter`; initial values and `resolvePipiFlowerFilter`
are in `frontend/src/defaults.ts`. A value saved before the third existed
keeps its two fields, and the third takes its initial value.

- 只顯示彩帶 (initially off) keeps only 彩帶花. Unticking 顯示普花
  (initially on) drops 普花 and their 花苞. A flower must pass all three
  sub-filters, so a 拿過精華 彩帶花 stays hidden under 只顯示彩帶.
- 顯示拿過精華的花 (`showEssenceTaken`, initially off). While it is unticked,
  flowers that are 拿過精華 are hidden. So is every flower while the 標記清單
  is 還沒讀到, so 拿過精華 flowers don't flash up and vanish while the list
  is on its way; mushrooms and smoke draw meanwhile. The layer gets each
  item's answer from `essenceTaken` at server time.
- Ticked, nothing is hidden for 拿過精華, and flowers draw even while the list
  is 還沒讀到. A flower that is 拿過精華 gets a green ✓ on its marker's
  top-right corner, sized with 標記大小, so it stands apart from flowers not
  yet taken. The marker is not dimmed. A flower that is 還不知道 gets no ✓;
  the list's answer rebuilds the layer and adds it.
  - Decided when the marker is built (rebuild or reselect) and part of the
    icon cache key. Prune doesn't re-check it: it drops the flower at its
    wilting time, normally also the mark's expiry. A list giving an earlier
    expiry would leave the ✓ up until the next rebuild.
  - Toggling the checkbox only rebuilds the markers; it sends no items or
    標記清單 request.
- The 標記狀態 goes back to 還沒讀到 when the layer is turned off or the
  cookie is cleared. A new fetch loop (cookie re-set, 重新整理) keeps the old
  marks until its own list replaces them. A failed read (429 included)
  empties them instead, so every flower shows, and the panel says
  精華標記讀取失敗 until a read succeeds or the next loop starts.
- Mushrooms and smoke always pass. The 花 kind chip stays the master switch
  and is applied outside this module.
- The site's 強制顯示彩帶花 (on by default) overrides each 花種's own
  checkbox. LocWarp deliberately does not copy it, and no combination of the
  sub-filters reproduces it.
- The site fetches `items` with no filter and filters in the browser, so the
  sub-filters need no change to upstream requests.

## 撈水果: the 瞬移+撈水果 button (2026-11-05)

Terms follow `GLOSSARY.md` (種花, 水果, 撈水果, 彩帶花, 花農專用模式). Decisions and their
Q numbers: `.scratch/pipi-fruit-approach/issues/01-popup-fruit-button.md`;
02 in the same folder narrowed the button to 彩帶花 (2026-11-09).

**Why.** The game gives a flower's fruit only to a player who walks to it
and 種花 on the way. Teleporting straight onto the flower leaves no trail,
plants nothing and gets no fruit. So the button teleports next to the flower
first, then walks onto it.

**When it shows** (`canCollectFruit`): 彩帶花 only, which is the same
`ribbonEndMs` check as the popup's ribbon line, with the same boundaries and
the same server time. That time is taken when the popup opens, not when the marker was
built, because the 彩帶期 may have ended in between. So the button shows exactly when the
ribbon line does. The game only grows 水果 on a 彩帶花 while a player 種花
nearby during its 彩帶期. A flower past it can only give 精華 by 採精華, and
walking to it gets no fruit. Until 2026-11-09 the button showed on any flower that was not a 花苞
and had not wilted. Back then no one knew 水果 needed the 彩帶期, and an unset
`wiltingMs` counted as not wilted. Now such a flower is not 彩帶花 and gets
no button. A 彩帶期 that ends while the popup is open keeps the button, and
pressing it still runs, like the other open-time checks. Mushrooms and smoke never get
the button. It sits on the row under the teleport / navigate pair, left of
我拿過精華了, the two equal (see 拿過精華 below).

**The flow** (`runFruitApproach`):

- **Start: 35 m due east, fixed.** No setting and no randomness, so every
  run is the same. The ticket gives no reason for east over any other
  direction; only being fixed matters. It started at 30 m (a short walk,
  and the 花農專用模式's default radius); on 2026-11-09 the user moved it to
  35 m, with no reason recorded. The offset is the same 111,320 m-per-degree formula as
  `backend/core/flower.py` `_circle_points`, about 34.96 m by haversine.
  Not yet checked on a phone: whether 35 m is enough for the game.
- **Teleport, wait for it, then navigate to the flower.** Speed follows the
  current move mode, custom speed and speed range, like 導航到這裡. There is
  no extra wait for the game between the two (add one only if phone tests
  show the game needs it).
- **Always a straight line**, whatever the 直線 toggle and route engine say:
  `straight_line=true` makes the backend skip the engine
  (`force_straight` in `backend/services/route_service.py`). An engine
  routes along roads, so it can detour or stop at the nearest road instead
  of walking onto the flower.
- **Any teleport failure stops everything.** Nothing navigates. In group mode
  the devices that did teleport stay at the start; this is the user's call
  (Q19), not "let the successful ones walk". Single-device errors show like
  a normal teleport's. The cooldown only blocks a single device jumping
  more than 1 km (`COOLDOWN_TABLE` is 0 s up to 1 km, and group mode skips it), so
  collecting several flowers in one area isn't blocked.
- **Group mode** teleports every device to the start, waits 150 ms (the
  settle delay `preSyncStart` uses), then navigates them all with
  `skipPreSync`. `preSyncStart` would read the `currentPosition` from before
  the teleport and drag every device back. One toast only, because
  `showToast` replaces the last one: an abort lists each device's teleport
  result, a success shows the navigate result like 導航到這裡.
- **Recent places** get the flower only (kind `navigate`), and only once a
  device has started walking. The start point is never recorded.

It is a one-off action, separate from the 花農專用模式 (`SimMode.Flower`),
and uses none of its radius, lap or wait settings.

## 拿過精華: marking from the popup (2026-11-10)

Terms follow `GLOSSARY.md` (拿過精華, 標記清單, 標記狀態, 還不知道). Decisions
and their Q numbers: `.scratch/pipi-flower-essence/spec.md`.

**When it shows** (`canMarkEssence`, Q4): a flower, not a 花苞, with an id,
a `bloomedMs` that is a positive integer and a set `wiltingMs`, with
`bloomedMs ≤ now < wiltingMs` at server time when the popup opens. Unlike
撈水果 it holds for the whole bloom, past the 彩帶期. The id and the bloom
time are what `PUT /api/pipi/essence` accepts (a non-blank string or a safe
integer; a positive integer), so the button doesn't show on a flower whose
mark would be refused. The PUT also caps a string id at 128 characters,
which the button doesn't check (measured ids are 35).

**The button row.** 撈水果 on the left, 我拿過精華了 on the right, equal
widths; one alone fills the row, neither leaves no row. Since 撈水果 is for
彩帶花 only, the pair only shows on a 彩帶花. The label is decided when the
popup opens: 已拿過精華（取消） when the flower is 拿過精華, otherwise (還不知道
included) 我拿過精華了. Leaflet sizes a popup by its min-content width,
where two `1fr` columns don't even out, so the pair row is sized
`max-content` (two copies of the wider button). Flower markers allow popups
up to 400 px; the others keep 280. Measured 2026-11-10 in a zoom-17 view
(151 flowers, both languages): beside 撈水果, 已拿過精華（取消） needs 293 px
and Essence taken (undo) 311 px; every popup without the pair stayed below
280 and came out the same width with either limit.

**Popup actions** get the whole item and decide for themselves whether to
close the popup: teleport, navigate and 撈水果 close it first; the mark button
doesn't.

**The mark action** (`createEssenceSaver` in `pipiEssence.ts`, one per layer
hook; to be shared with ticket 04's 自動標記; it works with the layer off). It
sends the PUT, keeps the 存檔中 list, applies the answer (`marksFromSet`) and
reports `ok`, `failed` (with the error) or `saving`. It never closes a popup
or shows a toast, so a 自動標記 can't close whatever popup the user has open,
and two toasts can't replace each other.

- The answer is applied locally, as the site's page does; the list isn't
  read again. A 0 `wiltingMs` falls back to the flower's own. Applied to a
  還沒讀到 state it stays 還沒讀到, so one answer can't pass for a read list.
- **存檔中.** The identities being saved sit in the saver, not React state
  (state would rebuild the layer on entering and leaving it). A second call
  for the same flower meanwhile sends nothing and reports `saving`.
  Disabling the button alone can't stop it: a rebuild mid-save (60 s
  refresh, a list answer) reopens the popup with a fresh button. Every popup
  open draws a flower that is still saving with its button disabled.
- **Popup close and reopen is accepted.** The 標記狀態 is a dependency of the
  marker effect, so a successful mark rebuilds the layer, which closes the
  open popup and reopens it from the new 標記狀態 (label and ✓), as a 60 s
  refresh does. There is no in-place update.

**The popup button** calls it and owns the popup and the toast:

- Pressing disables the button at once and leaves the popup open.
- On success, with 顯示拿過精華的花 unticked, it closes the popup only if it
  is still this flower's (the user may have opened another flower's or a
  bookmark's meanwhile); the flower disappears. Ticked, the popup stays, as
  on the site. The toast says 已標記為拿過精華 / 已取消拿過精華標記.
- On failure the toast says 標記拿過精華失敗：{error} /
  取消拿過精華標記失敗：{error}, and the open popup's button (if it is this
  flower's) works again. No retry, and a login error doesn't stop the fetch
  loop; the next fetch finds it.
- `saving` can only come past a disabled button, so it shows nothing.
- Accepted edge: ticked, a success while the list is 還沒讀到 leaves the
  state as it was, so nothing rebuilds and the button stays disabled until
  the list arrives (the 1–2 s after the layer opens).

**Deliberately unlike the site:** LocWarp hides 拿過精華 flowers unless
顯示拿過精華的花 is ticked (the site shows them with a ✓), and it judges a
mark's expiry by server time (the site uses the local clock).

## Throttling (deliberate; tighten only, never loosen)

- **Frontend:**
  - 700 ms debounce after map moves.
  - A query box padded by 25%; no refetch while the view stays inside it.
  - Zooming below 15 only hides the markers; the data and the last query box
    are kept. Zooming back in redraws them after the debounce, and the same
    reuse rules decide whether to fetch.
  - 60 s refresh.
  - At most 750 markers (`PIPI_MAX_MARKERS`). This is LocWarp's own
    rendering cap, not a throttle on the site, so tighten-only does not apply
    to it. On the user's machine (2026-11-05), 750 kept every full layer
    rebuild measured (data refresh, kind toggle, 標記大小 change) within
    100 ms; 1500 went past it (measurements in
    `.scratch/pipi-max-markers/issues/02-marker-cap-size-and-rendering.md`).
    Past the cap:
    - It keeps the points nearest the view centre by 畫面框距離
      `max(|dx| / (W/2), |dy| / (H/2))`, which picks a rectangle shaped like
      the view, so every point inside the view comes before any outside it.
      Items filtered out (kind off, ended, 花的子篩選) never use up the cap.
    - The point whose popup is open is drawn as one extra if it missed the
      cut, so up to 751 can be shown.
    - When a pan or zoom settles, the same `load` that asks the planner
      reselects for the new centre (on any decision but `hide`). It only adds
      and removes the markers that changed, so an open popup stays open.
      Nothing is requested for it.
    - The panel shows a hint (`map.pipi_capped`) only when points inside the
      view are left out (畫面內缺點), not merely when the padded fetch has
      more than 750.
  - Stops on `pipi_no_cookie`, `pipi_login_required` and `pipi_cookie_invalid`.
  - Backs off by `retry_after` on 429.
  - The 標記清單 (`GET /api/pipi/essence`) is read at most once per fetch
    loop: opening the layer, a cookie re-set (`updated_at` changes) and
    重新整理 each start one; the site's Set-Cookie renewals don't. It goes
    out with the loop's first decision that isn't `hide`, next to the items
    request, so nothing is read below zoom 15. The 60 s refresh, pans and
    zooms never read it.
    - Only a loop that knows the cookie is set (`configured` true) reads it.
      The loop that runs before the status answer is replaced once it says
      true, so a startup with the layer already on reads the list once, not twice.
    - A stopped loop sends nothing and leaves the list for the next loop.
      `STOP_CODES` on the list itself stop the loop the same way, since it
      often goes out next to the items request that stops it. That is not a
      failed read: the marks stay, so 拿過精華 flowers don't reappear on the
      data still drawn.
    - A 429 on it does not count as read. It sets the loop's back-off from
      `retry_after`, nothing is sent during the back-off, and the first
      decision after it that isn't `hide` reads again, even one that reuses
      items. The backend's back-off outlives the loop, so without this a
      重新整理 during it would leave the whole loop unread. Any other failure
      counts as read, and the next loop retries.
  - A 拿過精華 set (`PUT /api/pipi/essence`) goes out once per press of the
    popup button, never retried, and a second one for a flower still being
    saved isn't sent (`createEssenceSaver`, locked by `test_pipi_essence.ts`).
    A mark doesn't read the list again.
- **Backend:**
  - One upstream call at a time, at least 1 s apart.
  - 30 s cache per viewport. A hit adds the entry's age to `now_ms`, so it still reads as the server time at response.
  - The 標記清單 and the 拿過精華 set are never cached and go through the same
    queue, spacing and `Retry-After` as items. The back-off is client-wide, so
    a list or set request during it is answered 429 without reaching the site.
  - `Retry-After` honoured (5–900 s).
  - No `items` call below zoom 15 or outside TW/HK/MA. The frontend's
    `PIPI_MIN_ZOOM` is a separate copy of 15 and requests nothing below it either.

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
