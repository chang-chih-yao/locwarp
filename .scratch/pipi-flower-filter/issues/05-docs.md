# 05 蘑菇地圖文件與 rules 檔

Status: resolved
Blocked by: 02, 03

Spec: `.scratch/pipi-flower-filter/spec.md`

## 做什麼

依 spec「Further Notes → 實作完成後要更新的文件」：

- `docs/pipi-mushroom.md`：Pieces 表加上票 02 的模組；面板那一列補上花的子篩選；補上花的 `key` 格式（`f:<顏色>:<品種>`、普花四個 key、花苞 state）和彩帶花的判斷，讓原站改版時有依據對照。原站行為與資料格式的來源見 spec「Further Notes」。
- `.claude/rules/pipi-mushroom.md`：frontmatter `paths` 加上新模組與新測試檔；Tests 那行補上 tests/frontend 的跑法。

這兩份文件是英文，沿用既有語氣與格式；名詞對照 `GLOSSARY.md`。內容寫事實與依據，不重抄 spec 全文。

## 驗收

- 文件裡寫到的檔名、函式名、key 都跟 integration branch 上的實作一致。

## 不做

- README、版本號。

## Comments

- 2026-11-05：完成，commit `5d1de85`（no-ff merge `d4346f7` 進 `pipi-flower-filter`）。`docs/pipi-mushroom.md` 加 Flower rules 列、面板列補子篩選、新增「Flowers: item format and the 花的子篩選」段（key 格式、普花四個 key、花苞正規化、彩帶花判斷、伺服器時間 vs 原站本機時間）；`.claude/rules/pipi-mushroom.md` 的 `paths` 加新模組與測試、Tests 行補 tests/frontend 跑法（YAML 已驗證）。未寫票 04 的外框與 popup 細節。
