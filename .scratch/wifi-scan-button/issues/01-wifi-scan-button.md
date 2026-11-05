# 01 裝置連線：新增「掃描 WiFi 裝置」按鈕，自動連線改成逐台跳過已連上的裝置

Status: ready-for-agent
Blocked by: (none)
Type: feature

## 為什麼

使用者手機 WiFi 還沒開就先開啟 LocWarp，畫面上沒找到 iPhone。接著打開手機 WiFi，什麼都沒按、等它自己連（Q1），結果一直沒連上。手機先開好 WiFi 再開啟 LocWarp 就沒問題。

現況的原因：

- **自動連線**（GLOSSARY）每載入一次頁面只跑一次：前端第一次連上後端 WebSocket，1.5 秒後跑。那時手機 WiFi 沒開，存過的 IP、mDNS、子網掃描都找不到，於是不出聲地結束，之後也不會再跑。
- 沒有任何東西會再去找 iPhone。後端的 per-tunnel watchdog 只看護已經建好的 **WiFi 通道**（GLOSSARY）；一條都沒建起來，就沒有 watchdog。
- 現有按鈕都補救不了：「掃描 USB 裝置」只找 USB；「**自動偵測**」（GLOSSARY）只把 IP 與 Port 填進欄位，不會連線。

群組使用時更常遇到：幾台手機要一起連，有人忘了開 WiFi，需要能補連。

追查時另外發現兩個既有 bug（review 1）：

- 自動連線開頭「已經有裝置連上就整個跳過」的檢查從來沒有生效。
  - 原因：它在 1.5 秒的計時器裡讀 `device.connectedDevices`，但 effect 的 deps 只有 `[ws.connected]`，讀到的是 WebSocket 剛連上那次 render 的值。那時 `devices` 還是初始的 `[]`，所以自動連線每次載入頁面都會跑。
  - 另一個「已有通道就跳過」的比對（`alreadyTunneled`）也沒有作用：它拿 WiFi 通道的 RSD 位址去比手機的區網 IP，永遠比不到。
- 結果有兩個問題：
  - 重新整理頁面時，後端還留著通道，自動連線會打到 `already_running`，接著照樣呼叫 `connect_wifi_tunnel`、把模擬引擎丟掉重建。正在跑的路線會中斷。
  - 從程式碼推論、沒有實測：手機用 USB 連著、這個網段又存過它的 IP 時，開啟 LocWarp 可能把它切成 WiFi。原因是 `connect_wifi_tunnel` 遇到已連上的 UDID 會先 disconnect。

## 決定

2026-11-06 grilling 的 Q1～Q14 都照建議，同一天依另一個 session 的 review 修訂（見 Comments）。Q11 決定的就是這張票本身：只開一張票，不另寫 `spec.md`。

### 行為

- 不做背景定期重試，改成讓使用者自己按按鈕補連。（Q2）
- 新按鈕執行 **WiFi 掃描**（GLOSSARY）。（Q4）
  - 找法跟自動連線相同：先試這個網段存過的 IP，再用 mDNS，mDNS 沒結果才掃子網。
  - 找到的 iPhone 只要還沒連上就直接連，不列清單讓使用者挑。
  - 已經連上的裝置不動。連上的總數最多補到 3 台。
- 自動連線跟 WiFi 掃描用同一套「逐台跳過已連上的裝置」規則，不再「只要有一台連上就整個跳過」。（Q12）
  - 群組使用者現在實際的體驗不倒退：A 用 USB 連著時，B、C 開啟 LocWarp 時照樣自動連上。
  - 順便修好上面兩個問題：重新整理頁面會中斷路線、USB 連著的手機會被切成 WiFi。
- 釘選：（Q5）
  - WiFi 掃描不受釘選限制。理由是按按鈕是使用者明確的意思，釘選只管「不用按就自己連」的情況。
  - 自動連線照舊：有釘選就只連釘選的裝置、不用 mDNS 偵測（issue #35）。
  - 沒跟這台電腦配對過的 iPhone 握手會失敗，不會被連上。
