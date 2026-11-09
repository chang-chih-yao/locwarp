# 01 裝置連線：WiFi 通道同時開，一台連不上不再拖住其他台；候選先試存過、而且這次有找到的 IP

Status: ready-for-human
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
   - 同一個 IP 已經有請求在握手時，等它結束，再重做這一段。它成功的話，這次就會走到 `already_running`。（triage 決定）
     - 這跟現在的行為一樣：現在第二個請求排在鎖後面，拿到鎖時看到 `already_running`。差別只是不再連帶擋住其他 IP。
   - 登記這個請求握手中：記下 IP，佔一個名額。
2. 握手和重掃 Port（不上鎖）：
   - (Port × UDID) 的走法、每個候選 8 秒、45 秒的上限都不變。
   - 迴圈裡「這個 UDID 已有執行中的通道就跳過」照舊，只讀登錄表。
   - 「殘留的舊 entry 先收掉」（`device.py:1076`，`start_replace_stale`）會改登錄表。這一步要上鎖，並在鎖裡再確認一次它還是殘留的。
3. 結尾登錄（上鎖，很短）：
   - 如果這個 UDID 已經被同時進行的另一個請求登錄了，而且那條通道在跑（同一支手機有兩個 IP 時才可能發生）：收掉自己剛開的通道，回 `already_running`，帶對方的資訊。
   - 如果這個 UDID 的 entry 還在、但那條通道已經停了（殘留）：跟第 2 段一樣先收掉，再登錄自己的。（triage 補）
   - 否則照現在的做法登錄 runner、開 watchdog（`device.py:1110`）。
   - 不管成功、失敗、丟例外或被取消，都在 `finally` 撤掉握手中的登記。
   - 這個請求開的 runner 最後沒登錄的話，一律要 stop，不留下沒人管的通道。（triage 補）有兩個空檔：
     - 握手中被取消：`TunnelRunner.start` 被取消時不會停掉自己的 task。這是既有的問題，現在也會發生。
     - 握手成功後、等第 3 段的鎖時被取消或出錯：這是拆成三段後新出現的空檔。現在握手成功後直接登錄，中間沒有 await。

其他：

- 前例：
  - watchdog 重連（`_attempt_tunnel_restart`，`device.py:676`）已經是這個寫法。它在鎖外握手，登錄時才上鎖，並再確認登錄表沒被改過。
  - pymobiledevice3 自己的 tunneld 也是每個 IP 開一個 task 同時建 WiFi 通道，並用 IP 和 UDID 去重（`.venv/Lib/site-packages/pymobiledevice3/tunneld/server.py` 的 `monitor_wifi_task`）。
- `start-and-connect` 開頭的上限預檢（`device.py:1300`）改用同一個計數。
- 其他用到這把鎖的地方本來就很短，不動：
  - `skip_connected` 收通道、re-key、失敗收通道
  - Stop Tunnel
  - watchdog
  - `disconnect_device`
- 要確認：`DeviceManager.connect_wifi_tunnel` 和 `create_engine_for_device` 兩台同時跑沒有問題。
  - `connect_wifi_tunnel` 只在寫 `_connections` 時拿自己的鎖，RSD 連線在鎖外。
  - 現在兩台的 connect 也可能重疊，只是比較少見。
- Windows 上每條通道都建一張 wintun 介面，名稱都是 `pymobiledevice3-tunnel`。好幾條同時存在現在就沒問題，但「同時建立」以前沒發生過，只能靠真手機實測確認（見驗收）。
  - 更正（2026-11-06 真手機第 1 條）：名稱帶 UDID，是 `pymobiledevice3-tunnel-<UDID>`（pymobiledevice3 11.49.5，`tunnel_service.py:758`），每台手機各一張，不同名。

### 前端：這次有找到的候選排前面

- `wifiCandidates` 的順序改成四組：（triage 決定）
  1. 存過，而且這次 mDNS 或子網掃描也找到同一個 IP：來源同時有 `saved` 和 `mdns` 或 `subnet`。
  2. 沒存過、只有 mDNS 找到。
  3. 只有存過的，這次沒找到。
  4. 沒存過、只有子網掃描找到。
