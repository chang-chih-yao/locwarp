# 02 載入門檻改成 zoom 15（前後端）

Status: ready-for-agent
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