- 已經連上的裝置，不管走 USB 還是 WiFi，WiFi 掃描和自動連線都一律跳過。（Q9、Q12）
  - 用 USB 連著、同時也在同一個 WiFi 上的手機，不會被切到 WiFi。想從 USB 切到 WiFi，照舊在 WiFi 面板手動連。
  - 已經用 WiFi 連上的手機不重連、不重建模擬引擎，正在跑的路線不會中斷。
- 按鈕放在現在「掃描 USB 裝置」那一列，改成兩顆並排：「掃描 USB 裝置」｜「掃描 WiFi 裝置」，英文 "Scan USB devices"｜"Scan Wi-Fi devices"。WiFi 面板收著也按得到。（Q6）
- 進行中：按鈕顯示「掃描中」，沿用 `device.scan_scanning`。一次可能跑很久，見「不做」最後一條。（review 9）
- 按完的回報，結果在按鈕上閃 2 秒，跟 USB 鈕一樣。（Q7、review 8）

  | 新連上 n | 連線失敗 m | 按鈕閃 | 下方提醒 |
  |---|---|---|---|
  | > 0 | 0 | 「新連上 n 台」 | 無 |
  | > 0 | > 0 | 「新連上 n 台、m 台連線失敗」 | 無 |
  | 0 | > 0 | 「m 台連線失敗」 | 無 |
  | 0 | 0 | 「沒有找到新的 iPhone」 | 「請確認手機 WiFi 已開、跟電腦在同一網路」 |

  英文："n new connected"、"n new connected, m failed"、"m failed"、"No new iPhone found"、"Make sure the iPhone's Wi-Fi is on and on the same network as this PC"。

  - 「連線失敗」只算 mDNS 有找到的候選。mDNS 收得到廣播，代表這台 iPhone 確實在這個 WiFi 上，卻連不上。
  - 其他候選連不上都當成「沒找到」：
    - 只有存過的 IP 的候選：連不上最常見的原因就是手機 WiFi 沒開，也就是這張票要處理的情況。
    - 子網掃描找到的主機：子網掃描只看 Port 有沒有開，那台可能根本不是 iPhone。
  - 「下方提醒」只在 m = 0 時出現。有失敗代表手機的 WiFi 是開的，叫使用者去確認 WiFi 反而不對。
  - 下方提醒的半寬按鈕放不下完整句子，2 秒也讀不完，所以放在按鈕列下方一行。
- 按鈕不能按的時候：（Q7）
  - 已經連上 3 台（USB 加 WiFi 合計）。tooltip 寫「已連上 3 台」，英文 "3 devices connected"。
  - WiFi 掃描正在跑。
  - 自動連線正在跑，避免兩邊同時對同一台手機握手。從排定 1.5 秒計時器那一刻就算，到自動連線結束為止；自動連線開關關著時不算。（review）
- 按鈕列下方那一行，兩種提示共用一個位置、不會同時出現。顯示條件都是即時算出來的，不靠「連上時清掉」這類事件。（Q8、Q10、Q12、review）
  - **開啟提示**：「沒有自動連上 iPhone，開好手機 WiFi 後按『掃描 WiFi 裝置』」，英文 "No iPhone connected automatically. Turn on the iPhone's Wi-Fi, then press 'Scan Wi-Fi devices'."
    - 條件：自動連線開關開著、這次載入頁面後自動連線已經跑完、目前一台裝置都沒連上，而且這次載入後還沒按過 WiFi 掃描。
    - 「跑完」包含沒有任何候選、直接結束的情況。
    - 照這個條件，裝置連上後又斷掉、而且使用者還沒按過 WiFi 掃描時，這行會再出現。接受這個情況：那時它的建議照樣用得上。
  - **掃描提醒**：上表最後一列那句。
    - 條件：最近一次 WiFi 掃描的結果是 n = 0、m = 0，而且目前連上的台數沒有比那次掃描結束時多。群組裡其他手機已經連著時也會顯示。
    - 下一次 WiFi 掃描開始時消失。