- 理由：
  - mDNS 找到的一定是這次在 WiFi 上的 iPhone。只有存過的 IP 連不上，最常見的原因是手機 WiFi 沒開。
  - 手機換了 IP（DHCP 換了，或在這個網段第一次連）時，只會出現在 mDNS 結果裡。排在死掉的存檔 IP 後面的話，名額不夠時這一輪就輪不到。
  - mDNS 找到、但沒跟這台電腦配對過的 iPhone 會失敗，代價跟死掉的存檔 IP 差不多：約 7 秒，佔一個名額。
  - 子網掃描找到的可能不是 iPhone，最多卡 45 秒，所以排最後。
- 後端只在 mDNS 沒結果時才掃子網，所以同一次偵測裡第 2 組和第 4 組不會同時有東西。排序規則不靠這一點。
- 各組內部維持現在的順序：存過的（第 1、3 組）依 `lastUsed` 從新到舊；偵測結果（第 2、4 組）照偵測回傳的順序。
- 自動連線有釘選時不做偵測，只會有第 3 組，順序跟現在一樣。
- 這條取代 wifi-scan-button 01 的「候選不截斷，存過的 IP 排前面」，那張的候選規則和驗收都有這條。
  - 做完要回那張票補一行指到這裡，那張的測試也跟著改。

## 實作

- `backend/api/device.py`：
  - 握手中的請求用一個模組層級的登記表記，例如 `_tunnel_starts_in_flight: dict[str, asyncio.Future]`，用 IP 當 key。
  - 上限計數 = 執行中的通道數 + 登記表的筆數。
  - 同一個 IP 的第二個請求等那個 future 結束。
- `backend/core/wifi_tunnel.py` 或呼叫端：`TunnelRunner.start` 被取消時，它開的 task 要停掉。修在哪一層由實作決定，但兩個空檔都要有測試。
- `frontend/src/wifiCandidates.ts`：
  - `wifiCandidates` 最後依四組做穩定排序。
  - docstring 的「saved addresses first」跟著改。

## 驗收

- 後端測試：新檔 `tests/device/test_wifi_tunnel_parallel_start.py`。
  - 寫法比照 `tests/device/test_wifi_skip_connected.py`：模組層級的 assert，從 repo 根目錄用 `.venv/Scripts/python.exe` 執行。
  - `TunnelRunner` 換成假的，不碰網路和手機。假的 `start()` 依 IP 決定要等多久、成功還是失敗。
  - 要鎖住的情境：
    - 兩個不同的 IP 同時送：
      - 一個 0.5 秒後失敗、一個 0.1 秒後成功：成功的那個在 0.3 秒內回來（修之前約 0.6 秒）。
      - 兩個都等 0.5 秒：總時間少於 0.8 秒（修之前約 1.0 秒）。
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
    - 握手成功、等登錄的鎖時被取消：剛開的 runner 被 stop，登錄表裡沒有它。
    - 握手中被取消：`TunnelRunner.start` 開的 task 停掉了。這條要用真的 `TunnelRunner` 加假的 RemotePairing connect，比照 `tests/device/test_wifi_tunnel_runner.py`。
    - 兩個 IP 同時握手成功、解出同一個 UDID：只留一條通道，另一條被收掉。
    - 握手中有人在登錄表放了同一個 UDID 的殘留 entry（通道已停）：殘留的被收掉，換成新的那條，回 `started`。
    - 另一條通道正在握手時，Stop Tunnel 停一條既有的通道，不用等那個握手結束。
- 前端測試：`tests/frontend/test_wifi_candidates.ts`。
  - 新增排序測試：
    - mDNS 的情況：
      - A：存過，`lastUsed` 比較新，這次沒找到。
      - B：存過，這次 mDNS 也找到。
      - C：沒存過，只有 mDNS 找到。
      - 預期順序是 B、C、A。
    - 子網掃描的情況：
      - A：存過，`lastUsed` 比較新，這次沒找到。
      - B：存過，這次子網掃描也找到。
      - D：沒存過，只有子網掃描找到。
      - 預期順序是 B、A、D。
    - 自動連線有釘選時，順序跟現在一樣。
  - 既有測試裡有「只有存過的」和「只有 mDNS」兩種候選的，預期順序會變，只改預期順序，不改測試鎖的東西：
    - 「WiFi 掃描不受釘選限制」
    - 「自動連線沒有釘選時會用偵測結果」
    - 「IP 等於某條 WiFi 通道的手機 IP 就跳過」
    - 「存過的 IP 排在偵測結果前面；候選不截斷…」：名稱也改成新規則，「候選不截斷」照樣鎖住。
