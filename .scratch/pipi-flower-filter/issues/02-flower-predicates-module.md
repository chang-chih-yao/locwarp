# 02 判斷花的純函式模組

Status: resolved
Blocked by: 01

Spec: `.scratch/pipi-flower-filter/spec.md`

## 做什麼

依 spec「Implementation Decisions → 新的純函式模組：判斷花」新增模組，對外提供三個判斷：是不是普花、是不是彩帶花（含彩帶期結束時間）、要不要顯示。

- 建議路徑：`frontend/src/pipiFlowers.ts`；測試 `tests/frontend/test_pipi_flowers.ts`。
- 執行期零 import；子篩選型別取自 `frontend/src/defaults.ts`（票 01），點位型別 `PipiItem` 取自 `frontend/src/services/api.ts`，都用 type-only import。
- 名詞照 `GLOSSARY.md` 蘑菇地圖段落（花種、花苞、普花、彩帶花），不說「顏色」。
- 參考：既有的到期判斷與 `kindOf` 在 `frontend/src/hooks/usePipiMushroomLayer.ts`（本票不改它，圖層接線是票 04）。

## 驗收

- spec「Testing Decisions → 判斷花的模組」列的每一項測試都有，含真值表、普花四個 key、花苞（合成資料）、彩帶期邊界、字串時間欄位。合成資料的測試名稱寫明在防哪種原站格式變化。
- spec 列的每條規則逐條 mutation check，回報改了什麼、哪個測試變紅。
- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"` 全綠。

## 不做

- 圖層、面板、popup 的接線（票 03、04）。

## Comments

- 2026-11-05：完成，commit `ed6672b`（經 merge `385e6cb` 進 `pipi-flower-filter`）。`frontend/src/pipiFlowers.ts` 對外 `isCommonFlower(item)`、`ribbonEndMs(item, nowMs): number | null`、`passesFlowerFilter(item, filter, nowMs)`；`tests/frontend/test_pipi_flowers.ts` 15 個測試。前端測試 29/29、`npm run build` 通過。
- Mutation check 29 條，27 條變紅。未變紅 2 條，判定為等價 mutant，照 spec 保留規則：
  - 拿掉「時間 > 0」：時間是 0 的花在任何真實伺服器時間都已被「盛開後 60 分鐘內」與 `now < wiltingMs` 擋掉，只有 now 在 epoch 後一小時內才觀察得到。
  - 「有限的數字」改成只檢查 `typeof number`：只差在 `Infinity`，JSON 傳不了。
- 已盛開花的 `state` 在測試裡寫 `'Flower'` 是推測（後端原樣轉送，手上沒有抽樣原始資料）；測試只依賴「不是花苞的 state」。
- commit 訊息原本缺標題後的空行，已用 msg-filter 補上（hash 因此改變；票 01 → `0231603`、票 03 → `5798e72`）。
