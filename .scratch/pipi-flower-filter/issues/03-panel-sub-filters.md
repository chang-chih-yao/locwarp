# 03 面板的兩個子選項與設定存檔

Status: resolved
Blocked by: 01

Spec: `.scratch/pipi-flower-filter/spec.md`

## 做什麼

依 spec「Implementation Decisions → 面板」與 User Stories 10–13、19：

- `frontend/src/components/MapView.tsx`：持有花的子篩選 state，用票 01 的 resolver 從 localStorage `locwarp.pipi_flower_filter` 還原、變更時寫回。照著既有 `pipiKinds` 的做法（同檔約 423–437 行）。
- `frontend/src/components/PipiMushroomPanel.tsx`：點位種類 chip 那一列下方縮排放「只顯示彩帶」、「顯示普花」兩個勾選框；「花」關掉時兩個都 disabled 但保留勾選值。
- `frontend/src/i18n/strings.ts`：兩個標籤的中英文，放在 `map.pipi_kind_smoke` 後面（票 04 會在 `map.pipi_wilts_at` 後面加 popup 字串，分開放避免衝突）。

## 驗收

- 面板拿到值和變更 callback，型別引用 `defaults.ts` 的定義，不另外宣告。
- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"` 全綠。
- repo 沒有 DOM 測試環境；面板相關的人工驗證項目留到全部完成後一起做，本票不需回報。

## 不做

- 把子篩選傳進 `usePipiMushroomLayer`、圖層篩選、外框、popup（票 04）。

## Comments

- 2026-11-05：完成，commit `5798e72`（ff 合併進 `pipi-flower-filter`）。MapView 持有 `pipiFlowerFilter` 並存到 `locwarp.pipi_flower_filter`；面板加兩個勾選框（縮排 + 左邊線，「花」關掉時 disabled 保留值）；i18n `map.pipi_flower_ribbon_only`、`map.pipi_flower_show_common`。前端測試 14/14、`npm run build` 通過。未傳進 hook（票 04）。畫面待人工驗證。