- mutation check，每個都要讓測試紅：
  - 後端：
    - 鎖改回包住整段。
    - 上限只算執行中的通道。
    - 拿掉同一個 IP 的等待。
    - 拿掉 `finally` 撤登記。
    - 登錄時不再確認 UDID。
    - 拿掉「沒登錄的 runner 要 stop」。
    - 第 3 段把殘留的 entry 當成在跑。
  - 前端：
    - 拿掉排序。
    - 第 1 組只認 `subnet`、不認 `mdns`。
    - 第 2、3 組對調：只有存過的排在只有 mDNS 的前面。
    - 只有子網掃描的跟只有 mDNS 的同一組，都排在只有存過的前面。
- 型別檢查、前端測試、Python 測試全過，0 skipped。`npm run build` 通過。
- 真手機實測（使用者做）：
  - 重做 wifi-scan-button 01 的第 1 條：另一支手機的 WiFi 關著，A 的開著，按 WiFi 掃描。
    - log 裡 A 的 `WiFi tunnel start` 要排在第一個；如果還是落在 `.197` 後面，兩者的時間差要在 1 秒內。
    - A 要在 `.197` 回 500 之前就連上。
  - 兩支手機的 WiFi 都開著、都沒連著，按 WiFi 掃描：
    - 兩支都連上。
    - 兩條 `WiFi tunnel established` 的時間很接近，RSD 位址不同。介面名稱都是 `pymobiledevice3-tunnel`，不能拿來分辨。
      - 更正：介面名稱是 `pymobiledevice3-tunnel-<UDID>`，兩條的 `iface=` 也會不同，可以一起拿來分辨。
    - 連上後兩支都瞬移一次，位置都有變：同時建的兩張 wintun 介面都能用。
  - 一支手機正在跑路線時，另一支的連線成功或失敗都不影響它。做法同 wifi-scan-button 01 的第 2 條。

## 不做

- 縮短單一 IP 失敗要花的時間：握手 1 秒逾時、重掃 Port 約 6 秒、45 秒上限。
- 前端要等偵測結束才開始連線，所以存過的 IP 要多等偵測那幾秒。wifi-scan-button 01 也列為不做。
- watchdog 重連時的握手不佔名額。現在就是這樣（它的握手本來就在鎖外），跟這次等太久的問題無關。
- 「失敗不補位」的規則，那是 wifi-scan-button 01 的決定。
- 同一個 UDID 被兩個請求同時 `connect_wifi_tunnel`。（triage 補）
  - 情況：同一個 IP 送兩次，或同一支手機有兩個 IP 時，第二個請求拿到 `already_running` 後，可能跟第一個請求同時對同一個 UDID 連線。`connect_wifi_tunnel` 遇到已連上的 UDID 會先斷線，兩邊可能互相斷掉、重建模擬引擎。
  - 現在就會發生：鎖在 `connect_wifi_tunnel` 之前就放掉了。這次的改動不會讓它變糟，只記在這裡。
- 掃描或自動連線進行中時，停用 WiFi 面板的「Start WiFi Tunnel」。（triage 時使用者問起）
  - 同一個 IP 同時送兩次，還有其他來源：釘選裝置斷線後每 15 秒的重試、重新整理頁面時上一個請求還在跑、開了兩個分頁。停用按鈕擋不完，後端反正要處理。
  - 要不要停用是另一個介面上的選擇，需要時另開票。

## 已決定（2026-11-06 triage）

- 同一個 IP 同時送兩次：第二個等前一個結束，再重做開頭那段。
  - 跟現在的行為一樣。前端一個 IP 只送一次，會重複的來源見「不做」最後一條，前端擋不完。
- 候選順序：mDNS 找到的排在「只有存過的」前面，子網掃描找到的排最後。理由見「前端」一節。
- triage 另外補的四點，使用者同意全補：
  - 沒登錄的 runner 一律 stop（後端第 3 段）。
  - 第 3 段遇到殘留的 entry 先收掉再登錄（後端第 3 段）。
  - 真手機實測加「同時建兩條通道」，用 RSD 位址分辨（驗收）。
  - 同一個 UDID 被同時 `connect_wifi_tunnel` 的既有競爭只記下、不修（不做）。

