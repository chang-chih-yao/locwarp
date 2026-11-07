# 01 裝置連線：「螢幕暗掉維持連線」在回復定位後不到 1 秒，又把假座標推回 WiFi 連線的手機

Status: needs-triage
Blocked by: (none)
Type: bug
相關：`.scratch/wifi-keepalive-restore/issues/02-disconnect-clear-traceback.md`。這張票的 bug 讓 02 號票的 traceback 在使用者以為已經回復定位時也會出現。

## 為什麼

用 WiFi 連線時，按「回復定位」只維持不到 1 秒，手機就又回到假座標。使用者會以為已經回到真實定位，其實沒有。

2026-11-07 使用者回報（`~/.locwarp/logs/backend.log`）：

| 時間 | 事件 |
|---|---|
| 11:40:53,057 | 按回復：`DVT simulated location cleared`、`Simulation fully restored` |
| 11:40:53,728 | 0.67 秒後 `DVT location set to (35.342085, 126.939898)`，跟回復前同一個座標 |
| 11:40:53 – 11:42:15 | 同一個座標又推了 65 次，約每 1.1 秒一次。中間除了一筆 WebSocket 斷線，沒有其他操作 |
| 11:42:15 之後 | 使用者關掉手機 WiFi。之後的連鎖反應見 02 號票 |

所有走 `engine.restore()` 的路徑都會受影響，因為它們都經過同一個 `RestoreHandler`：

- `POST /api/location/restore`（`backend/api/location.py:530`）
- `DELETE /api/location/simulation`（`backend/api/location.py:556`）
- `POST /api/phone/restore` 一次回復多台（`backend/api/phone_control.py:560`）
- 拉金盆（`backend/core/goldditto.py:37`）：
  - cycle 刻意不更新 `current_position`（`:23-28` 的註解）。
  - 所以回復後 keepalive 推回的是按拉金盆**之前**的位置，不是 A，也不是真實定位。
  - 這點是讀程式推的，沒有實機驗證。

這些路徑都只在 `connection_type == "Network"` 時出問題。USB 連線不跑 keepalive。

## 現況

下面的行號都是 `3ab24bc` 時的位置，開票時逐一對過。動手前以內容為準，先用 grep 再對一次。

- keepalive 迴圈：`backend/main.py:640` 的 `_wifi_tunnel_keepalive`。每秒對符合下面全部條件的裝置呼叫一次 `eng.location_service.set(pos.lat, pos.lng)`（`:673`）：
  - 開關打開（`app_state._wifi_keepalive_enabled`，預設 `True`，`main.py:84`）
  - `connection_type == "Network"`
  - 引擎狀態是 `IDLE` 或 `PAUSED`（`:667`）
  - `eng.current_position` 不是 `None`
- 回復：`backend/core/restore.py:19` 的 `RestoreHandler.restore`。
  - 停掉移動，呼叫 `location_service.clear()`，狀態設成 `IDLE`。
  - 刻意保留 `current_position`（`:39` 的註解：讓使用者不用重新傳送就能再出發）。
  - 回復完的狀態剛好符合 keepalive 的全部條件。
- 「停止」（`POST /api/location/stop`，保留假座標）和「回復」最後都是 `IDLE` 加上有 `current_position`，光看引擎狀態分不出來。
- 分得出來的是 location service 的 `_active`：
  - `set()` 成功後設成 `True`（`backend/services/location_service.py:195`、`:204`），`clear()` 成功後設成 `False`（`:218`、`:227`）。
  - `LegacyLocationService` 也一樣（`:275`、`:284`、`:304`、`:313`）。
  - 它是私有屬性，基底類別 `LocationService`（`:52`）沒有宣告。
- keepalive 現在也不管從來沒設過定位的連線（`current_position is None`）。這跟回復後一樣，都是「沒在模擬」，也一樣沒有流量。
- 歷史：
  - upstream v0.2.160（`c763d14`，#33）加的，當時間隔 20 秒。
  - docstring 的前提：導航中每輪都推座標，所以螢幕關掉時 tunnel 撐得住；閒置的 tunnel 幾秒內就斷。所以 keepalive 模仿導航的流量。
  - docstring 寫「The re-push doubles as keeping the fake location pinned」，顯然只考慮到「停止」，沒想到「回復」。
  - v0.2.173（`9c08529`）把間隔改成 1 秒，commit 訊息寫「閒置時也能維持螢幕關掉後的連線」，可見 20 秒不夠。
- UI 與文件：
  - 開關「螢幕暗掉維持連線(實驗)」，tooltip 寫「閒置時定期重送目前座標」（`frontend/src/i18n/strings.ts:326-330`）。
  - README `:123`、`:246` 也提到這個開關。
- 測試：`tests/` 下沒有測試涵蓋 `_wifi_tunnel_keepalive` 或 `RestoreHandler`（grep 過 `keepalive`、`RestoreHandler`、`.restore()`）。

