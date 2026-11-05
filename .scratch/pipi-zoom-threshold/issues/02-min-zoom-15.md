# 02 載入門檻改成 zoom 15（前後端）

Status: resolved
Blocked by: 01

Spec: `.scratch/pipi-zoom-threshold/spec.md`

## 做什麼

依 spec「Implementation Decisions → 門檻」與 User Stories 1–3、19–21、23、25–26，把前端（票 01 搬進 planner 的常數）和後端 `MIN_ITEMS_ZOOM` 都改成 15。

- 玩家在 zoom 14 看到「放大到 Zoom 15 以上才會載入 (目前 14)」。LocWarp 不送 items 請求，後端收到也直接拒絕。
- 開著「花」時，一到 zoom 15 就看到花。
- 做完這張，15→14→15 時不會再沿用 zoom 14 抓到的殘缺資料，最多等 60 秒的問題就消失了。
  - 放大回來仍要重抓，等待是 700 ms debounce、加上原站回應約 1.7 秒、再加上畫 marker。
  - 不用等網路是票 03。
- 面板的狀態文字從常數取數字，i18n 字串不用改。

**「為什麼是 15」的註解**，理由是原站在 zoom 14 只回 5 分鐘內結束的蘑菇和煙霧，15 起才回完整資料。三處都要寫：

- planner 的門檻常數旁。
- 後端 `backend/services/pipi_mushroom.py` 的 `MIN_ITEMS_ZOOM` 旁。現有註解是舊理由。
- hook 開頭的「Request budget」註解。現在還寫著 zoom 14 和「原站在那以下只有縣市聚合」。

## 測試

- planner 測試檔加門檻測試：沒有紀錄時，zoom 14 是 `hide`、zoom 15 是 `fetch`。
  - **寫死 14 和 15，不 import 門檻常數**，否則常數改回 14 時測試跟著變，mutation check 不會紅。
- 新增後端測試，建議 `tests/pipi/test_items_min_zoom.py`。寫法照 spec「Testing Decisions → 後端門檻」，參考 `tests/pipi/test_cache_now_ms.py`：
  - 不連網，把 client 實例的 `request` 換成假的 async 函式並記錄呼叫次數。要換時間就整個換掉模組的 `time`，不要直接改 `time.monotonic`。
  - bbox 用台灣範圍內的座標，讓請求真的走到快取與 `request` 那一步。
  - zoom 14：丟出 `pipi_zoom_too_low`、HTTP 400，`request` 被呼叫 0 次。
  - zoom 15：`request` 被呼叫 1 次，回傳正常結果。
  - 不讀 `MIN_ITEMS_ZOOM`，也不讀寫 `~/.locwarp/settings.json`。
- mutation check，回報改了什麼、哪個測試變紅：
  - 前端門檻常數改回 14：門檻測試要紅。
  - 後端 `MIN_ITEMS_ZOOM` 改回 14：zoom 14 那條要紅。

## 文件

- `docs/pipi-mushroom.md`：
  - Site protocol 段：
    - 「items ... only used at zoom ≥ 14 (the site switches to clusters below)」寫的是原站行為：原站 14 起用 items、13 以下用 clusters。這句本來就對，**維持 14，不要改**。
    - 在那句後面補上：原站伺服器在 zoom 14 只回 5 分鐘內結束的點位，15 起才回完整資料；原站自己的畫面到 16 才全部畫出來。
    - 附上 spec Further Notes 的實測表。
  - Throttling 段：
    - 「No `items` call below zoom 14」改成 15。LocWarp 從 15 才呼叫 items 這件事寫在這裡，不寫在 Site protocol。
    - 標題的「keep it」改成跟規則檔一致的意思：只能收緊、不能放寬。
    - 「At most 1500 markers」旁註明：這是 LocWarp 自己的渲染上限，不是對原站的節流，不受只能收緊的限制；附上 `.scratch/pipi-max-markers/issues/01-marker-cap-silent-truncation.md`。
- `README.md` 的「zoom 14 以上」、`README.en.md` 的「zoom 14 and above」都改成 15。
- `.claude/rules/pipi-mushroom.md`：
  - 「Keep the throttles」改成只能收緊、不能放寬，並在 `MIN_ITEMS_ZOOM` 旁標上 15 的理由。
  - 寫明這句只適用於對原站的節流（請求量）。LocWarp 自己的 marker 上限不在此限，以後要調整不算違規。
  - Tests 那行加上新的後端測試。
- 用 `rg` 確認文件、README、註解沒有殘留「門檻是 zoom 14」的說法。實測表和原站行為描述裡的 14 不算。

## 驗收