## Comments

- 2026-11-06：開票，來源見「為什麼」，是 wifi-scan-button 01 真手機第 1 條的後端 log。

> *This was generated by AI during triage.*

2026-11-06 triage：狀態從 needs-triage 改為 ready-for-agent，類別維持 bug。下面的 brief 是實作依據，上面的內文是背景。

- 重現：寫了一支腳本，把 `TunnelRunner` 換成假的、不碰網路，同時送兩個 IP（`.197` 0.5 秒後失敗、`.117` 0.1 秒後成功）。`.117` 在 0.51 秒、`.197` 回 500 之後才開始，0.61 秒才回來，跟 12:59 的 log 一樣是排隊。
- 前端：`wifiCandidates` 只依「存過的在前、偵測結果在後」排，存過的依 `lastUsed`，不看這次偵測有沒有找到，跟 12:59 的順序一致。
- 重複實作：搜過 `device.py` 的鎖與登記表、`start-and-connect` 的上限預檢、watchdog，沒有現成的平行啟動。鎖外握手只有 watchdog 重連。
- 先前否決：沒有 `.out-of-scope/`。也沒有 `docs/adr/`，沒有 ADR 衝突。
- 決定與補充：見「已決定」。

### Agent Brief

**類別：** bug

**摘要：** 後端同時處理不同 IP 的 WiFi 通道啟動，一個 IP 連不上不再擋住其他 IP；前端候選改成「這次有找到的」優先。

**現況：**
- WiFi 掃描與自動連線會在名額內同時送出好幾個 `POST /wifi/tunnel/start-and-connect`。但 `wifi_tunnel_start` 從上限檢查、握手到重掃 Port 全程拿著 `_tunnels_lock`，後端一次只處理一個 IP。
  - 一個連不上的存檔 IP 約 7 秒才失敗，排在它後面的、在線上的手機只能等。子網掃描掃到的非 iPhone 主機最多卡 45 秒（`TUNNEL_START_BUDGET`）。
- `wifiCandidates()` 回傳的順序是存過的 IP（依 `lastUsed` 從新到舊）在前、偵測結果在後，不看這次偵測有沒有找到。
- 失敗會佔住名額到這一輪結束（`fillFreeSlots`），所以名額不夠時，死掉的存檔 IP 排前面會讓在線上的手機這一輪輪不到。

**期望行為：**

後端，`wifi_tunnel_start`：
- 只有讀寫登錄表（`_tunnels`、`_tunnel_watchdogs`，以及新的「握手中」登記）時才拿 `_tunnels_lock`，而且拿得很短。握手、等逾時、重掃 Port 都不拿鎖。不同 IP 的請求同時進行，互不等待。
- 上限：執行中的通道數加上握手中、還沒登錄的請求數，合計達到 `MAX_DEVICES` 就回 409 `max_devices_reached`。
  - `start-and-connect` 開頭的預檢也用這個計數。
  - watchdog 重連的握手不算在內，維持現狀。
- 同一個 IP 已有請求在握手時，新的請求等它結束，再從頭做一次開頭的檢查。前一個成功就回 `already_running`，失敗就自己握手。不同 IP 不受影響。
- 開頭的「這個 IP／Port 已有執行中的通道就回 `already_running`」、握手迴圈的「這個 UDID 已有執行中的通道就跳過」、「殘留的 entry 先收掉」都照舊。
  - 收殘留 entry 會改登錄表，要在鎖裡做，並在鎖裡再確認它還是殘留的。
- 握手成功後，在鎖裡登錄：
  - 同一個 UDID 已被另一個同時進行的請求登錄、而且那條通道在跑：停掉自己剛開的通道，回 `already_running`，帶那條通道的 `udid`、`port` 與 RSD 資訊。
  - 同一個 UDID 的 entry 還在、但通道已停（殘留）：先收掉，再登錄自己的。
  - 其他情況照現在的做法登錄 runner、啟動 `_per_tunnel_watchdog`，回 `started`。
- 不管成功、失敗、丟例外或被取消，「握手中」的登記都要撤掉。名額不能被永遠佔著，同一個 IP 在等的請求也要被喚醒。
- 這個請求開的 `TunnelRunner` 最後沒有登錄的話，一律要停掉。有兩個空檔都要處理：
  - 在 `TunnelRunner.start()` 等握手時被取消：`start()` 現在被取消時不會停掉自己開的 task。這個 task 要停掉，修在 `TunnelRunner` 或呼叫端都可以。
  - 握手成功後、等登錄的鎖時被取消或出錯：這是拆段後新出現的空檔。