## 定案

- 2026-11-07 使用者：**回復之後還要保住 WiFi 連線。**
  - 所以不能讓 keepalive 在回復後直接停。沒在模擬時，要改送不會改到定位的流量。

## 可能的做法

改法分兩部分：沒在模擬時送什麼，以及怎麼避免跟回復搶先後。

### 沒在模擬時送什麼

- A. 改送 DVT 的 `stopLocationSimulation`，也就是 pymobiledevice3 的 `LocationSimulation.clear()`：
  - 跟現在一樣走 DVT LocationSimulation 頻道、每秒一則，最接近 v0.2.173 實測有效的流量。
  - 不能直接呼叫 `DvtLocationService.clear()`，它在 `_active` 為 `False` 時直接返回（`:212`）。要另外開一個不看 `_active` 的方法。
  - 要實機確認：每秒送一次 `stopLocationSimulation` 對真實定位沒有副作用，例如定位跳動，或遊戲偵測到異常。
  - Network 連線也可能拿到 `LegacyLocationService`（DVT 失敗時會退回，見 `.scratch/device-dead-code/issues/06-create-dvt-location-service-name.md`）。這種情況送什麼要另外決定。
- B. pymobiledevice3 的 `HeartbeatService`（`pymobiledevice3/services/heartbeat.py`，RSD 上是 `com.apple.mobile.heartbeat.shim.remote`）：
  - 本來就是設計來維持連線的：手機送 `Marco`，我們回 `Polo`。
  - 節奏由手機決定，不一定做得到每秒一次。v0.2.173 的經驗是 20 秒不夠。
  - 每台裝置要開一個長駐 task，斷線時要收掉。
  - 目前沒有證據它能撐過螢幕關掉。backend 也還沒用過它。
- C. 調 tunnel TCP socket 的 keepalive：
  - 最底層，不用碰定位服務。
  - 但不知道 iOS 收掉的是 tunnel 本身，還是上面的 DVT 服務連線。如果是後者，這個做法沒用。

A 最接近已知有效的做法，先實機試 A。不行再試 B。

### 跟回復搶先後

- keepalive 先檢查條件，再 `await set()`。如果檢查完、還沒送出（或 set 還在 DTX 頻道上）時回復的 `clear()` 跑了，`set` 會晚到，假座標又回來。只在 keepalive 裡多檢查 `_active` 擋不住這種情況。
- 可能的做法：在 location service 加一個 keepalive 用的方法，跟 `set`/`clear` 共用同一把鎖，在鎖裡看 `_active` 決定送座標還是送 A/B 的流量。
  - 送座標時，要送 location service 最後一次 `set` 的座標，還是照舊送 `engine.current_position`，要另外決定。差別在拉金盆這種只推座標、不更新 `current_position` 的路徑。

## 待 triage 決定

- 沒在模擬時送什麼：A、B 還是 C。
- 從來沒設過定位的連線（`current_position is None`）要不要也送。
  - 定案只講回復後，但這跟回復後是同一種情況。現在它也撐不過螢幕關掉。
- 跟回復搶先後要怎麼處理；送座標時用哪個座標。
- 開關的 tooltip（`strings.ts:327-330`）和 README `:123` 寫「補送 / 重送目前座標」，改完後要跟著改。
- 驗收要求（草稿）：
  - 單元測試：
    - 回復後 keepalive 不再推座標。拿掉判斷要會紅。
    - 回復後 keepalive 還是有送 A/B/C 的流量。
    - 「停止」後 keepalive 照舊推座標（鎖住原本的用途）。
    - keepalive 的推送卡在半路時按回復，最後不是假座標。
  - 實機（WiFi）：
    - 傳送 → 回復 → 螢幕關掉一段時間（要決定多久）。tunnel 還在，手機是真實定位（用 Apple 地圖看）。
    - 拉金盆按完，手機是真實定位。
    - 每秒送 A 的流量時，真實定位沒有跳動。
- 定案後補「要改」、「驗收」、「不做」，再改成 `ready-for-agent`。實機驗證那部分要使用者做。

## Comments

- 2026-11-07：使用者回報「用 WiFi 連線、改完定位、回復定位後關手機 WiFi，terminal 出現 exception」。查 log 時發現這個 bug。
  - 回復時間和之後 65 次重推，是用 `awk` 把 `backend.log` 11:40:53 到 11:42:36 之間的紀錄撈出來對的。
  - 開票時對過：`main.py:640-681`、`restore.py:19-50`、`location_service.py` 裡所有 `_active`、`goldditto.py:22-38`、`c763d14` 的 diff、`9c08529` 的 commit 訊息、`strings.ts:326-330`。
  - 使用者同一天決定回復後還要保住 WiFi 連線（見「定案」）。