- GLOSSARY 新增「裝置連線」一節：**WiFi 通道**、**自動連線**、**自動偵測**、**WiFi 掃描**。自動連線收窄成「開啟 LocWarp 時的那一次嘗試」，斷線後的重試不算。（Q3、Q4、Q13，已經 commit）

### 實作

- 先做 prefactor：把「收集候選」從 `frontend/src/App.tsx` 的自動連線抽成純函式模組，例如 `frontend/src/wifiCandidates.ts`。
  - 比照 `frontend/src/pipiFruit.ts`：不做 runtime import、只用可清除的語法，讓 `node --test` 能直接載入。
  - 存過的 IP 先在呼叫端用 `savedIpsForPrefix` 篩好再傳進來。
  - 自動連線和 WiFi 掃描共用這個模組，用參數區分兩種模式。
  - 輸入：
    - 這個網段存過的 IP。UDID 是選填的：`SavedTunnelIp.udid` 本來就可以沒有，舊版單一 IP 的 fallback 也沒有。
    - mDNS 或子網掃描的結果，含 `method`。
    - 已連上裝置的 UDID（USB 加 WiFi）。
    - 已有 WiFi 通道的手機區網 IP。
    - 釘選清單。
    - 模式。
    - 剩下的名額。
  - 候選規則：
    - 自動連線模式保留現況：有釘選就只用釘選裝置存過的 IP，不用偵測結果。沒有 UDID 的存檔 IP 不可能被釘選，所以有釘選時不會出現。
    - WiFi 掃描模式不看釘選。
    - 每個 UDID 只出一個候選，取最新的那筆。這是現有 `udidSeen` 的行為，抽模組時不能丟掉。（review 6）
    - 存過的 IP 的 UDID 已連上，就跳過。
    - 任何候選的 IP 等於某條 WiFi 通道的手機區網 IP，就跳過，不管來源是存過的 IP 還是偵測結果。（review 5）
      - 理由：沒有 UDID 的存檔 IP，前一條擋不到。Port 一樣時後端會回 `already_running`；Port 不一樣時要等滿 45 秒（`TUNNEL_START_BUDGET`）才失敗。
    - 同一個 IP 只出一個候選，Port 合併成一份清單，存過的 Port 在前、偵測到的在後；來源也合併記下來。
      - 理由：同一台手機如果存過的 Port 跟偵測到的不同，現況會變成兩個候選、同時連同一台。第二個在後端會跳過已被占用的 UDID，試完其他配對記錄還會重掃 Port，最多耗 45 秒才失敗。
    - 候選數最多 = 3 − 已連上裝置數，存過的 IP 排前面。
  - 回報統計也是這個模組裡的純函式（review 3）：
    - 輸入每個候選的結果（`connected`、`already_connected`、失敗）和它的來源，輸出新連上 n 台、連線失敗 m 台。
    - `already_connected` 兩邊都不算。
    - 失敗只在來源含 mDNS 時才算進 m。
  - 自動連線裡的 `alreadyTunneled` 比對和開頭的 `connectedDevices.length > 0` 檢查都換成這個模組（Q12），不留下來。
- 後端（`backend/api/device.py`）：
  - `/wifi/tunnel/status` 每條通道多回傳手機的區網 IP 與 Port，來源是 `TunnelRunner.target_ip` / `target_port`，欄位名例如 `target_ip`、`target_port`。前端的 `TunnelInfo` 型別一起補。
  - `/wifi/tunnel/start-and-connect` 加一個選填旗標，例如 `skip_connected`，預設 false。WiFi 掃描和自動連線都帶 true。
    - 判斷要在 `wifi_tunnel_start` 回來之後、呼叫 `connect_wifi_tunnel` **之前**做，用 `tunnel_result["udid"]`。（review 7）
      - 不能用 `connect_wifi_tunnel` 回傳的 `info.udid`：那時已經太晚，因為 `connect_wifi_tunnel` 遇到已連上的 UDID 會先 disconnect，USB 連線已經斷了。
    - `status` 是 `already_running`，而且這個 UDID 在 `dm._connections` 裡：直接回 `{"status": "already_connected", "udid": ...}`，不呼叫 `connect_wifi_tunnel`，也不動模擬引擎。
      - 通道還在、裝置連線卻掉了（UDID 不在 `dm._connections`）時，照現在的流程重連，等於順便修復。（review）
    - `status` 是 `started`，而且這個 UDID 在 `dm._connections` 裡（例如用 USB 連著）：
      - 用 `_tear_down_tunnel` 只收掉剛建的這條通道，要在 `_tunnels_lock` 裡做，跟現有失敗路徑一樣。然後回 `already_connected`。
      - `_tear_down_tunnel` 只停 runner 和 watchdog，不碰裝置連線。不能用 `_cleanup_wifi_connection_for`，它會斷掉裝置連線。
    - 不帶旗標時行為不變：WiFi 面板手動連、從 USB 切到 WiFi 都照舊。