- 回應的形狀、HTTP 狀態碼、錯誤碼（`tunnel_timeout`、`tunnel_spawn_failed`、`max_devices_reached`）、(Port × UDID) 的走法、每個候選 8 秒、45 秒上限都不變。
- 前例：watchdog 重連（`_attempt_tunnel_restart`）就是鎖外握手、登錄時才上鎖並再確認登錄表，照這個寫法。

前端，`wifiCandidates()`：
- 回傳的候選依四組做穩定排序：
  1. 來源有 `saved`，也有 `mdns` 或 `subnet`。
  2. 來源有 `mdns`，沒有 `saved`。
  3. 來源只有 `saved`。
  4. 來源只有 `subnet`。
- 各組內部維持原本的相對順序：存過的依 `lastUsed` 從新到舊，偵測結果照偵測回傳的順序。
- 其他規則都不變：跳過已連上的 UDID、跳過通道手機 IP、每個 UDID 一個候選、同一個 IP 合併、不截斷、自動連線有釘選時只用釘選裝置存過的 IP。
- 自動連線有釘選時只會有第 3 組，順序跟現在一樣。

**關鍵介面：**
- `wifi_tunnel_start(req: WifiTunnelStartRequest) -> dict`：簽名與回傳形狀不變，只改並行行為。
- 新的模組層級「握手中」登記，例如 `_tunnel_starts_in_flight: dict[str, asyncio.Future]`，用 IP 當 key。值要能讓同一個 IP 的後續請求等待。
- 上限計數：抽成一個 helper，讓 `wifi_tunnel_start` 和 `wifi_tunnel_start_and_connect` 的預檢共用。`MAX_DEVICES` 不變。
- `TunnelRunner.start(udid, ip, port, timeout) -> dict`：被取消時不能留下還在跑的 task。
- `wifiCandidates(input: CandidateInput): WifiCandidate[]`：簽名不變，只改順序。docstring 的 "saved addresses first" 改成新規則。`fillFreeSlots`、`tallyWifiResults` 不動。

**測試寫法：**
- 後端：新增 `test_wifi_tunnel_parallel_start.py`，跟 `test_wifi_skip_connected.py` 放同一個目錄、寫法相同：模組層級的 assert，從 repo 根目錄用 `.venv/Scripts/python.exe` 執行。
  - 把模組裡的 `TunnelRunner` 換成假的：`start()` 依 IP 決定等多久、成功還是失敗，`stop()` 記下被呼叫；`task` 設 `None`，watchdog 會立刻結束。
  - 把 `_scan_ports_for_ip` 換成立刻回 `[]` 的假函式。把 `_build_tunnel_udid_candidates` 換成固定的清單，不讀 `~/.pymobiledevice3/` 裡真的配對記錄。
  - Stop Tunnel 會用到 `dm` 和 `app_state`：比照 `test_wifi_skip_connected.py` 的假 `main` 模組，假的 `dm` 至少要有 `_connections` 和 `discover_devices`。
  - 每個情境開始前清空 `_tunnels`、`_tunnel_watchdogs` 和握手中登記。
  - 時間用寬鬆的門檻，例如 0.3 秒、0.8 秒，不要比到毫秒。
  - 先在還沒改的程式碼上跑一次，確認平行那幾條是紅的。
- 「`TunnelRunner.start()` 被取消」這條要用真的 `TunnelRunner`：比照 `test_wifi_tunnel_runner.py`，把 pymobiledevice3 的 RemotePairing connect 換成一直等的假函式，取消後確認 task 已經結束。
- 前端：在 `tests/frontend/test_wifi_candidates.ts` 加排序測試。

