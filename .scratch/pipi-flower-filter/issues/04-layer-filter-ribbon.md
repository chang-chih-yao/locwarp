# 04 圖層套用子篩選、彩帶花外框、popup 彩帶行

Status: resolved
Blocked by: 02, 03

Spec: `.scratch/pipi-flower-filter/spec.md`

## 做什麼

依 spec「Implementation Decisions → 圖層」與 User Stories 15–18、20–23：

- `frontend/src/hooks/usePipiMushroomLayer.ts`：
  - hook 多收花的子篩選的值（型別引用 `defaults.ts`）。
  - 建立 marker 時依 spec 的順序呼叫票 02 的模組（`frontend/src/pipiFlowers.ts`）判斷要不要顯示，再計入 marker 上限。
  - 子篩選只加進「建立 marker」effect 的相依項，不碰抓資料 effect；prune 維持現狀。
  - icon 快取鍵含「是否為彩帶花」；popup 打開時用當下伺服器時間再判斷一次，是彩帶花才加彩帶行。
- `frontend/src/components/MapView.tsx`：把票 03 建好的 state 傳給 hook。
- `frontend/src/styles.css`（`.pipi-pin-inner` 一帶）：彩帶花的彩虹圓環；注意 spec 講的 `overflow: hidden` 裁切問題，marker 尺寸與錨點不變。
- `frontend/src/i18n/strings.ts`：popup 彩帶行的中英文，放在 `map.pipi_wilts_at` 後面。

## 驗收

- 遵守 `.claude/rules/pipi-mushroom.md`（站方字串要 escape、節流不變）。
- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"` 全綠。
- repo 沒有 DOM 測試環境；圖層的人工驗證項目留到全部完成後一起做，本票不需回報。

## 不做

- 改判斷規則本身（在票 02 的模組裡）、後端、上游請求。

## Comments

- 2026-11-05：完成，commit `8bd380b`（ff 合併進 `pipi-flower-filter`）。hook 收 `flowerFilter`；每筆點位在點位種類與到期判斷後交給 `passesFlowerFilter`，通過才計入 `MAX_MARKERS`；marker effect 相依項加 `flowerFilter.ribbonOnly`、`flowerFilter.showCommon`，抓資料 effect 與 prune 未動；icon 快取鍵含彩帶；彩虹圓環用透明 border + `padding-box`/`border-box` 雙層背景（`.pipi-ribbon`），不受 `overflow: hidden` 影響；popup 打開時重新呼叫 `ribbonEndMs`，i18n `map.pipi_ribbon_ends_in`。前端測試 29/29、`npm run build`、`tests/pipi/` 三支回歸都通過。
- 已知邊界：剛好在盛開那一毫秒打開 popup 時倒數為 3,600,000 ms，`fmtDuration` 會顯示 `1:00:00`（spec 說不會出現小時）。留給 code review。
