# 02 勾「顯示拿過精華的花」可以讓它們帶著 ✓ 出現

Status: resolved
Blocked by: 01
Spec: `.scratch/pipi-flower-essence/spec.md`

## 做什麼

蘑菇地圖面板的花的子篩選多一個勾選框「顯示拿過精華的花」。

- 不勾（初始值）：拿過精華的花藏起來，跟 01 號票做完時一樣。
- 勾起來：拿過精華的花也會出現，圖示角落加一個 ✓，一眼就能跟沒拿過的花分開。

## 驗收條件

- [x] 面板的第三個勾選框：
  - 文字是「顯示拿過精華的花」，英文 `Show flowers with essence taken`。
  - 排在「只顯示彩帶」「顯示普花」後面，縮排相同。
  - 「花」關掉時變灰，並保留勾選值。
  - 讀寫的是 01 號票加的 `showEssenceTaken`，跟既有兩個子選項存在同一個設定物件裡。
- [x] 勾起來時，拿過精華的花會顯示，而且帶 ✓：
  - 是不是拿過精華，在建立 marker 時判斷；整層重建和重新挑選都要判斷。icon 的快取鍵要包含這一項。
  - ✓ 放在圖示的外層，跟內層的圓並列，不放進內層。內層是圓形加 `overflow: hidden`，角落的 ✓ 放在裡面會被切掉。
  - ✓ 跟著標記大小縮放，小、中、大三種都看得清楚。
    - 注意：`--pipi-box`、`--pipi-ring`、`--pipi-dot` 現在是 inline 設在內層 `.pipi-pin-inner` 上（`usePipiMushroomLayer.ts` 建 icon 的 `pxStyle`）。✓ 放在外層、跟內層並列，拿不到這些變數，要把變數移到兩者共同的外層，或讓 ✓ 自己帶尺寸。
  - 沒拿過的花沒有 ✓；還不知道（標記清單還沒讀到）的花也沒有，清單回來之後才出現。
- [x] 勾起來時，標記清單還沒讀到也照常畫花，因為沒有東西要藏。這已經由 01 號票的花的子篩選處理，這張票只要確認沒有在圖層另外擋掉。
- [x] 切換這個勾選框只重畫 marker，不會送出 items 請求，也不會送出標記清單請求。
- [x] 人工驗證，逐項回報：
  - 面板排版；「花」關掉時變灰並保留勾選值；重新整理頁面後設定還在。
  - 勾和不勾兩種狀態下，地圖上的花和狀態列筆數都正確。
  - 三種標記大小下都看得到 ✓，而且沒有被圖示的圓切掉。
  - 勾著時用 fetch 攔截延遲清單回覆，打開圖層：花跟蘑菇一起出現，✓ 等清單回來才出現。
  - 切換勾選框時，Network 沒有新的 `/api/pipi/items` 或 `/api/pipi/essence` 請求。
- [x] 文件：蘑菇地圖設計文件的面板那一列補上第三個子篩選，並說明 ✓ 的意思。
  - 花的子篩選那一段現在寫 "the panel has no checkbox for it yet, so it stays off"（`docs/pipi-mushroom.md` 的 `showEssenceTaken` 那一項），這句要刪掉。
- [x] 回歸：`tests/frontend/*.ts`、`tests/pipi/` 全部照跑，`npm run build` 要通過。有任何 skipped 都要說明。

## 參考

- spec 的「花的子篩選設定」「圖層」兩段（✓ 徽章、標記狀態的生命週期），以及「人工驗證 → 面板、標記與取消」。
- 決策：Q7（只加 ✓，不調淡）、Q8（第三個子篩選）、Q13（不顯示被藏起來的朵數）。

## Comments

