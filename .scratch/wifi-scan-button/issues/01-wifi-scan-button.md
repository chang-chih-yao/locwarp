# 01 裝置連線：新增「掃描 WiFi 裝置」按鈕，自動連線改成逐台跳過已連上的裝置

Status: ready-for-human
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
    - 候選不截斷，存過的 IP 排前面。實際送出幾個由補位決定（2026-11-06 第二次 review 後改，見 Comments）：
      - 開「3 − 已連上裝置數」個名額，名額內平行送。
      - 回 `already_connected` 的候選讓出名額給下一個；連上或失敗就佔住，不往下試。
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
        - 自動連線和 WiFi 掃描走不到這條：前端依「通道手機 IP 跳過」不會送出這種請求。見 Comments（2026-11-06 第二次 review）。
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
  - 存過的 IP 排在偵測結果前面，候選不截斷。
  - 補位（2026-11-06 第二次 review 後加）：
    - 名額 = 3 − 已連上裝置數，依候選順序取。
    - 回 `already_connected` 的讓出名額給下一個。
    - 失敗照樣佔住名額。
    - 名額內平行送，同時進行的請求數不超過名額。
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
  - 2026-11-06 第二次 review 後加：
    - `already_connected` 也佔名額（不補位）。
    - 失敗也補位。
    - 名額不扣已連上台數。
    - 改成一個接一個送。
    - 候選模組照舊截斷候選。
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
  - 群組三台（2026-11-06 第二次 review 後加）：A 用 USB 連著、同時也在同一個 WiFi 上；B、C 跟這台電腦配對過，但在這個網段沒存過 IP → 按 WiFi 掃描 → B、C 都連上，A 仍然是 USB。
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
- 2026-11-06：實作在 `aa79d26`。
  - 測試：
    - 前端 88/88（0 skipped），新檔 `tests/frontend/test_wifi_candidates.ts` 11 個。
    - `tests/device/test_wifi_skip_connected.py` 5 個情境，比票上多一個 `/wifi/tunnel/status` 回 `target_ip`／`target_port`。
    - `tests/pipi/` 四支 `test_*.py` 都過；`check_live_anonymous.py` 會打真的網站，是手動 smoke test，沒有跑。
    - `node tests/pipi/test_extension.js` 過，`npm run build` 過。
    - Mutation：票上列的 10 種，加上 review 後補的「UDID 改成通過跳過規則後才佔」，共 11 種，都讓測試變紅。
  - 實作時跟票不同、或票裡沒明講的：
    - 候選模組不收「剩下的名額」，改在模組裡用 `MAX_DEVICES − 已連上台數` 算，並匯出 `MAX_DEVICES`。這樣「最多 3 − 已連上裝置數」這條本身測得到。
    - `useDevice` 只有一個 `findAndConnectWifi(mode)`，自動連線帶 `'auto'`、WiFi 掃描帶 `'scan'`。存過的 IP 讀取（含舊版單一 IP 的 fallback）從 `App.tsx` 搬進 `useDevice`，兩種模式都會用到。
    - `needsDiscovery(mode, pins)` 也放在模組裡：自動連線有釘選時連偵測都不呼叫，跟候選規則用同一個判斷。
    - `wifiAutoConnectAttemptedRef` 改成計時器真的觸發時才設。原本在排計時器前就設，WS 在 1.5 秒內斷掉、計時器被清掉時，自動連線就再也不會跑，「已跑完」也永遠不會成立，開啟提示不會出現。
    - 「那次掃描結束時的已連上台數」用掃描結束時的裝置清單，加上這次新連上的 UDID 取聯集，不是用「掃描前台數 + n」推算。掃描中途插上 USB 時，掃描提醒才不會被錯誤地藏起來。（review 後修）
    - 兩顆半寬按鈕蓋掉 `.action-btn` 的 `white-space: nowrap`。側欄 260 px，每顆約 107 px，不換行的話「新連上 1 台、1 台連線失敗」會被切掉。這段文字會換成三行；英文的按鈕名稱也會換成兩行。
    - 自動連線進行中時，WiFi 掃描按鈕只是灰掉，沒有額外的 tooltip。票只規定了「已連上 3 台」的 tooltip。
  - 人工驗證（agent 用 `start.py` 啟動，在瀏覽器驗）：
    - 環境與防護：
      - 驗證時後端 `/list`、`/wifi/tunnel/status` 都是空的，沒有手機連著。`/discover` 實際結果是 mDNS 空、子網掃描也沒找到主機，WiFi 上沒有 iPhone。
      - `start.py` 的 `webbrowser.open` 在啟動時換成空函式，免得開出沒攔截的分頁跑真的自動連線。
      - 另起一個驗證用的 Vite（5174 port，設定檔在 scratchpad），在 `index.html` 最前面注入 `fetch` 攔截，app 程式碼執行前就生效。`/list`、`/wifi/tunnel/status`、`/discover`、`start-and-connect` 都回假結果，其他非 GET 的 `/api/device/*` 一律擋下。
    - 兩顆按鈕並排；WiFi 面板收著也看得到「掃描 WiFi 裝置」；進行中顯示「掃描中」、不能按。
    - 四種組合各出現一次：
      - 綠「新連上 1 台」，無提醒。
      - 橘「新連上 1 台、1 台連線失敗」，無提醒。
      - 紅「1 台連線失敗」，無提醒；0 台連上時也一樣。
      - 紅「沒有找到新的 iPhone」，下方出現「請確認手機 WiFi 已開、跟電腦在同一網路」。群組裡已有別台連著時也會出現。
    - 驗證時發現：combo 1 的假成功會被 `upsertSavedIp` 寫進 savedips，之後它變成存過的 IP 候選，連不上時依規則不算 m，還會佔掉名額。這符合規則；之後每個組合前都先清 savedips。
    - 掃描提醒：
      - 連上台數變多就消失。用假的 `/list` 多一台、按 USB 掃描刷新來模擬。
      - 下一次 WiFi 掃描開始時就消失。
      - 掃描中插上 USB，結束時照樣出現。
    - 已連上 3 台時按鈕不能按，`title` 是「已連上 3 台」。原生 tooltip 截圖拍不到，只看 DOM。
    - 自動連線：
      - 開關開著、跑完一台都沒連上：出現開啟提示。按一次 WiFi 掃描後不再出現，失敗、0 台連上時也不出現。
      - 開關關掉再重新整理：沒有偵測請求、沒有開啟提示、按鈕一開始就能按。
      - 計時器還沒到（載入後 525 ms）和偵測進行中（3.5 s）時，WiFi 掃描按鈕不能按。
      - USB-X 用 USB 連著、savedips 有它的 IP：沒有送它的請求。另一台存過的手機的請求帶 `skip_connected: true`，回 `already_connected` 後裝置清單、通道、savedips 都沒變。
    - 英文：按鈕、四種結果、開啟提示的字串都對。
    - 慢的情況（`/discover` 用真的後端）：
      - 沒有存過的 IP：從按下到出現結果 3.9 秒。mDNS 等 3 秒，子網掃描沒找到主機。
      - 加一個存過、但沒人用的 IP（192.168.0.250，ping 不到，等同手機 WiFi 沒開），讓它的 `start-and-connect` 真的送到後端：10.9 秒。偵測約 4 秒；握手 1 秒逾時；後端重掃 Port 6 秒，沒找到。
      - 前端要等偵測結束才開始連線，所以存過的 IP 要多等偵測那約 4 秒。依「不做」，沒有改。
      - 這次網路上沒有「開著 49152 的非 iPhone 主機」，所以沒量到每台最多 45 秒的情況。
    - 驗證時的疏失：
      - 做完上面那次 10.9 秒的量測後，沒有把驗證頁 localStorage 裡的 `realConnect` 關掉，接著改 code 觸發 HMR，元件重掛、ref 歸零，自動連線又跑了兩次。
      - 所以後端另外收到兩筆 `start-and-connect`，都是打 192.168.0.250。頁面上那層「只放行 .250」的保險還在，所以沒打到其他 IP。
      - 後端 log 共三筆 `WiFi tunnel start: ip=192.168.0.250`，對上三筆 POST。沒有建出通道，驗完 `/list`、`/wifi/tunnel/status` 都還是空的。
    - 驗完：關掉分頁，清掉 5174 的 localStorage，停掉後端與兩個 Vite。
  - 沒驗到：
    - 使用者用真手機實測的五條，都還沒做。
    - 真的 mDNS 找到 iPhone、真的握手成功或失敗的路徑：瀏覽器裡都用假結果。後端那段只有 `test_wifi_skip_connected.py` 的假物件測試。
  - code review（Standards、Spec 兩軸）：
    - 採納：
      - `DeviceStatus` 的 `MAX_TUNNEL_DEVICES` 別名拿掉，tunnel 上限也用 `MAX_DEVICES`，跟後端兩種上限都用 `MAX_DEVICES` 一致。
      - 補測試：最新的存檔 IP 被通道 IP 擋掉時，同一台手機不退回較舊的位址。並加進 mutation。
      - `connectedAfter` 改用掃描結束時的實際台數，見上面。
      - `DiscoveredInput.method` 從 `string` 改成 `'mdns' | 'tcp_scan'`。
      - 正式程式碼裡的 Q／review 編號，補上這張票的路徑。
    - 沒採納：
      - Data Clumps：傳給 `DeviceStatus` 的 6 個 props 是這張票指定的狀態，各自有不同的生命週期。
      - Duplicated Code：轉圈 SVG 和閃字計時器照抄 USB 鈕。抽出來要改到 USB 鈕，不在這張的範圍。
      - `startWifiTunnel` 的第 5 個位置參數 `skipConnected`：沿用這個函式原本的參數風格。
      - `showOpenHint`／`showScanReminder` 沒有自動測試：不在約定的 seam 上，靠人工驗證。
  - 待決定（Spec review 提出，票沒規定，沒有改）：
    - USB 連著的手機，它存過的 IP 會被跳過，但同一支手機的 mDNS 結果沒有 UDID，照樣會成為候選、佔掉名額。三台的群組裡，可能把真正還沒連上的手機擠出這一輪。後端會回 `already_connected`，不會出事。
    - 可以補一條規則：偵測結果的 IP 等於「已連上 UDID 的存檔 IP」時也跳過。代價是 DHCP 把那個 IP 給了別台手機時，會誤跳過。要不要做由使用者決定。
  - 待清理：
    - `frontend/src/components/DeviceChipRow.tsx` 還有自己的 `MAX_DEVICES = 3`。保留 `wifiCandidates.ts` 匯出的那個，理由是有測試；`DeviceChipRow` 那份之後改成 import。
  - 跟這張票無關、沒有修：
    - USB 掃描按鈕閃的「找到 n 台裝置」可能少算。`App` 傳的 `onScan={() => { device.scan() }}` 沒有回傳 promise，按鈕在掃描結束前就讀裝置數。驗證時 `/list` 回 2 台，按鈕閃「找到 1 台裝置」。
      - 2026-11-06 已修，在 `bc0b944`：
        - 只讓 `onScan` 回傳 promise 還不夠。promise 結束時父元件還沒用新清單重新 render，`DeviceStatus` 從 ref 讀到的是上一次掃描的台數，`/list` 依序回 2、3、1、2 台時閃 1、2、3、1。
        - 改成 `onScan` 回傳 `device.scan()` 找到的台數，閃的數字直接用它，拿掉 `devicesRef`。
        - 瀏覽器驗證（`fetch` 全部攔截）：依序閃「找到 2／3／1／2 台裝置」「未偵測到」，都對。這個按鈕沒有自動測試。
    - 手機 WiFi 都關著時開啟 LocWarp，後端 log 出現「Task exception was never retrieved」和整段 `TimeoutError` traceback。
      - 自動連線去試兩個存過的 IP，RemotePairing 連不上，請求回 500 `tunnel_timeout`，前端算失敗。這是設計上的失敗路徑，請求本身沒出錯。
      - traceback 來自 `TunnelRunner.start()`：通道建好前就失敗時，它只把錯誤往上拋，沒收那個已結束 task 的例外，task 被回收時 asyncio 就印出來。
      - upstream `7fbf467`（v0.2.5）就有。改這張票之前的自動連線，沒有裝置連著時也會去試存過的 IP，一樣會走到這裡。
      - 2026-11-06 已修，在 `848c19c`：
        - 往上拋之前先 `self.task.exception()`，行為不變。
        - 新測試 `tests/device/test_wifi_tunnel_runner.py`（假的 connect，不連網路），修之前紅、修之後綠。
        - mutation 4 個，3 個會紅。改成 `self.task.cancel()` 那個沒紅：`Task.cancel()` 對已結束的 task 也會清掉 `_log_traceback`，是等價的修法，不是漏測。
        - 沒有用真的後端重看 log。手機 WiFi 關著時再開一次 LocWarp，後端 log 應該只剩 "Re-scan ... found no untried ports" 和 500，沒有 traceback。
