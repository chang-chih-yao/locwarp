# 01 蘑菇地圖花的 popup 加「瞬移+撈水果」按鈕

Status: resolved
Blocked by: (none)
Type: feature

## 為什麼

遊戲要玩家走一段路、沿路**種花**（GLOSSARY），才會給那朵花的水果。直接瞬移到花上沒有任何移動軌跡，不會種花，也就拿不到水果。所以這個動作要先瞬移到花旁邊，再走到花上，也就是**撈水果**（GLOSSARY）。

## 決定

2026-11-05 grilling 的 Q1～Q18 都照建議；同一天依另一個 session 的 review 修訂（見 Comments）。Q15 決定的就是這張票本身：只開一張票，不另寫 `spec.md`。

### 行為

- 按鈕文字：中文「瞬移+撈水果」、英文「Teleport + fruit」。使用者原本寫「順移」是打錯字。（Q1）
- 只有**在盛開期內的花**才出現這顆按鈕：點位種類是花、不是**花苞**、還沒枯萎。蘑菇、煙霧都不出現。（Q2）
  - 判斷在 popup 打開時、用當下的伺服器時間做。原因是「還沒枯萎」會隨時間改變，而圖層每 30 秒才清一次已結束的點位，這段時間內已枯萎的花還留在地圖上。
- 起點固定在花的正東方 30 m，不做設定、不隨機。（Q3）
- 從起點到花一律直線走，不管「直線」開關和路線引擎怎麼設。（Q4）
- 速度沿用目前的移動模式、自訂速度、速度範圍，跟「導航到這裡」一樣。（Q5）
- 單機：瞬移失敗（冷卻中被擋下、裝置斷線等）就整個中止、不導航，錯誤顯示跟一般瞬移一樣。（Q6）
  - 冷卻只有在「單機，而且這次瞬移跟上一個位置相距 1 km 以上」時才會擋：冷卻表在 1 km 內是 0 秒（`backend/config.py` 的 `COOLDOWN_TABLE`），群組模式下後端也會跳過冷卻。所以在同一區連續撈好幾朵花，不會被冷卻擋下。
- 群組模式（兩台以上裝置）：（Q8、Q19）
  - 對所有裝置一起做：全部瞬移到起點，再一起走到花上。
  - 只要有一台瞬移失敗，就全部不走、整個中止。這是使用者的決定，沒有採用「只讓成功的走」。瞬移成功的裝置就留在起點，不拉回原處。
  - 只跳一則提示，因為 `showToast` 會蓋掉前一則，連跳兩則只看得到第二則：
    - 中止時，提示要寫明撈水果已中止，並列出每台裝置的瞬移結果。
    - 全部瞬移成功時，提示就是導航的結果，跟「導航到這裡」一樣。
- 瞬移成功後立刻開始走，不為了遊戲刻意等待。實測如果遊戲沒反應，再另外加等待。（Q7）
- 最近地點只記一筆花的座標，類別是 `navigate`；起點不記。撈水果中止（沒有任何裝置開始走）時不記。（Q9）
- 第三顆按鈕放在既有兩顆的下一排，佔滿寬度。（Q10）
- 這是獨立的一次性動作，不重用**花農專用模式**（GLOSSARY，`SimMode.Flower`），也不吃它的半徑、圈數、等待設定。（Q11）
- GLOSSARY 新增**種花**、**撈水果**（Q12）和**花農專用模式**（Q20），都已寫入。

### 實作

- 在前端串接，不改後端：先等瞬移完成，再呼叫導航。（Q13）
  - `straight_line=true` 會讓後端跳過路線引擎（`backend/services/route_service.py` 的 `force_straight`），所以強制直線不用改後端。
