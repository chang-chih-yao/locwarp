# 01 花的子篩選：型別、初始值、resolver

Status: resolved
Blocked by: (none)

Spec: `.scratch/pipi-flower-filter/spec.md`

## 做什麼

依 spec「Implementation Decisions → 篩選狀態」，在 `frontend/src/defaults.ts` 與點位種類並列加上花的子篩選的型別、初始值、resolver。
這是唯一的定義處，之後的票（02 模組、03 面板、04 圖層）都引用這裡。

建議命名（與既有 `PipiKindKey` / `INITIAL_PIPI_KINDS` / `resolvePipiKinds` 對齊）：
`PipiFlowerFilter`、`INITIAL_PIPI_FLOWER_FILTER`、`resolvePipiFlowerFilter`。

## 驗收

- spec「Testing Decisions → 初始值（擴充 tests/frontend/test_defaults.ts）」列的四類測試全部加上，測試名稱用繁體中文寫意圖。
- 每條規則做 mutation check（逐欄位的「存過的值保留」、「非布林用初始值」、「非物件整份退回」），回報改了什麼、哪個測試變紅。
- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"` 全綠（在 repo 根目錄跑）。

## 不做

- MapView 的 state 與 localStorage 讀寫（票 03）。

## Comments

- 2026-11-05：完成，commit `0231603`（ff 合併進 `pipi-flower-filter`）。新增 `PipiFlowerFilter`、`INITIAL_PIPI_FLOWER_FILTER`、`resolvePipiFlowerFilter`；前端測試 14/14 pass，`npm run build` 通過。16 條 mutation check 中 15 條會讓測試變紅；拿掉 `typeof raw === 'object'` 是等價 mutant（原始值本來就讀不到欄位），照 `resolvePipiKinds` 保留。
