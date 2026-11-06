# 01 裝置連線：WiFi 通道同時開，一台連不上不再拖住其他台；候選先試存過、而且這次有找到的 IP

Status: needs-triage
Blocked by: (none)
Type: bug
相關：`.scratch/wifi-scan-button/issues/01-wifi-scan-button.md`

## 為什麼

**WiFi 掃描**和**自動連線**（GLOSSARY）會同時送出好幾個 `start-and-connect`：`fillFreeSlots` 開「3 − 已連上台數」個名額，平行送出。但後端一次只處理一個。

- 原因：整個 `wifi_tunnel_start` 都包在 `_tunnels_lock` 裡（`backend/api/device.py:994`），握手逾時和重掃 Port 也在鎖裡。
- 結果：排在前面的候選連不上時，後面那台得等它失敗才開始。

2026-11-06 的實測（wifi-scan-button 01 真手機第 1 條，後端 log）：

| 時間 | 情境 | 後端處理 |
|---|---|---|
| 12:47 | 開啟 LocWarp，兩支手機的 WiFi 都關著 | `.197` 19.729 開始，26.914 回 500。`.117` 26.916 才開始，34.048 回 500。合計 14.3 秒，同時跑的話約 7 秒。 |
| 12:59 | A 開好 WiFi 後按 WiFi 掃描 | `.197`（另一支手機存過的 IP，那支的 WiFi 沒開）28.364 開始，35.477 回 500。`.117`（A，存過，這次子網掃描也有找到）35.478 才開始，35.958 通道建好，36.647 連上。A 白等了 7.1 秒。 |

- 一個連不上的存檔 IP 約要 7 秒：握手 1 秒逾時，加上重掃 Port 約 6 秒。
- 最壞的情況：排在前面的是子網掃描掃到、但不是 iPhone 的主機（例如開著 49152 的 PC），一台最多卡 45 秒（`TUNNEL_START_BUDGET`）。
- 這張就是 wifi-scan-button 01「不做」裡「縮短一次掃描的總時間」那條說好的「太慢再另開票」。
- 這把鎖是 upstream 原本的設計。改那張票之前，自動連線的註解寫著「平行送，不用依序等逾時」，其實也做不到。

前端的候選順序也有影響。現在是「存過的 IP 在前、偵測結果在後」，不看這次偵測有沒有找到：

- 後端改成同時開之前，候選順序就是處理順序。這次 A 就排在一個死掉的舊 IP 後面。
- 後端改好之後，順序還是會影響名額。失敗會佔住名額、不往下補（wifi-scan-button 01 的決定）。
  - 例如一台用 USB 連著時，名額只剩 2 個。如果排前面的兩個都是死掉的存檔 IP，真正在線上的手機這一輪就輪不到。

## 決定

### 後端：鎖只包住動到登錄表的地方

`wifi_tunnel_start` 拆成三段。

1. 開頭（上鎖，很短）：
   - 上限檢查改成：執行中的通道，加上握手中、還沒登錄的請求，合計 ≥ 3 就回 409。
     - 只算執行中的通道的話，3 個請求可以同時通過檢查，最後變成 4 條通道。
   - 「同一台已有通道就回 `already_running`」的判斷照舊。
   - 同一個 IP 已經有請求在握手時，等它結束，再重做這一段。它成功的話，這次就會走到 `already_running`。
     - 這跟現在的行為一樣：現在第二個請求排在鎖後面，拿到鎖時看到 `already_running`。差別只是不再連帶擋住其他 IP。
   - 登記這個請求握手中：記下 IP，佔一個名額。
2. 握手和重掃 Port（不上鎖）：
   - (Port × UDID) 的走法、每個候選 8 秒、45 秒的上限都不變。
   - 迴圈裡「這個 UDID 已有執行中的通道就跳過」照舊，只讀登錄表。
   - 「殘留的舊 entry 先收掉」（`device.py:1076`，`start_replace_stale`）會改登錄表。這一步要上鎖，並在鎖裡再確認一次它還是殘留的。
3. 結尾登錄（上鎖，很短）：
   - 如果這個 UDID 已經被同時進行的另一個請求登錄了（同一支手機有兩個 IP 時才可能發生）：收掉自己剛開的通道，回 `already_running`，帶對方的資訊。
   - 否則照現在的做法登錄 runner、開 watchdog（`device.py:1110`）。
   - 不管成功、失敗、丟例外或被取消，都在 `finally` 撤掉握手中的登記。

其他：

- 前例：watchdog 重連（`_attempt_tunnel_restart`，`device.py:676`）已經是這個寫法。它在鎖外握手，登錄時才上鎖，並再確認登錄表沒被改過。
- `start-and-connect` 開頭的上限預檢（`device.py:1300`）改用同一個計數。
- 其他用到這把鎖的地方本來就很短，不動：
  - `skip_connected` 收通道、re-key、失敗收通道
  - Stop Tunnel
  - watchdog
  - `disconnect_device`
- 要確認：`DeviceManager.connect_wifi_tunnel` 和 `create_engine_for_device` 兩台同時跑沒有問題。
  - `connect_wifi_tunnel` 只在寫 `_connections` 時拿自己的鎖，RSD 連線在鎖外。
  - 現在兩台的 connect 也可能重疊，只是比較少見。

### 前端：存過、而且這次偵測有找到的候選排最前面