- 2026-11-10：實作在 `dea841e`。
  - 做法：
    - icon 多一層 `.pipi-pin-box`，`--pipi-*` 從內層 `.pipi-pin-inner` 移到這一層。✓ 跟內層的圓並列，不會被圓的 `overflow: hidden` 切掉。
    - ✓ 是綠底白勾的圓，用 SVG 畫，不用 ✓ 字元：字元的大小和基線隨字型變，小尺寸時會偏。大小、位置和邊框都照 `--pipi-box`、`--pipi-ring` 的比例算：小 13.8 px、中 18.4 px、大 23 px（標記 30、40、50 px）。
    - 判斷拿過精華時不另外檢查點位種類，照 `essenceTaken` 既有的約定。實測 133 筆蘑菇、8 筆煙霧都沒有盛開時間，所以沒有標記的識別。
  - 測試：
    - 前端 122/122，0 skipped。`tests/pipi/` 6 支 Python 和 `test_extension.js` 的 exit code 都是 0。`npm run build` 通過。
    - `tests/pipi/check_live_anonymous.py` 沒跑：它會匿名打原站，rules 檔規定只在原站腳本改版後跑。
    - 照 spec 不新增自動化測試，所以這張票沒有 mutation check。
  - 人工驗證：
    - 做法：agent 啟動 backend 和一個注入攔截器的 Vite（5174），在瀏覽器驗。地圖在 01 號票那朵黃色萬壽菊上（新竹，zoom 16），它的標記到 2026-11-10 18:06:44 才失效。
    - 假標記：攔截器在清單回覆裡多加 5 筆，是離那朵最近的 5 朵盛開的花。只改瀏覽器收到的 GET 回覆，沒有寫進原站。
    - 安全措施：頁面的非 GET 請求一律在瀏覽器回 503，共 3 個（`PUT /api/geocode/provider-pref` 兩次、`POST /api/device/wifi/tunnel/start-and-connect` 一次），都沒有送到後端。後端 log 裡唯一的非 GET 是 `PUT /api/pipi/cookie`，來自使用者 Chrome 的 cookie-sync 擴充功能。log 裡沒有 cookie 值。
    - 中途 cookie 過期：LocWarp 存的是 22:37 推的 cookie，一開始 items 和清單都回 401。使用者在 Chrome 登入原站之後擴充功能沒有推；請使用者點擴充功能的圖示之後，00:10:33 推了進來。
    - 面板：
      - 第三個勾選框排在第二行，跟「只顯示彩帶」對齊，左邊是同一條花色線；英文介面三個各一行。文字中英文跟票一致。
      - 「花」關掉時三個都停用、變灰（`#5d6378`），第三個保留勾選。重新整理頁面後設定還在；「花」打開後恢復可按。存的是 `{"ribbonOnly":false,"showCommon":true,"showEssenceTaken":true}`。
    - 筆數（狀態列都等於 marker 數）：
      - 勾著：花 428 朵，✓ 6 個，位置剛好是 6 朵標過的花（1 朵真的 + 5 朵假的），狀態列 572。
      - 不勾：花 422 朵（428 − 6），✓ 0 個，那朵萬壽菊沒畫，狀態列 565。
      - 再勾回來：花 428 朵、✓ 6 個，狀態列 571（中間有 1 朵蘑菇到期）。
    - 三種標記大小下 6 個 ✓ 都看得到，在圖示右上角壓著花圈外緣，沒有被圓切掉。
    - 延遲清單 5 秒：
      - 勾著、關掉再打開圖層：花、蘑菇、煙霧 0.1 秒一起出現，✓ 0 個，萬壽菊畫出來但沒有 ✓；5.2 秒清單回來，6 個 ✓ 一起出現。
      - 順便驗沒勾的情況，01 號票的行為沒變：蘑菇、煙霧 0.4 秒出現，花 6.1 秒才出現（422 朵），萬壽菊全程沒畫。
    - Network：
      - 切換勾選框兩次：攔截器記錄 0 次 `/api/pipi/items`、`/api/pipi/essence`；後端 access log 在那段時間（00:11:43～00:11:51）也沒有請求。
      - 換標記大小：也沒有請求。中間那筆 items 跟上一次差 60.0 秒，是強制刷新，沒有連帶讀清單。
      - cookie 推進來之後，items 5 次、清單 4 次，攔截器和後端兩邊對得上；都對得到 cookie 重新設定、按重新整理、強制刷新、兩次重開圖層。
  - code review（Standards、Spec 兩軸）：Standards 沒有硬違規，6 條判斷題；Spec 沒有缺漏、沒有 scope creep，1 條可商榷。
    - 採納：
      - 原本 `addMarker` 另外檢查點位種類，跟 `essenceTaken` 的 docstring（呼叫端不用檢查點位種類）和 `shouldShow` 的註解兩種寫法並存。選既有、有測試的約定，拿掉這次加的檢查，沒有留下要清理的。
      - `MARKER_PX` 的註解補上 ✓ 的邊框也用 `--pipi-ring`。
      - `ESSENCE_CHECK_HTML`、`.pipi-essence-check` 改名成 `...CHECKMARK...`、`.pipi-essence-checkmark`，免得讀成「檢查」。
      - 「✓ 放在圓外」的理由原本寫了五處，現在只留在 styles.css 的 ✓ 規則和設計文件，hook 改成指向 styles.css。
      - 設計文件的面板那一列補上 ✓ 的意思（Spec 那一條）。
    - 沒採納：
      - `shouldShow` 和 `addMarker` 各算一次 `essenceTaken`：spec 指定在建立 marker 時判斷。要共用的話，`selectPipiMarkers` 得把判斷結果往外傳、介面變大，換來的只是省一次 Map 查找。
      - `.pipi-pin-box` 和 `.pipi-pin-inner` 都宣告寬高：內層的圓保留自己的尺寸，不依賴外層。
    - 改完重跑 typecheck、前端 122/122、`npm run build`，瀏覽器確認改名後 6 個 ✓ 照常出現。
  - 要使用者決定、這次沒改：
    - cookie-sync 擴充功能在 LocWarp 存的 cookie 已經失效時，可能不會自己補推。照 `background.js` 的 `doSync`：每分鐘的檢查在狀態是「已同步」、LocWarp 回 `configured: true` 時直接跳過。它只看 LocWarp 有沒有 cookie，不看那份還能不能用。Chrome 本來就登入著的話，重新登入也不會改到 cookie。這次沒確認擴充功能當時的實際狀態，只確認了點圖示之前一直沒推。跟這張票無關。