- 前端：
  - `frontend/src/hooks/useDevice.ts`：
    - `startWifiTunnel` 多收一個選填的 `skipConnected`，帶給 API。（review 2）
      - 回應是 `already_connected` 時，回傳一個可以分辨的結果，其他事都不做：不 `setConnectedDevice`、不把裝置標成 `Network`、不在 `tunnels` 加沒有 RSD 的假通道、不寫 savedips。
      - 失敗照舊丟例外。
    - 新增 WiFi 掃描用的函式，流程是：
      1. 重新呼叫一次 `/wifi/tunnel/status` 拿手機區網 IP。不能用 `tunnels` 狀態，因為 `startWifiTunnel` 和 `tunnel_recovered` 事件寫進去的通道都沒有 IP。（review 4）
      2. 讀存過的 IP，依網段篩選。
      3. 呼叫一次偵測（不看釘選）。
      4. 用模組算出候選。
      5. 平行對每個候選呼叫 `startWifiTunnel(..., skipConnected)`。
      6. 用模組統計，回傳給畫面。
    - 不要沿用既有的 `scanWifi` / `api.wifiScan` / 後端 `/wifi/scan`。那是 v0.1.49 拿掉 iOS 17 以前直連 WiFi 後留下的 lockdownd 掃描，沒有任何畫面在用，名字卻跟新功能一樣。新函式取別的名字。
  - `frontend/src/App.tsx`：
    - 自動連線改用共用模組，帶 `skipConnected`。
    - 新增狀態：自動連線進行中、自動連線已跑完、這次載入後按過 WiFi 掃描、最近一次 WiFi 掃描的結果和那時的已連上台數。
      - 計時器在 effect cleanup 被清掉時，「進行中」要跟著歸零。
    - 傳給 `DeviceStatus`。
  - `frontend/src/components/DeviceStatus.tsx`：
    - 兩顆按鈕並排、進行中、閃結果、不能按的狀態、下方那一行。
    - 它的 `Device` 型別沒有 `is_connected`，要多傳一個「已連上裝置數」prop。（review）
  - i18n：`frontend/src/i18n/strings.ts`，放在 `device.scan*` 附近，中英文都要。

## 驗收

- 前端測試：新檔 `tests/frontend/test_wifi_candidates.ts`，鎖住：
  - WiFi 掃描模式：有釘選時照樣用偵測結果，也不濾掉未釘選裝置存過的 IP。這條鎖 Q5，改成受釘選限制測試就會紅。
  - 自動連線模式：有釘選時只用釘選裝置存過的 IP、不用偵測結果，沒有 UDID 的存檔 IP 不出現。沒有釘選時會用偵測結果。這條鎖現況（issue #35）。
  - 兩種模式都跳過 UDID 已連上的存檔 IP。這條鎖 Q9、Q12。
  - 通道手機 IP 跳過：沒有 UDID 的存檔 IP、mDNS 結果、子網掃描結果都會被擋。
  - 同一個 UDID 只出一個候選，取最新的那筆。
  - 同一個 IP 只出一個候選，Port 合併、存過的在前，來源合併。
  - 候選數最多 3 − 已連上裝置數，存過的 IP 優先。
  - 統計：
    - `already_connected` 不算新連上，也不算失敗。
    - 來源含 mDNS 的失敗算進 m。
    - 只有存過的 IP、只有子網掃描、存過的 IP 加子網掃描，這三種來源的失敗都不算。