**驗收條件：**
- [x] 後端新測試通過，涵蓋：
  - [x] 兩個不同 IP 同時送，一個 0.5 秒後失敗、一個 0.1 秒後成功：成功的在 0.3 秒內回來。兩個都等 0.5 秒：總時間少於 0.8 秒。這兩條在改之前是紅的。
  - [x] 已有 2 條執行中的通道，同時送 2 個不同 IP：一個 `started`、一個 409。沒有通道時同時送 4 個：3 個去握手、1 個 409。兩種情況最後執行中的通道都不超過 3 條。
  - [x] 同一個 IP 同時送兩次：假的 `start()` 只被呼叫一次，第二個回 `already_running`，登錄表只有一條。
  - [x] 握手失敗、丟例外、請求被取消之後，握手中的登記都撤掉了，之後再送照樣能連上。
  - [x] 握手成功、等登錄的鎖時被取消（測試先拿住 `_tunnels_lock` 再取消請求）：剛開的 runner 被 `stop()`，登錄表沒有它。
  - [x] 兩個 IP 同時握手成功、解出同一個 UDID：只留一條，另一條被 `stop()`，晚到的回 `already_running`。
  - [x] 握手中有人在登錄表放了同一個 UDID 的殘留 entry（`is_running()` 為 False）：殘留的被收掉，新的那條登錄，回 `started`。
  - [x] 另一個 IP 在握手（假的 `start()` 等 1 秒）時，對既有通道呼叫 Stop Tunnel：在 0.3 秒內回來。
- [x] `TunnelRunner.start()` 等握手時被取消：它開的 task 結束了，沒有留下還在跑的通道，也沒有「Task exception was never retrieved」。
- [x] 前端新測試通過：
  - [x] A 存過、`lastUsed` 較新、這次沒找到；B 存過、這次 mDNS 也找到；C 只有 mDNS 找到：順序 B、C、A。
  - [x] A 同上；B 存過、這次子網掃描也找到；D 只有子網掃描找到：順序 B、A、D。
  - [x] 自動連線有釘選時，順序跟現在一樣。
- [x] 既有前端測試裡同時有「只有存過的」和「只有 mDNS」候選的那幾條，只改預期順序，不改它們鎖的東西。原本的「存過的 IP 排在偵測結果前面」那條改名成新規則，「候選不截斷」照樣鎖住。
- [x] Mutation check 逐條回報，每一個都讓測試變紅，全部還原後全綠：
  - [x] 後端：鎖改回包住整段。
  - [x] 後端：上限只算執行中的通道。
  - [x] 後端：拿掉同一個 IP 的等待。
  - [x] 後端：拿掉 `finally` 撤登記。
  - [x] 後端：登錄時不再確認 UDID。
  - [x] 後端：拿掉「沒登錄的 runner 要 stop」。
  - [x] 後端：登錄時把殘留的 entry 當成在跑。
  - [x] 前端：拿掉排序。
  - [x] 前端：第 1 組只認 `subnet`、不認 `mdns`。
  - [x] 前端：第 2、3 組對調。
  - [x] 前端：只有子網掃描的跟只有 mDNS 的同一組，都排在只有存過的前面。
- [x] 既有測試全部照跑，結果逐一回報，沒跑的要明說：`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"`、`tests/device/` 與 `tests/pipi/` 的 Python 腳本、`node tests/pipi/test_extension.js`、`npm run build`。0 skipped。
- [x] 回 wifi-scan-button 01 號票補一行：它的「候選不截斷，存過的 IP 排前面」已被這張取代，並指到這裡。
- [ ] 真手機實測留給使用者，回報時列為「沒做」，項目見內文「驗收」的真手機實測：
  - 重做 wifi-scan-button 01 的第 1 條。
  - 兩支同時連：兩條 `WiFi tunnel established` 的 RSD 位址不同，兩支都能瞬移。
  - 跑路線中的手機不受另一支影響。

**不做：**
- 縮短單一 IP 失敗的時間：握手逾時、重掃 Port、45 秒上限、每個候選 8 秒。
- 前端偵測結束前不先送存過的 IP。
- 讓 watchdog 重連的握手佔名額。
- 改「失敗不補位」的規則。
- 同一個 UDID 被兩個請求同時 `connect_wifi_tunnel` 的既有競爭：只記在票上，不修。
- 掃描或自動連線進行中時停用 WiFi 面板的「Start WiFi Tunnel」按鈕。
- `start-and-connect` 在 `wifi_tunnel_start` 之後的流程（`skip_connected`、re-key、失敗收通道），只換開頭預檢的計數。

---

