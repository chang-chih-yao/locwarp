# 01 後端快取命中時回傳舊的 now_ms，前端把伺服器時間算慢最多 30 秒

Status: needs-triage
Blocked by: (none)
Type: bug

## 現象

`GET /api/pipi/items` 命中後端的 30 秒快取時，回應裡的 `now_ms` 是**存進快取那一刻**原站給的時間，不是現在。

前端用它推算伺服器時間：`usePipiMushroomLayer.ts` 的 `offset = res.now_ms - Date.now()`，之後所有判斷都用 `Date.now() + offset`。快取放了多久，前端認定的「現在」就慢多久，最多慢 `CACHE_TTL` 30 秒。

受影響的判斷全部用這個時間：

- 到期判斷：`end <= now` 的點位不畫，prune 也用它。已結束的蘑菇、煙霧和已枯萎的花，最多會多留 30 秒。
- 彩帶花：圖層重建時的彩虹外框、「只顯示彩帶」篩選、popup 的彩帶行。彩帶期結束最多會晚 30 秒才被認定。
- popup 的倒數：「剩 …」和「彩帶花 · … 後結束」都會多算最多 30 秒。

## 這次量到的誤差：23 秒

2026-11-05 做 pipi-flower-filter 的人工驗證時量到（細節見 `.scratch/pipi-flower-filter/spec.md` 底部 Comments）。

- 對象：一朵彩帶花，藍色花朵，座標 25.067756, 121.493156，在 zoom 17 的同一個視窗範圍內觀察。
- 依未經快取的資料推算，它的彩帶期在本機時間 12:56:20 結束。

時間軸（本機時間）：

| 時間 | 事件 | 依據 |
|---|---|---|
| 12:55:59–12:56:00 | 第 5 次 items 請求：真的打原站，結果存進快取 | backend log 有 `POST .../MfMapData.ashx`，時間戳 12:56:00.440 |
| 12:56:23 | 第 6 次 items 請求：同一個 bbox，**沒有**打原站 | backend log 這筆 `GET /api/pipi/items` 前面沒有任何 `MfMapData.ashx`，所以是快取命中，`now_ms` 舊了約 23 秒 |
| 12:56:24 | 開 popup，顯示「彩帶花 · 0:19 後結束」 | 前端因此認定彩帶期在 12:56:43 結束，比 12:56:20 晚 **23 秒**；實際上這時彩帶期已經過了 4 秒 |
| 12:56:46 | 重開 popup，彩帶行才消失 | — |
| 12:57:23 | 第 7 次請求打原站，拿到新的 `now_ms`，外框變回粉紅 | backend log 有 `POST .../MfMapData.ashx` |

23 秒的誤差，正好等於第 5 次存進快取到第 6 次命中之間的間隔（12:56:00 → 12:56:23）。

第 6 次請求在 60 秒週期之外，推測是 cookie 時間戳變了觸發 `reloadToken`；觸發原因沒有確認，但不影響結論。同一個 bbox 在 30 秒內再請求一次，就會發生這個現象，例如：

- 按「重新整理」
- 擴充功能推送新的 cookie
- 切回視窗時的 `visibilitychange`
- 開關圖層

## 原因

`backend/services/pipi_mushroom.py` 的 `items()`：

```python
hit = self._cache.get(key)
if hit and time.monotonic() - hit[0] < CACHE_TTL:
    return hit[1]          # ← now_ms 還是存進快取時的值
...
"now_ms": int(j.get("nowMs") or time.time() * 1000),
...
self._cache[key] = (time.monotonic(), result)
```

快取鍵以外的欄位都可以原樣重用，但 `now_ms` 代表的是「回應當下的伺服器時間」，不能重用。

## 修法

快取命中時，回傳一份淺拷貝，把 `now_ms` 加上快取存在的時間：

```python
if hit and time.monotonic() - hit[0] < CACHE_TTL:
    age_ms = int((time.monotonic() - hit[0]) * 1000)
    return {**hit[1], "now_ms": hit[1]["now_ms"] + age_ms}
```

- 用存進快取時已有的 `time.monotonic()` 算經過時間。不受本機時鐘調整影響，也不用多存欄位。
- 基準仍是原站的 `nowMs`，所以「伺服器時間」的意義不變，前端完全不用改。
- 回傳淺拷貝，不要改快取裡的 dict。同一筆快取會被多次命中，原地加會累加。`items` 陣列共用沒關係：唯一的呼叫端 `backend/api/pipi.py:123` 直接把結果交給 FastAPI 序列化，不修改內容。

不採用的做法：

- 存「原站時間減本機時間」的偏移，命中時用 `time.time()` 重算：本機時鐘一調就錯，monotonic 沒有這個問題。
- 前端自己補償：前端看不出回應是不是來自快取。
- 縮短或拿掉快取：`.claude/rules/pipi-mushroom.md` 規定節流（包含 `CACHE_TTL`）不能動。

## 測試

在 `tests/pipi/` 新增一支腳本，寫法比照 `test_cookie_header.py` / `test_api_cookie.py`。跑法是在 repo 根目錄執行 `.venv/Scripts/python.exe tests/pipi/<新檔>.py`。

- 不連網：把 client 的 `request` 換成假的，回傳固定 `nowMs` 的 items，並記錄呼叫次數。
- 控制時間：替換模組內的 `time.monotonic`。
- 驗證：
  - 第一次呼叫 `items()`：`now_ms` 等於假的 `nowMs`，`request` 被呼叫 1 次。
  - 同一個 bbox、經過 23 秒再呼叫：`request` 仍是 1 次（快取命中、沒有多打原站），`now_ms` 等於 `nowMs + 23000`，`items` 內容相同。
  - 再經過 2 秒（共 25 秒）呼叫：`now_ms` 等於 `nowMs + 25000`，不是 `+ 48000`。這條鎖住「不改快取裡的 dict」。
  - 超過 `CACHE_TTL` 後呼叫：`request` 變 2 次，`now_ms` 用新的 `nowMs`。
- Mutation check（逐條回報）：
  - 改回 `return hit[1]` → 「經過 23 秒」那條要紅。
  - 改成原地 `hit[1]["now_ms"] += age_ms` → 「共 25 秒」那條要紅。
- 測試不能讀寫 `~/.locwarp/settings.json`（見 rules 檔）。

## 驗收

- 上面的測試通過。既有的 `tests/pipi/` 三支、`tests/frontend/*.ts` 也照跑，全數回報。
- `docs/pipi-mushroom.md` 的 Throttling 段落，「30 s cache per viewport」補一句：命中時 `now_ms` 會加上快取存在的時間。
- 可選的人工確認：在同一個視窗 30 秒內按兩次「重新整理」，第二次開 popup 時倒數要接續第一次，不能倒退或停住。

## 不做

- 改 `CACHE_TTL`、`MIN_INTERVAL` 或任何節流。
- 改前端的時間推算。
- `region is None` 那條路徑本來就用 `time.time()`，不用動。