- 後端測試：新檔 `tests/device/test_wifi_skip_connected.py`。
  - 寫法比照 `tests/pipi/`：模組層級的 assert，從 repo 根目錄用 `.venv/Scripts/python.exe` 執行。
  - `wifi_tunnel_start`、`dm`、`app_state` 都用假的，不碰網路和真手機。
  - 帶旗標、`already_running`、UDID 已連上：回 `already_connected`，沒有呼叫 `connect_wifi_tunnel`，引擎沒被拿掉。
  - 帶旗標、`already_running`、UDID 不在 `dm._connections`：照舊呼叫 `connect_wifi_tunnel`。
  - 帶旗標、`started`、UDID 已用 USB 連著：
    - 回 `already_connected`。
    - **沒有呼叫 `connect_wifi_tunnel`**。只看假的 `dm` 有沒有被斷線不夠，因為斷線發生在 `connect_wifi_tunnel` 裡面。
    - 剛建的通道被收掉，假的 `dm.disconnect` 沒被呼叫。
  - 不帶旗標：照舊呼叫 `connect_wifi_tunnel`。
- Mutation check：以下每一種改法都要讓測試變紅：
  - WiFi 掃描改成受釘選限制。
  - 拿掉「已連上的 UDID 跳過」。
  - 「通道手機 IP 跳過」改成只套在偵測結果。
  - 拿掉「每個 UDID 只出一個候選」。
  - 拿掉同一個 IP 合併。
  - 只有存過的 IP 的失敗也算進 m。
  - 帶旗標時照樣 `connect_wifi_tunnel`。
  - 改成在 `connect_wifi_tunnel` 之後才判斷已連上。
  - 帶旗標時改用 `_cleanup_wifi_connection_for`。
  - `already_running` 時不檢查 `dm._connections` 就回 `already_connected`。
- 既有測試全部照跑，結果逐一回報，沒跑的要明說：
  - `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"`
  - `tests/pipi/` 的 python 腳本
  - `node tests/pipi/test_extension.js`
  - `npm run build` 通過
- 人工驗證（agent 用 `start.py` 啟動，在瀏覽器驗）：
  - 驗證時如果有手機連著，不能動到它：會連線的請求一律在瀏覽器攔截 `fetch`、回假結果，並用後端 log 確認沒有送到後端。
  - 兩顆按鈕並排；WiFi 面板收著時也看得到「掃描 WiFi 裝置」；進行中顯示「掃描中」。
  - 攔截 `fetch`，讓上表四種組合各出現一次，確認閃的文字和下方提醒；m > 0 時不出現「請確認…」。
  - 已連上 3 台時按鈕不能按，tooltip 是「已連上 3 台」。用攔截的方式模擬。
  - 自動連線開關開著、跑完一台都沒連上：出現開啟提示；按一次 WiFi 掃描後開啟提示不再出現。開關關掉再重新整理：不出現。
  - 自動連線的計時器還沒跑完時，WiFi 掃描按鈕不能按。
  - 慢的情況：沒有手機在 WiFi 上時按 WiFi 掃描，會走到子網掃描。記下從按下到出現結果的秒數，寫進這張票的 Comments。（review 9）
- 使用者用真手機實測：
  - 手機 WiFi 關著時開啟 LocWarp → 看到開啟提示 → 打開手機 WiFi → 按「掃描 WiFi 裝置」→ 連上。
  - 群組：A 已經用 WiFi 連上、正在跑路線；B 晚開 WiFi → 按 WiFi 掃描 → B 連上，A 的路線不中斷。
  - A 用 USB 連著、同時也在同一個 WiFi 上 → 按 WiFi 掃描 → A 仍然是 USB。
  - A 用 USB 連著、這個網段存過它的 IP → 重新整理頁面 → A 仍然是 USB。（Q12）
  - A 用 WiFi 連上、正在跑路線 → 重新整理頁面 → 路線不中斷。（Q12）