- `frontend/src/pipiFlowers.ts`：新增 `canCollectFruit(item, nowMs)`，沿用既有的 `isBud`。已枯萎的判斷是 `wiltingMs` 有值而且 `nowMs >= wiltingMs`。（Q14）
- 新模組 `frontend/src/pipiFruit.ts`，跟 `pipiFlowers.ts` 一樣不做 runtime import、只用可清除的語法，讓 `node --test` 能直接載入：
  - `fruitStartPoint(lat, lng)`：回傳正東 30 m 的點。算法跟 `backend/core/flower.py` 的 `_circle_points` 一樣：每度 111,320 m，`cos(lat)` 最小取 1e-6。
  - `runFruitApproach(...)`：把「瞬移到起點 → 看結果 → 導航到花」寫成一個函式，瞬移和導航都從參數傳進來，單機和群組共用。
    - 瞬移回傳哪些裝置成功、哪些失敗。只要有一台失敗就不呼叫導航；全部成功才導航，而且帶 `{ straightLine: true, skipPreSync: true }`。
    - 回傳值要讓呼叫端知道是否中止、每台裝置的瞬移結果，以便決定要不要記最近地點、提示要寫什麼。
  - 把 `pipiFruit.ts` 和它的測試檔加進 `.claude/rules/pipi-mushroom.md` 的 `paths`。
- `frontend/src/hooks/useSimulation.ts`：
  - `navigate` 多收選填的 `{ straightLine?: boolean }`。
  - `navigateAll` 多收選填的 `{ straightLine?: boolean; skipPreSync?: boolean }`。
  - 不在 `App.tsx` 直接呼叫 `api.navigate`。否則單機會少掉 `sim.navigate` 裡切到導航模式、設定目的地、更新執行狀態這幾步，畫面上就不會顯示目的地。
  - 陷阱：`preSyncStart` 用的是按鈕按下當下 render 拿到的 `currentPosition`，也就是撈水果之前的舊位置，會把所有裝置拉回原處。撈水果的流程要帶 `skipPreSync`，因為所有裝置剛剛已經瞬移到同一個起點。
- `frontend/src/App.tsx`：新增撈水果的 handler。
  - 花的座標先經過 `clampLat` / `normalizeLng`，跟現有兩顆按鈕一樣。
  - 單機的 `handleTeleport` 沒有 await `sim.teleport`；撈水果的 handler 要 await 它並接住錯誤，否則瞬移失敗會變成沒處理的 rejection。`sim.teleport` 失敗時已經會 `setError`，錯誤顯示不用另外做。
  - 群組模式照 `handleTeleport` 的做法，先 `sim.setCurrentPosition` 到起點，再 `teleportAll`。
  - 群組模式在 `teleportAll` 之後等 150 ms 再導航，沿用 `preSyncStart` 原本的等待。這 150 ms 是讓裝置處理完瞬移、再收下一個指令，跟 Q7 為了遊戲決定的「不等待」是兩回事。單機的 `sim.teleport` 會等後端設好位置才回來，不用等。
- popup（`frontend/src/hooks/usePipiMushroomLayer.ts`）：
  - `popupHtml` 加第三個 `data-pipi-act`，只在 `canCollectFruit` 為真時才輸出。
  - `popupopen` 的點擊處理目前寫法是「`navigate` 走導航，其他都走瞬移」。三種動作要逐一對應，否則新按鈕會不報錯地變成普通瞬移。
  - hook 多收一個撈水果的 callback，由 `MapView.tsx` 往上接到 `App.tsx`。
  - `.map-popup-actions` 是不換行的 flex（`frontend/src/styles.css`），第三顆按鈕要另外開一排的容器。
- i18n：`frontend/src/i18n/strings.ts`，放在 `map.navigate_here` 附近。群組提示裡的動作名稱也從這裡來。

## 驗收

- 遵守 `.claude/rules/pipi-mushroom.md`（站方字串要 escape、節流不變）。
- 測試要鎖住的行為（Q14，review 後擴充）：
  - `tests/frontend/test_pipi_flowers.ts`，`canCollectFruit`：
    - 花苞（三個階段都算）、蘑菇、煙霧都不行。
    - 盛開的花可以；同一朵花到了 `nowMs >= wiltingMs` 就不行。
  - 新檔 `tests/frontend/test_pipi_fruit.ts`，`fruitStartPoint`：緯度不變、經度往東。在緯度 25 和 60 兩處，用 haversine（地球半徑 6371 km）量出的距離都要是 30 m ± 0.1 m。用每度 111,320 m 算出的起點約 29.97 m，在誤差內。
  - 新檔 `tests/frontend/test_pipi_fruit.ts`，`runFruitApproach`：
    - 瞬移的目標是起點，導航的目標是花。
    - 導航帶 `straightLine: true`、`skipPreSync: true`。
    - 全部瞬移失敗時不呼叫導航，回傳中止。
    - 只有部分瞬移失敗時也不呼叫導航，回傳中止。這一條鎖住 Q19：改成「只讓成功的走」測試就會紅。
    - 全部瞬移成功時才導航。
- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"` 全綠，`npm run build` 通過。
- 人工驗證（Q16，review 後修訂）：
  - agent 用 `start.py` 啟動 app，在瀏覽器確認：
    - 只有盛開的花出現第三顆按鈕，花苞、蘑菇、煙霧都沒有。
    - 第三顆按鈕自己一排、佔滿寬度。
    - 按下後，瞬移請求的座標是正東 30 m。
    - 沒接裝置時瞬移會失敗、導航請求不會送出，所以要在瀏覽器裡把瞬移的回應改成成功（例如攔截 `fetch`），再確認導航請求是花的座標、`straight_line: true`。
  - 使用者用手機實測遊戲裡拿不拿得到水果。
- 文件（Q17，review 後修訂）：
  - `README.md` 和 `README.en.md` 的蘑菇地圖那一節都補上撈水果。英文版在 `README.en.md` 的 "Mushroom map layer"，之前說英文 README 沒有這一節是查錯了。
  - `docs/pipi-mushroom.md` 加一小節，記下理由，以及為什麼是正東 30 m、強制直線。
- Commit（Q18，Q21 修訂）：
  - 前綴用半形冒號、後面不空格：`GLOSSARY:`、`蘑菇地圖:`、`.scratch:`。
  - GLOSSARY 照多數慣例自己一個 commit。
  - GLOSSARY 和這張票的 triage 在實作前就已經 commit。
  - 實作完再 commit 功能加 README、docs（`蘑菇地圖:`），以及這張票的結果（`.scratch:`）。

## 不做

- 後端改動、起點方向與距離的設定項目、為了遊戲在瞬移和導航之間刻意等待、重用花農專用模式。
- 清理程式註解裡的「種花模式」：GLOSSARY 已改用花農專用模式，舊稱待以後清理。出現在 `backend/core/flower.py`、`backend/core/simulation_engine.py`、`backend/models/schemas.py`、`frontend/src/App.tsx`、`frontend/src/components/MapView.tsx`、`frontend/src/hooks/useSimulation.ts`。
- 180 度經線附近：直線路線是直接對經度做線性內插，起點繞到 -180 那一側後會往反方向繞地球半圈。目前只支援台灣、香港、馬來西亞，離 180 度經線很遠。

## Comments

- 2026-11-05：依另一個 session 的 review 修訂。
  - 採納：
    - 英文 README 也要改。
    - agent 的人工驗證改成攔截瞬移回應。
    - 「還沒枯萎」要跟著時間判斷。
    - 「強制直線」和「跳過 `preSyncStart`」改用 `sim` 的選填參數。
    - 流程抽成 `runFruitApproach` 並加測試。
    - 撈水果中止時不記最近地點。
    - 冷卻那句改成正確的條件。
    - 拿掉 180 度經線的測試，改寫進「不做」。
    - 距離測試寫明 haversine 和誤差。
    - 改用「花農專用模式」這個名稱。
    - GLOSSARY 拿掉「順移」。
    - commit 前綴改成半形冒號。
    - 補上 Q12、Q15。
    - 補上 popup 分派、排版、await 三個實作提示。
    - 群組模式保留 150 ms 的等待。
  - 使用者決定：
    - Q19：群組模式只要有一台瞬移失敗就全部不走。沒有採用 review 跟 agent 建議的「只讓成功的走」。
    - Q20：GLOSSARY 新增花農專用模式。
    - Q21：commit 照上面的方式拆。