- 2026-11-06：實作完成。Status 從 ready-for-agent 改成 ready-for-human：程式碼與測試做完了，真手機實測還沒做。實測完再改成 resolved。
  - 後端 `backend/api/device.py`：
    - `wifi_tunnel_start` 拆成三段。第 1 段在鎖裡：同一個 IP 已在握手就等它結束再重來、上限檢查、`already_running` 判斷、登記握手中。第 2 段 `_walk_tunnel_candidates` 不拿鎖。第 3 段 `_register_started_tunnel` 在鎖裡登錄。`finally` 撤掉握手中的登記，並喚醒同一個 IP 在等的請求。
    - 握手中的登記是 `_tunnel_starts_in_flight: dict[str, asyncio.Event]`。用 Event 不用 Future：等待的請求被取消時，Future 會跟著被取消，其他等待者會一起醒來拿到 CancelledError。
    - 上限計數抽成 `_tunnel_slots_in_use()`，`start-and-connect` 的預檢也改用它。
    - 第 3 段遇到同一個 UDID：
      - 那條在跑：收掉自己的，回 `already_running`。
      - 那條是殘留：先收掉殘留的，再登錄自己的。
      - 沒登錄的 runner 在 `finally` 一律 stop。
    - 第 2 段收殘留的 entry 時，在鎖裡再確認一次。等鎖期間如果被換成在跑的通道，就跳過這個候選，跟迴圈開頭的「在跑就跳過」一致。這是 review 後加的。
    - `already_running` 的回應抽成 `_already_running()`，第 1 段和第 3 段共用。
  - `backend/core/wifi_tunnel.py`：`TunnelRunner.start()` 等握手時被取消，會先 cancel 並 await 它開的 task，再往上拋。
  - 前端 `frontend/src/wifiCandidates.ts`：`tryRank()` 依四組回傳 0～3，`wifiCandidates` 最後做穩定排序。docstring 改成新規則。
  - 測試：
    - 新檔 `tests/device/test_wifi_tunnel_parallel_start.py`，13 組情境：
      - 驗收列的 9 條。
      - review 後補的 3 條：同一個 IP 送兩次且前一個失敗時，第二個自己握手；握手前就有的殘留 entry 會被收掉；等鎖期間殘留 entry 被換成在跑的通道時，不收掉、跳過。
      - 第 1、2 條和 Stop Tunnel 那條（第 13 條），在改之前的程式碼上是紅的：0.62 秒、1.03 秒、0.95 秒。
    - 「`TunnelRunner.start()` 握手中被取消」那條，放在既有的 `tests/device/test_wifi_tunnel_runner.py`，不在新檔。那支本來就是真的 runner 加假的 RemotePairing connect，驗收要的就是這個寫法。改之前是紅的。
    - 「丟例外」的情境用 `TunnelRunner()` 建構時丟 `RuntimeError` 模擬。`start()` 丟出的 `Exception` 都會被握手迴圈接住，變成 500。
    - `tests/frontend/test_wifi_candidates.ts`：
      - 加 3 條排序測試。
      - 既有 4 條只改預期順序。原本的「存過的 IP 排在偵測結果前面」改名成「只有 mDNS 找到的排在只有存過的 IP 前面；候選不截斷…」。
      - 釘選那條改之前就是綠的：有釘選時本來就只有第 3 組。
  - Mutation 14 種都讓測試變紅，還原後全綠：
    - 驗收列的 11 種。
    - `TunnelRunner.start` 被取消時不收 task。
    - review 後加的 2 種：第 2 段拿掉鎖和重查；重查到在跑的照樣去握手。
    - 「拿掉 `finally` 撤登記」先在同一個 IP 送兩次那條逾時變紅，第 7 條的 `left == {}` 也鎖著它。
  - 測試結果：
    - 型別檢查通過。
    - 前端 95/95，0 skipped。
    - `tests/device/` 3 支、`tests/pipi/` 4 支 `test_*.py`、`node tests/pipi/test_extension.js`、`npm run build` 都過。
    - `tests/pipi/check_live_anonymous.py` 會打真的網站，沒有跑。
  - 確認「兩台同時 `connect_wifi_tunnel`、`create_engine_for_device`」：讀程式碼，沒有問題，沒有實測。
    - `_connections` 在 `dm._lock` 裡寫入，只會 disconnect 同一個 UDID。
    - 模擬引擎和 location service 都是一台一個。
    - `_primary_udid` 的判斷和設定之間沒有 await。
    - `reconnect_manager` 會被後建的那台覆蓋，跟依序連線時一樣。
  - Code review（Standards、Spec 兩軸）：
    - 採納的都在上面：補 3 條測試、第 2 段重查後跳過、抽出 `_already_running`、`_register_started_tunnel` 拿掉多餘的 `port` 參數、`tryGroup` 改名 `tryRank`（避開「群組模式」）、測試註解的路徑補上檔名。
    - 沒採納：`TunnelRunner.start` 的取消分支不跟逾時分支合併。逾時走 stop event 加 2 秒的溫和收尾，取消要立刻 cancel。
  - 記下、沒修：
    - 本文寫「它成功的話，這次就會走到 `already_running`」，但已有 2 條通道時，同一個 IP 同時送兩次，第二個會回 409。
      - 原因：上限檢查排在 `already_running` 判斷前面，第一個成功後就滿 3 條。
      - 改之前也一樣：已有 3 條通道時，對其中一條再送一次會回 409。「判斷照舊」就維持這個順序。
      - 自動連線和 WiFi 掃描走不到這條：前端會跳過通道手機的 IP。要改順序的話另開票。
    - `start-and-connect` 在 `connect_wifi_tunnel` 之前用 `len(dm._connections)` 檢查上限，這個檢查跟 connect 之間不是原子的。
      - 通道的上限不算 USB 裝置。所以 1 台 USB 加 3 個同時送的 WiFi 請求，可能都通過檢查，最後連上 4 台。
      - 改之前也有這個空檔，只是握手一個接一個，比較難碰到。
      - 前端 `fillFreeSlots` 同時送出的數量不超過「3 − 已連上台數」，自動連線和 WiFi 掃描碰不到。要碰到，得手動連線跟掃描同時進行。
  - 沒做：真手機實測的三條（見驗收），留給使用者。