- 文件：`README.md` 和 `README.en.md` 的 WiFi Tunnel 段落、疑難排解表，都補上「掃描 WiFi 裝置」，以及「先開啟 LocWarp 才開手機 WiFi 時，按它補連」。
- Commit：
  - 前綴用半形冒號、後面不空格。
  - GLOSSARY 和這張票的 triage 在實作前就已經 commit。
  - 功能加 README 一個 commit，前綴用 `裝置連線:`，跟 GLOSSARY 的新一節同名。
  - 這張票的結果用 `.scratch:`。

## 不做

- 背景定期重試，或讓自動連線多跑幾次。（Q2）
- 釘選裝置在開啟 LocWarp 時沒連上的重試。釘選目前只在 WiFi 通道斷掉後每 15 秒重試，這張不改。
- 「自動偵測」的行為。
- 清理舊的 lockdownd 掃描：`useDevice` 的 `scanWifi`、`wifiScanning`、`wifiDevices`、`api.wifiScan`、後端 `/wifi/scan` 與 `scan_wifi_devices`。目前都沒在用，待以後清理。
- 縮短一次掃描的總時間。
  - `wifi_tunnel_start` 從頭到尾都拿著 `_tunnels_lock`，前端平行送出的請求在後端會一個接一個跑。
  - 連不到的存檔 IP 要等握手逾時、再重掃 Port；子網掃描到的非 iPhone 主機（例如開著 49152 的 PC 或路由器），每台最多會卡到 45 秒的上限。
  - 這張先在人工驗證量出實際秒數，太慢再另開票。

## Comments

- 2026-11-06：依另一個 session 的 review 修訂。
  - 採納：
    - 自動連線的「已有裝置連上就整個跳過」從來沒生效（stale closure），改寫「為什麼」，並刪掉「不改整個跳過」那條。（review 1，做法由使用者決定，見下）
    - 寫明前端遇到 `already_connected` 不做任何狀態更新。（review 2）
    - 統計改成模組裡的純函式，`node --test` 才測得到。（review 3）
    - WiFi 掃描開始時重新拿一次 `/wifi/tunnel/status`，因為 `tunnels` 狀態沒有 IP。（review 4）
    - 「通道手機 IP 跳過」套用到所有候選，因為存檔 IP 的 UDID 是選填。（review 5）
    - 「每個 UDID 只出一個候選」補進規則、測試和 mutation。（review 6）
    - 後端在 `connect_wifi_tunnel` 之前、用 `tunnel_result["udid"]` 判斷，測試要斷言沒呼叫它。（review 7）
    - 補上「0 台新連上、m 台失敗」的文字；有失敗時不顯示「請確認 WiFi」。（review 8）
      - 另外收得比 review 更緊：失敗只算 mDNS 找到的候選，因為只有存過的 IP 的候選連不上，最常見的原因正是手機 WiFi 沒開。
    - 進行中顯示「掃描中」，人工驗證加慢的情況，「不做」寫明後端序列化。（review 9）
    - 小項：
      - 「還沒有 WiFi 通道」改成「還沒連上」。
      - 提示改成即時算出來的條件，並寫明兩行不會同時出現。
      - 「自動連線進行中」從排定計時器起算。
      - `DeviceStatus` 多傳已連上裝置數。
      - `already_running` 要加 `dm._connections` 的條件。
      - 「開 Tool」和「開 LocWarp」統一寫成「開啟 LocWarp」。
      - GLOSSARY 和票先 commit。
    - 掃描提醒原本寫成「任何一台連上就消失」，群組裡其他手機已經連著時會永遠看不到；改成「連上的台數沒有比掃描結束時多」。這條是這次修訂時自己發現的，不在 review 裡。
  - 使用者決定：
    - Q12：自動連線也改成逐台跳過，跟 WiFi 掃描共用規則、帶 `skip_connected`。沒有採用「照註解修好、整個跳過」。
    - Q13：GLOSSARY 的自動連線收窄成「開啟 LocWarp 時的那一次嘗試」。
    - Q14：GLOSSARY 和這張票在實作前先各自 commit。
