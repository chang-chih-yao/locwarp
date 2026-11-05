# 01 抽出抓取判斷模組（行為不變）

Status: ready-for-agent
Blocked by: (none)

Spec: `.scratch/pipi-zoom-threshold/spec.md`

## 做什麼

依 spec「Implementation Decisions → 新模組：抓取判斷（planner）」與 User Story 24 新增模組，把 hook 裡「藏起來、沿用、重抓」的判斷搬進去。這張是純重構：玩家看到的行為、送出的請求都跟現在一樣。門檻改成 15 是票 02，縮到門檻以下保留資料是票 03。

- 建議路徑：`frontend/src/pipiFetchPlanner.ts`；測試 `tests/frontend/test_pipi_fetch_planner.ts`。
  - 執行期零 import，只用 TypeScript 可直接抹除的語法，比照 `frontend/src/pipiFlowers.ts`，讓 `node --test` 能直接載入。
  - 介面照 spec 的 `createPipiFetchPlanner()`（`plan` / `record`）、`PipiBox`、`PipiFetchDecision`。
- 前端的門檻常數（這張仍是 **14**）和 60 秒新鮮期搬進模組。
  - hook 的 60 秒強制更新週期也用這個新鮮期。
  - `frontend/src/hooks/usePipiMushroomLayer.ts` 和 `frontend/src/components/PipiMushroomPanel.tsx` 改成從模組引用，hook 不再宣告、也不再匯出門檻常數。
- hook 的 `load` 把 `last` 和那段沿用條件換成 `plan` / `record`：
  - Leaflet 的範圍在 hook 裡轉成 `PipiBox`。
  - `record` 的 `bounds` 存 pad 過、沒換算經度、沒 clamp 的那份，跟現況的 `last.bounds` 一樣（spec「`record` 的 `bounds`」那條）。
  - 判斷順序照現況：停止抓取或視窗在背景時直接 return；`hide` 在 429 退避檢查之前。
- **跟 spec 刻意不同的一處（暫時）：** spec 規則 1 要 `hide` 時保留紀錄，這張的 planner 在 `hide` 時**清掉**紀錄，hook 的 `hide` 分支也照舊清掉資料。
  - 兩邊一起清才等於現況。如果只有 planner 保留紀錄，縮到 13 再於 60 秒內放大回 14 會判 `reuse`，資料卻已經清掉，地圖空白到下一次強制更新，比現況更糟。
  - 這個清除不寫測試。票 03 會拿掉它，並用自己的測試先紅後綠確認。
  - 不要改成在 hook 的 `hide` 分支重建 planner（spec「只守住一半」禁止）。

## 測試

先寫測試再改程式，測試名稱用繁體中文寫出要守住的意圖，比照 `tests/frontend/test_pipi_flowers.ts`。範圍、時間、zoom 都寫死數字。

- **zoom 的選法：** 門檻以上一律用 15 以上，「門檻以下」一律用 **13**，不要用 14。票 02 把門檻改成 15 後，這些測試不用改；用 14 的話，02 會讓它們變紅，02 的 agent 得回頭改測試。
- 要有的測試：
  - 沒有紀錄：zoom 15 是 `fetch`。
  - zoom 13 加 `force` 是 `hide`（60 秒自動更新在門檻以下不發請求）。
  - zoom 13 時，即使有新鮮、涵蓋畫面的紀錄也是 `hide`（`hide` 優先於 `reuse`）。
  - 新鮮期邊界：記錄後 59 999 ms 是 `reuse`，剛好 60 000 ms 是 `fetch`。這張不經過 `hide`。
  - 門檻以上 `force`：紀錄新鮮又涵蓋畫面，仍是 `fetch`。
  - 截斷：紀錄被截斷時，同 zoom（記 15、問 15）是 `reuse`，不同 zoom（記 15、問 16）是 `fetch`；沒被截斷時，不同 zoom 也是 `reuse`。
  - 範圍邊界：畫面和紀錄範圍完全相等是 `reuse`；北、南、東、西任一邊超出一點點都是 `fetch`，四邊各測一次。
- 每條規則做 mutation check，回報改了什麼、哪個測試變紅。至少要有：
  - zoom 判斷移到沿用判斷之後。
  - `force` 判斷拿掉。
  - 60 秒比較的 `<` 改成 `<=`。
  - 範圍比較改成不含邊界（四邊各一次）。
  - 截斷條件拿掉。

## 文件

- `docs/pipi-mushroom.md`：
  - Pieces 表加上新模組。
  - 開頭的 Tests 那行加上新的前端測試檔。
- `.claude/rules/pipi-mushroom.md`：
  - `paths` 加上新模組和新的前端測試檔。
  - Tests 那行原本寫「for the flower rules」的前端測試說明，改成泛指前端測試。

## 驗收

- 在 repo 根目錄跑 `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"`，全綠。
- 前端 `npm run build`（含 tsc）通過。
- 人工驗證：在真實 app（dev backend + vite，台北市區）開著 DevTools Network，看 `/api/pipi/items`。逐項回報，做不到的明說：
  - 在範圍內平移不發請求，超出範圍才發一次。
  - 停著不動約 60 秒會發一次。
  - 縮到 13：點位藏起來，狀態列顯示「放大到 Zoom 14 以上才會載入 (目前 13)」，不發請求。
  - 放回 14：重抓（這張還會清資料）。
  - 按「重新整理」：重抓。
  - 登入失效（或模擬 `pipi_login_required`）後：不再發請求。

## 不做

- 改門檻（票 02）。
- `hide` 時保留紀錄和資料、狀態列規則、停止抓取時藏點位（票 03）。
- 改 debounce、60 秒週期、25% padding、經度換算。