- 2026-11-06：真手機實測第 1 條（重做 wifi-scan-button 01 的第 1 條）通過，使用者做的，下面是後端 log。
  - 情境：另一支手機（`.197`）的 WiFi 關著，A（`.117`）的開著，按 WiFi 掃描。
  - 偵測：mDNS 沒結果，子網掃描找到 1 台（`.117`）。
    - A 是「存過、這次也找到」，排第 1 組，Port `[49152, 56165]`，存過的在前。
    - `.197` 只有存過，排第 3 組。
  - 兩個請求同時開始：A 的 `WiFi tunnel start` 在 21:36:27.665，排第一個；`.197` 在 27.666，只差 1 ms。
  - A 在 28.305 建好通道，`start-and-connect` 在 29.33 回 200，從送出到連上約 1.7 秒。
  - `.197`：28.668 握手逾時，重掃 Port 到 34.729，然後回 500。
  - A 比 `.197` 回 500 早約 5.4 秒連上。12:59 那次 A 白等了 7.1 秒，這次沒等。
  - 順便發現介面名稱是 `pymobiledevice3-tunnel-<UDID>`，不是本文寫的 `pymobiledevice3-tunnel`。log：`iface=pymobiledevice3-tunnel-00008140-001A1DE13813C01C`。已在「決定」和「驗收」的對應段落補更正。
  - 第 2、3 條還沒做。
- 2026-11-07：刪 LocWarp 的 iOS 16 支援時，`backend/api/device.py` 開頭拿掉了一段 iOS <17 的註解，跟 `900e80d` 比，`:17` 之後往上移 3 行。這張記的行號是開票時的位置，本來就可能跟 `900e80d` 對不上，動手前以內容為準。

  > *This was generated by AI during triage.*
- 2026-11-08：「記下、沒修」和「不做」裡的 4 條，各開成一張票，都是 needs-triage：
  - 同一個 IP 送兩次，第二個回 409（`:361-364`）：`02-same-ip-409-at-cap.md`。
  - `start-and-connect` 檢查裝置上限時沒有鎖（`:365-368`）：`03-device-cap-check-not-atomic.md`。
  - 同一個 UDID 被兩個請求同時 `connect_wifi_tunnel`（`:179-181`）：`04-same-udid-concurrent-connect.md`。
  - 掃描或自動連線時停用「Start WiFi Tunnel」（`:182-184`）：`05-disable-start-tunnel-during-scan.md`。