- 2026-11-05：實作在 `fc5c19e`。
  - 測試：前端 77/77（0 skipped），`npm run build` 通過。12 個 mutation 都讓測試變紅，包括「只讓成功的走」（Q19）、沒等瞬移就導航、不強制直線、不跳過 `preSyncStart`、拿掉 `wiltingMs`「有值」的判斷。
  - 人工驗證（agent 用 `start.py` 啟動，在瀏覽器驗）：
    - 驗證時有一台手機透過 Wi-Fi 通道連著，跟票裡「沒接裝置」的假設不同。為了不動到手機，瞬移、導航、最近地點的請求都在瀏覽器攔截 `fetch`、回假結果，沒有送到後端；後端 log 確認沒有收到這些請求。驗完把篩選設定還原，並重新整理頁面。
    - 只有盛開的花有第三顆按鈕：點開 241 個 popup，跟同一份資料的種類、`state`、`wiltingMs` 對照，0 筆不符。盛開的花 126 個都有；花苞（Bud、Leaf 各 1 個）、蘑菇 105 個、煙霧 8 個都沒有。資料裡沒有已枯萎、還留在地圖上的花，這一條只靠單元測試。
    - 第三顆按鈕在下一排，寬度跟整排一樣（173 px）。
    - 瞬移回失敗時：只送出瞬移，座標在花的正東 29.97 m（haversine）；沒有導航、沒有記最近地點，錯誤跟一般瞬移一樣顯示在畫面上方。
    - 瞬移回成功時：66 ms 後送出導航，座標是花、`straight_line: true`；最近地點記一筆花的座標，類別是 `navigate`。
    - 這些驗證做在 code review 的修正之前。那些修正只動到型別、群組路徑的常數（值不變）、註解和一行 CSS 註解，單機行為和 popup HTML 都沒變，所以沒有重做。
  - 沒驗到：
    - 群組模式（只有一台裝置）。瀏覽器沒驗；`setCurrentPosition`、150 ms 等待、提示內容也沒有自動測試，只有 `runFruitApproach` 的單元測試和型別檢查。
    - 使用者用手機實測遊戲裡拿不拿得到水果。
  - 票裡沒明講、實作時決定的：
    - 沒有任何裝置瞬移成功（零台）也算中止。
    - 「沒有任何裝置開始走」也包含導航失敗：單機 `sim.navigate` 丟錯、群組 `navigateAll` 全部失敗時，都不記最近地點。這跟「導航到這裡」不管成敗都記的做法不同。
    - popup 遇到沒有對應的 `data-pipi-act` 時不做事，並 `console.error`。
  - code review（Standards、Spec 兩軸）：
    - 採納：
      - 補上 `wiltingMs` 沒有值的測試。
      - 修正 docs 把枯萎條件寫反的地方。
      - 程式註解不用「盛開期」，因為 GLOSSARY 沒有這個詞條。
      - 測試檔頭寫明 Q 編號的出處。
      - `fanoutStatusList` 改用 `FanoutOutcome`。
      - 150 ms 抽成 `GROUP_SETTLE_MS`。
      - 拿掉 CSS 只是重述的註解。
      - docs 寫明票裡沒有給往東的理由。
    - 沒採納：
      - Data Clumps：`lat, lng` 分開傳是整個 codebase 的慣例。
      - `App.tsx` 的 Divergent Change：toast helper 就是為了這個流程抽出來的。
  - 跟這張票無關、沒有修：`start.py` 的輸出接到 pipe 時，cp950 印不出 `✓` 會當掉，要設 `PYTHONUTF8=1`。
- 2026-11-09：使用者決定把 Q3 的起點從正東 30 m 改成正東 35 m，沒有說理由；方向、固定不設定、直線走都不變。距離測試改成 35 m ± 0.1 m（用每度 111,320 m 算出約 34.96 m）。上面寫 30 m 的地方是當時的決定，沒有改。
- 2026-11-09：Q2 的「在盛開期內的花」改成只對彩帶花，因為水果只有彩帶花在彩帶期內才會結。見 `02-fruit-ribbon-only.md`。上面 Q2 是當時的決定，沒有改。