- 前端測試全綠：在 repo 根目錄跑 `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"`。
- `tests/pipi/` 全部照跑，結果逐一回報：`test_extension.js`、`test_cookie_header.py`、`test_api_cookie.py`、`test_cache_now_ms.py`，加上新的後端測試。
- 前端 `npm run build`（含 tsc）通過。
- 人工驗證：在真實 app（dev backend + vite，台北市區）開著 DevTools Network。逐項回報，做不到的明說：
  - zoom 14 的狀態列：「放大到 Zoom 15 以上才會載入 (目前 14)」；英文介面是「Zoom in to level 15+ to load (now 14)」。
  - 在 zoom 14 以下停留、平移、等 60 秒自動更新、按「重新整理」：都不出現 `/api/pipi/items`。
  - 開著「花」：一到 zoom 15 就看到花。
  - 15→14→15：回到 15 時直接發一次請求、資料完整，不會先顯示殘缺資料、等到 60 秒強制更新才補齊。

## 不做

- 縮到門檻以下保留資料、狀態列規則、停止抓取時藏點位（票 03）。
- marker 上限 1500 的截斷（`.scratch/pipi-max-markers/issues/01-marker-cap-silent-truncation.md`）。

---

2026-11-05：完成，commit `1bb3ec6`。

- 前端 `PIPI_MIN_ZOOM` 與後端 `MIN_ITEMS_ZOOM` 都改成 15，三處註解都換成新理由。
- 測試：
  - 前端：原本「沒有紀錄時 zoom 15 要抓」那條改成門檻測試，寫死 zoom 14 是 `hide`、15 是 `fetch`，沒有 import 常數。所以測試仍是 12 條。
  - 後端：新增 `tests/pipi/test_items_min_zoom.py`。
    - 不需要換時間：每個 zoom 只呼叫一次，不會碰到快取。
    - 除了票列的項目，另外斷言送出的 payload 是 `zoom=15`。
- 前端測試檔開頭的說明改成「門檻測試寫死 14 和 15 兩邊」，沒有再寫「門檻以下一律用 13」。
  - 票 03 會用 zoom 14 當門檻以下，原本那句到時候會變成錯的。
- Mutation check（下列改法都有測試變紅，還原後全綠）：
  - 前端門檻改回 14：門檻測試變紅。
  - 前端 `<` 改 `<=`：門檻測試和另外 8 條（zoom 15 判成 `hide`）變紅。
  - 後端 `MIN_ITEMS_ZOOM` 改回 14：zoom 14 那條變紅（沒有丟出 `pipi_zoom_too_low`）。
  - 後端 `<` 改 `<=`：zoom 15 那條變紅（丟出 `pipi_zoom_too_low`）。
- 文件：
  - 「Items by zoom」實測表後面補了一句重測方式：`/api/pipi/items` 現在會自己拒絕 zoom 14，重測要直接呼叫 `PipiMushroomClient.request`。這是 code review 提出的。
  - `rg` 掃過，剩下的 14 只出現在原站行為描述、實測表和測試裡。
- 測試結果：
  - 前端 `tests/frontend/*.ts`：48/48 pass，0 skipped。
  - `npm run build`（含 tsc）：通過。
  - `tests/pipi/` 五支都是 exit 0：`test_extension.js`、`test_cookie_header.py`、`test_api_cookie.py`、`test_cache_now_ms.py`、`test_items_min_zoom.py`。
- 人工驗證（dev backend + vite，台北車站 25.0478, 121.5170，地圖 1660×945，只開「花」、普花不顯示）：
  - 擴充功能推來的 cookie 是登入狀態，用的是原站真資料。
  - 請求次數有兩邊佐證：
    - 前端：在頁面裡包一層只記錄、不改回應的 `fetch`。
    - 後端：dev backend 的 access log。
    - 沒有看 DevTools Network。
  - 直接打後端 zoom 14：回 400 `pipi_zoom_too_low`。
    - log 裡緊接在後的兩筆原站請求是擴充功能推 cookie 時做的登入檢查。
    - 那兩筆跟 `PUT /api/pipi/cookie` 是同一條連線，跟 curl 那條不同。
  - zoom 14 的狀態列：「放大到 Zoom 15 以上才會載入 (目前 14)」；英文介面是「Zoom in to level 15+ to load (now 14)」。
  - 在 zoom 14 平移 3 次、按「重新整理」，之後又停了約 80 秒（重新整理後第 60 秒那次強制更新也落在 zoom 14）：0 次 items 請求。
  - 放大到 15：
    - 700 ms 後送出 1 次（zoom=15），原站回應 1.7 秒。
    - 約 2.5 秒畫出 1167 朵花。
  - 15→14→15：
    - 在 14 停 2 秒：0 次請求，0 個點位。
    - 回到 15：711 ms 送出 1 次，直接畫出 1167 個點位，沒有先出現殘缺資料。
    - 這次 34 ms 就回來，是命中後端 30 秒快取。
  - 重新整理後第 120 秒的強制更新發生在 zoom 15，送出 1 次，屬正常行為。
  - 後端 log 共 3 次前端發的 `GET /api/pipi/items`（zoom=15，全部 200），加上手動 curl 的那 1 次 zoom 14（400），沒有 429。
- 版本號沒動。