- 2026-11-06：第二次 review。另一個 session 對 `aa79d26`、`b4f9b2f` 做 code review（Standards、Spec 兩軸），依結果修改，實作在 `f0395d4`。
  - 本文改了：
    - Status 從 resolved 改成 ready-for-human：程式碼做完了，但「使用者用真手機實測」都還沒做。實測完再改回 resolved。
    - 候選規則的「候選數最多 = 3 − 已連上裝置數」改成補位，驗收的測試和 mutation 清單跟著補。
    - 後端「通道還在、裝置連線卻掉了」那條，補一行「自動連線和 WiFi 掃描走不到」。
    - 真手機實測補一條群組三台的情境。
  - 採納並實作：
    - 補位（使用者決定）：
      - review 指出本文兩條互相衝突：「A 用 USB 連著時，B、C 開啟 LocWarp 時照樣自動連上」，和「候選數最多 = 3 − 已連上裝置數」。上一則 Comments 把這件事寫成「票沒規定」，不準確：前一條就是規定。
      - 衝突的情況：
        - USB 連著的手機也在同一個 WiFi 上時，它的 mDNS 結果沒有 UDID 可以比對，會佔掉一個名額。另一台手機在這個網段沒存過 IP 時，就可能被擠掉。
        - B 連上後名額剩 1。如果 mDNS 每次回傳順序都一樣、A 排在 C 前面，C 不管按幾次掃描都連不上。
        - WiFi 連著的手機會被「通道手機 IP 跳過」擋掉，不受影響。
      - 做法：候選模組不再截斷；新的純函式 `fillFreeSlots` 開「3 − 已連上台數」個名額平行送，回 `already_connected` 的讓出名額給下一個候選，連上或失敗就佔住。
        - 失敗不補位：子網掃描到的非 iPhone 主機一台最多耗 45 秒。
        - 同時進行的請求數不超過名額，後端的裝置上限那層不受影響。
        - 依後端的實際回應判斷，不比對 IP，所以不會有上一則提到的 DHCP 換 IP 誤判。上一則的「待決定」就此結案，沒有採用比對 IP 的規則。
        - 代價：USB 手機那次嘗試要先完整握手、再收掉通道，那個名額會晚幾秒才補上。
      - 新的 seam（`fillFreeSlots`，用假的連線函式測）經使用者同意。TDD：
        - 「名額上限」「`already_connected` 讓出名額」先紅後綠。
        - 「失敗佔住名額」「名額內平行、不超過名額」寫下時就是綠的，是防退化的測試，靠 mutation 確認抓得到。
        - 最後把舊的上限測試改成「候選不截斷」，先紅後綠。
    - 互斥補上另一個方向：
      - 原本只有「自動連線進行中時，掃描按鈕不能按」。WebSocket 第一次連上前按鈕可以按；按下去之後 WebSocket 才連上的話，1.5 秒後自動連線會跟掃描同時跑。
      - 改成 App 記一個「WiFi 掃描進行中」的 ref。自動連線的計時器觸發時如果掃描還在跑，就記成已跑過、已跑完，直接結束。
      - 掃描不看釘選、跳過規則也一樣，自動連線會試的它都試了。開啟提示要求「還沒按過 WiFi 掃描」，所以這時也不會出現。
    - 後端 `temp_key` 改名 `tunnel_udid`：
      - re-key 那段的舊註解說它「通常是 `pending:ip:port`」。照這個說法，USB 連著的手機會比對不到、被切成 WiFi。
      - 查 `_build_tunnel_udid_candidates`：它是握手成功的那個識別碼，依序試呼叫端帶的 UDID、已連上裝置的 UDID、配對記錄。三者都沒有時才用 `pending:`，所以有裝置連著時一定不是 `pending:`，跳過判斷不會漏。
      - 註解寫明這件事，並把「通常是」改成「例如」。
    - `useDevice` 舊的 lockdownd `scanWifi`／`wifiScanning` 補註解：不是 WiFi 掃描，沒有人用，待清理。清理本身照「不做」那條，這張不做。
    - 上一則「待清理」的 `DeviceChipRow.tsx` `MAX_DEVICES`，改成 import `wifiCandidates.ts` 那份，已清掉。
    - `filter(is_connected).map(udid)` 兩處抽成 `connectedUdidsOf`。
  - 只記在票上、不改 code（使用者決定）：
    - 後端「通道還在、裝置連線卻掉了時，照現在的流程重連」：自動連線和 WiFi 掃描走不到。前端依「通道手機 IP 跳過」，不會對有通道的 IP 送出請求。後端這段只有 `test_wifi_skip_connected.py` 的假物件測試走得到。
    - 不改的理由：
      - 改成「只跳過裝置還連著的通道」的話，存過的 Port 跟通道的 Port 不同時，「通道手機 IP 跳過」想避免的 45 秒卡住會回來。要擋住它，得再加「改用通道的 Port」的新邏輯。
      - 這個狀態不是這張票要處理的，沒有真手機也驗不到。
    - 遇到時的補救：在 WiFi 面板手動連一次。不帶旗標、Port 一樣時會打到 `already_running`，接著重連。
  - 沒採納：
    - `DiscoveredInput` 重抄 `api.ts` 的型別：`npm run build` 會先跑 `tsc`，API 的 `method` 多一種值時這裡會編譯不過，逼人決定那種值算不算 mDNS。改用 `Pick` 引用的話，新的值會被默默歸成 `subnet`。`SavedIpInput` 同理。
    - `subnet` 跟 `tcp_scan` 名字不同：`subnet` 對應本文和 GLOSSARY 的「子網掃描」；`tcp_scan` 是後端回傳的值，對照寫在 `DiscoveredInput.method` 的註解和唯一那行轉換。
    - 測試名稱的「偵測結果」：本文的候選規則和驗收也這樣寫，只改測試反而不一致。
    - README 沒提最多 3 台：兩份 README 開頭和群組那段都已經寫了最多三台。
  - 測試：
    - 前端 92/92（0 skipped），`tests/frontend/test_wifi_candidates.ts` 15 個。
    - `tests/device/test_wifi_skip_connected.py`、`tests/pipi/` 四支 `test_*.py`、`node tests/pipi/test_extension.js`、`npm run build` 都過。`check_live_anonymous.py` 會打真的網站，沒有跑。
    - Mutation 16 種都讓測試變紅：原本 11 種，加上驗收清單新增的 5 種。
  - 人工驗證（agent 在瀏覽器驗，`fetch` 全部攔截）：
    - 環境與防護：
      - 驗證前後，後端 `/list`、`/wifi/tunnel/status` 都是空的，沒有手機連著。
      - 這次直接跑 `backend/main.py`、不經 `start.py`，不會開出沒攔截的分頁。
      - 沿用 5174 port 的驗證用 Vite 與 `fetch` 攔截；攔截腳本另外包了 `WebSocket`，可以讓它在指定時間前連不上。
      - 後端 access log 裡 `/api/device/*` 只有 GET（keepalive、host-network，以及 agent 自己 curl 的 `/list`、`/status`），沒有任何 POST。
    - 互斥，修之前先重現。設定：WebSocket 5 秒內連不上、第 3 秒按 WiFi 掃描、偵測要 12 秒。
      - 修之前：3.0 秒掃描開始偵測；8.0 秒 WebSocket 連上；9.6 秒自動連線又偵測一次；同一個 IP 收到兩筆 `start-and-connect`（15.0 秒、21.6 秒）。
      - 修之後：只有掃描那一次偵測、一筆 `start-and-connect`（15.0 秒），按鈕閃「新連上 1 台」。
    - 自動連線照常：沒按掃描、WebSocket 正常時，1.8 秒偵測，4.9 秒送出、帶 `skip_connected`。2.5 秒時按鈕不能按，跑完恢復。
    - 補位：A 用 USB 連著；mDNS 找到 A、B、C 三個 IP，A 排第一，A 那筆 1.5 秒後回 `already_connected`。
      - 按下後 A、B 同時送出（3.65 秒），C 在 A 回應後補上（5.16 秒）。
      - 按鈕閃「新連上 2 台」，裝置列 A（USB）、B、C 都是已連線。
  - 沒驗到：
    - 使用者用真手機實測的各條，包括這次補的群組三台。
    - USB 連著的 iPhone 是否真的會在 WiFi 上回 mDNS：補位的前提來自讀程式碼和 review，瀏覽器裡用的是假結果。
