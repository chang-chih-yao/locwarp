# 03 縮到門檻以下時保留資料，放大回來直接重畫

Status: ready-for-agent
Blocked by: 02

Spec: `.scratch/pipi-zoom-threshold/spec.md`

## 做什麼

依 spec「Solution」、「Implementation Decisions → 圖層 hook」與 User Stories 4–18、22：縮到門檻以下時只把點位藏起來，資料和抓取紀錄都留著。放大回來時，700 ms debounce 一結束就用留著的資料重畫（已結束的點位照樣濾掉），再照平常的重抓規則決定要不要發請求。

**planner**

- 拿掉票 01 在 `hide` 時清掉紀錄的那段，改成 spec 規則 1 的「紀錄原樣保留」。

**hook（`frontend/src/hooks/usePipiMushroomLayer.ts`）**

- `hide` 分支：
  - 中止進行中的請求。
  - 不清資料、不重建 planner。
  - 加一行註解說明這兩件事不能做。這一半沒有自動化測試，只有人工驗證在守（spec「只守住一半」）。
- 畫 marker 的 effect 多看一個「藏著」的狀態：藏著時不建圖層、筆數 0、資料保留。
  - 這個判斷跟現有「沒有資料」的 early return 放在一起，排在讀出並清掉待重開的 popup 之後。放在前面的話，放大回來會重開 popup。
  - 判斷不是 `hide` 時，不論原本是否藏著，一律改回顯示。「藏著」不會隨抓取 effect 重跑而重設：在門檻以下關掉圖層、放大到 15 再打開時，新的 effect 不知道之前藏過。如果只在「記得自己藏過」時才改回顯示，點位會一直藏著，狀態列卻顯示 ok、0 筆。
  - 關掉圖層、沒有 cookie 而清空資料時，也把「藏著」改回顯示。
- 藏起來和重畫只看 zoom，不受停止抓取和 429 退避影響，只有送請求那一步才看這些條件。
  - 現況停止抓取時整個 `load` 直接 return，縮小後舊點位會留在地圖上，這次修正。
  - 視窗在背景時仍然整個跳過。
- 狀態列照 spec 的五條規則依序判斷。
  - 規則 3 只在點位從藏著變成顯示時套用；點位本來就顯示著的 `reuse` 不改狀態列，跟現況一樣。
  - 要做到規則 3，留著的那份資料抓取時的狀態（phase 是 ok 還是 region、是否截斷、更新時間）要跟資料一起留著。
  - 規則 5 也一樣：429 之後縮小，zoom 提示會蓋掉限流錯誤。放大回來需要重抓時要再顯示那句錯誤，所以要另外留著，或依 `pipi_rate_limited` 重新產生。錯誤訊息是固定字串，兩種做法都可以。
- 留著的資料的伺服器時間偏移，沿用抓取當下算出的時間差，不用重算（spec「留著的資料用的伺服器時間偏移」那條）。
- 不變的部分：
  - 關掉圖層、沒有 cookie 時照舊清空資料（「藏著」也一併改回顯示，見上）。
  - 抓取 effect 重跑時（重新整理、cookie 換了、開關圖層）照舊建立新的 planner。
  - 藏起來和重畫都走既有的 700 ms debounce，不改 debounce 的結構。

## 測試

在 planner 測試檔加下面四條。現在門檻已經是 15，「門檻以下」用 zoom 14。

- 縮小再放大回來：
  - 步驟：t0 記下 zoom 15 的抓取；t0+5 秒 zoom 14 是 `hide`；t0+10 秒用同一個畫面回到 zoom 15 是 `reuse`。
  - **先寫這條、在拿掉票 01 的清除之前跑一次，確認是紅的**，改完才綠，並回報紅的輸出。
  - mutation：`hide` 時清掉紀錄，要紅。
- 縮小期間 60 秒計時器觸發：
  - 步驟：t0 記下 zoom 15 的抓取；t0+5 秒 `plan(zoom 14, force)` 是 `hide`；t0+10 秒 `plan(zoom 15)` 是 `reuse`。
  - mutation：`force` 時清掉紀錄，要紅。
- 縮小期間平移過：
  - 步驟：t0 記下 zoom 15 的抓取；t0+5 秒 zoom 14 是 `hide`；t0+10 秒用超出紀錄範圍的畫面回到 zoom 15 是 `fetch`。
  - mutation：`hide` 之後第一次放大回來一律判 `reuse`，要紅。
- 縮小超過 60 秒再放大回來（User Story 7）：
  - 步驟：t0 記下 zoom 15 的抓取；t0+5 秒 zoom 14 是 `hide`；t0+60 000 ms 用同一個畫面回到 zoom 15 是 `fetch`。
  - 票 01 的 60 秒邊界測試沒有經過 `hide`，這條補上經過 `hide` 的情況。
  - mutation：`hide` 之後不看新鮮期，要紅。

每條 mutation check 回報改了什麼、哪個測試變紅。

## 文件

- `docs/pipi-mushroom.md` 的 Throttling 段補一句：縮到門檻以下時保留資料，放大回來照重抓規則決定要不要抓。

## 驗收

- 前端測試全綠：在 repo 根目錄跑 `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"`。
- `tests/pipi/` 全部照跑，結果逐一回報：`test_extension.js`、`test_cookie_header.py`、`test_api_cookie.py`、`test_cache_now_ms.py`、票 02 新增的後端測試。
- 前端 `npm run build`（含 tsc）通過。
- spec「Testing Decisions → 人工驗證」列的項目全部在真實 app 跑過，逐項回報結果。
  - 包含票 02 已經驗過的前三項，當作回歸。
  - 票 02 的第四項（15→14→15 回到 15 時直接發一次請求）是這張刻意改掉的：做完這張，60 秒內放大回同一個畫面不發請求，見 spec 人工驗證「15 → 14 → 15」那項。這不算回歸。
  - 包含 spec 新增的「在門檻以下關掉圖層，放大到 15 再打開」：點位要正常出現。
  - 429 和強制更新失敗兩項可以用假的後端回應模擬，做不到要明說沒做。

## 不做

- 改 debounce 的結構、60 秒週期、25% padding、後端的快取與請求間隔。
- 關掉圖層或重新載入頁面後還沿用之前的資料。
- marker 上限 1500 的截斷（`.scratch/pipi-max-markers/issues/01-marker-cap-silent-truncation.md`）。