- `wifiCandidates` 的順序改成三組：
  1. 存過，而且這次 mDNS 或子網掃描也找到同一個 IP：來源同時有 `saved` 和 `mdns` 或 `subnet`。
  2. 只有存過的。
  3. 只有偵測結果的，照偵測回傳的順序。
- 各組內部維持現在的順序：存過的依 `lastUsed` 從新到舊。
- 自動連線有釘選時不做偵測，第 1 組一定是空的，順序跟現在一樣。
- 這條取代 wifi-scan-button 01 的「候選不截斷，存過的 IP 排前面」，那張的候選規則和驗收都有這條。
  - 做完要回那張票補一行指到這裡，那張的測試也跟著改。

## 實作

- `backend/api/device.py`：
  - 握手中的請求用一個模組層級的登記表記，例如 `_tunnel_starts_in_flight: dict[str, asyncio.Future]`，用 IP 當 key。
  - 上限計數 = 執行中的通道數 + 登記表的筆數。
  - 同一個 IP 的第二個請求等那個 future 結束。
- `frontend/src/wifiCandidates.ts`：
  - `wifiCandidates` 最後依三組做穩定排序。
  - docstring 的「saved addresses first」跟著改。

## 驗收

- 後端測試：新檔 `tests/device/test_wifi_tunnel_parallel_start.py`。
  - 寫法比照 `tests/device/test_wifi_skip_connected.py`：模組層級的 assert，從 repo 根目錄用 `.venv/Scripts/python.exe` 執行。
  - `TunnelRunner` 換成假的，不碰網路和手機。假的 `start()` 依 IP 決定要等多久、成功還是失敗。
  - 要鎖住的情境：
    - 兩個不同的 IP 同時送，一個 0.5 秒後失敗，一個 0.1 秒後成功。
      - 成功的那個約 0.1 秒就回來，不用等失敗的那個。
      - 總時間約等於比較慢的那個，不是兩個相加。
      - 修之前要紅。
    - 上限：
      - 已有 2 條執行中的通道時，同時送 2 個不同的 IP：一個成功，一個回 409。
      - 一條通道都沒有時，同時送 4 個：3 個去握手，1 個回 409。
      - 兩種情況最後執行中的通道都不超過 3 條。
    - 同一個 IP 同時送兩次：
      - 只握手一次。
      - 第二個回 `already_running`。
      - 登錄表只有一條。
    - 握手失敗、丟例外或請求被取消之後，握手中的登記要撤掉，之後再送照樣能連，不會永遠佔著名額。
    - 兩個 IP 同時握手成功、解出同一個 UDID：只留一條通道，另一條被收掉。
    - 另一條通道正在握手時，Stop Tunnel 停一條既有的通道，不用等那個握手結束。
- 前端測試：`tests/frontend/test_wifi_candidates.ts`。
  - 新增排序測試：
    - A：存過，`lastUsed` 比較新，這次沒找到。
    - B：存過，這次子網掃描有找到。
    - C：只有 mDNS 找到。
    - 預期順序是 B、A、C。
  - 存過、這次 mDNS 找到的，也排在第 1 組。
  - 自動連線有釘選時，順序跟現在一樣。
  - 原本的「存過的 IP 排在偵測結果前面；候選不截斷…」改成新規則。
- mutation check，每個都要讓測試紅：
  - 後端：
    - 鎖改回包住整段。
    - 上限只算執行中的通道。
    - 拿掉同一個 IP 的等待。
    - 拿掉 `finally` 撤登記。
    - 登錄時不再確認 UDID。
  - 前端：
    - 拿掉排序。
    - 第 1 組只認 `subnet`、不認 `mdns`。
- 型別檢查、前端測試、Python 測試全過，0 skipped。`npm run build` 通過。
- 真手機實測（使用者做）：
  - 重做 wifi-scan-button 01 的第 1 條：另一支手機的 WiFi 關著，A 的開著，按 WiFi 掃描。
    - log 裡 A 的 `WiFi tunnel start` 要排在第一個；如果還是落在 `.197` 後面，兩者的時間差要在 1 秒內。
    - A 要在 `.197` 回 500 之前就連上。
  - 兩支手機的 WiFi 都開著、都沒連著，按 WiFi 掃描：
    - 兩支都連上。
    - 兩條 `WiFi tunnel started` 的時間很接近。
  - 一支手機正在跑路線時，另一支的連線成功或失敗都不影響它。做法同 wifi-scan-button 01 的第 2 條。

## 不做

- 縮短單一 IP 失敗要花的時間：握手 1 秒逾時、重掃 Port 約 6 秒、45 秒上限。
- 前端要等偵測結束才開始連線，所以存過的 IP 要多等偵測那幾秒。wifi-scan-button 01 也列為不做。
- watchdog 重連時的握手不佔名額。現在就是這樣（它的握手本來就在鎖外），跟這次等太久的問題無關。
- 「失敗不補位」的規則，那是 wifi-scan-button 01 的決定。

## 待決定（triage）

- 同一個 IP 同時送兩次時，第二個要怎麼處理：
  - 等前一個結束（建議）：跟現在的行為一樣。
  - 直接回 409：比較單純，但前端會多一筆失敗。
- 第 2、3 組的先後：
  - 「只有存過的」在前（建議）：只把第 1 組提前，改動最小。
  - mDNS 找到的排在「只有存過的」前面：mDNS 找到的一定是 iPhone；只有存過的 IP 連不上，最常見的原因是手機 WiFi 沒開。

## Comments

- 2026-11-06：開票，來源見「為什麼」，是 wifi-scan-button 01 真手機第 1 條的後端 log。
