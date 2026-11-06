# 01 裝置連線：拿掉只寫不讀的 pin_ip_map，和沒人用的舊 lockdownd WiFi 掃描與 WiFi 直連

Status: resolved
Blocked by: (none)
Type: task
相關：`.scratch/wifi-scan-button/issues/01-wifi-scan-button.md`。第 1、2 節是在那張票發現、記成待清理的。第 3 節是開這張票時另外發現，使用者決定併進來。

## 為什麼

三段程式碼都沒有人用。留著沒有害處，但會誤導讀 code 的人：

- `pin_ip_map` 的註解說，開啟 LocWarp 時的自動連線靠它挑出釘選的裝置。其實沒有任何地方讀它。
- 舊的 lockdownd 掃描叫 `scanWifi`、`wifiScan`、`/wifi/scan`，跟「掃描 WiFi 裝置」按鈕（GLOSSARY：裝置連線）同名，做的卻是另一件事。
- 舊的 WiFi 直連叫 `connectWifi`、`wifiConnect`，看起來像 WiFi 的連線入口。其實它打的後端路由早就拿掉了，真的呼叫只會失敗，而且請求會落到別的路由。WiFi 面板舊分頁的 i18n 字串也一樣沒有人用。

拿掉之後行為不變。

下面的行號都是 `88ab97c` 時的位置，動手前先用 grep 再對一次。

## 1. `locwarp.tunnel.pin_ip_map` 只寫不讀

現況：

- `frontend/src/hooks/useDevice.ts:360` 定義 `PIN_IP_MAP_KEY`，`togglePin`（`:362-389`）會寫入它：
  - 釘選時寫入「UDID → 最新存檔的 `ip:port`」（`:375-385`）。
  - 取消釘選時刪掉那筆（`:368-374`）。
  - 兩段的註解都說它是給開啟 LocWarp 時的自動連線用的（issue #35）。
- 它是 upstream `d0543e5`（v0.2.170）加進來的。從那時到現在，只有 `togglePin` 自己讀出來、改完再寫回去，其他地方都沒讀過。
- 自動連線實際的篩選條件在 `frontend/src/wifiCandidates.ts`：`locwarp.tunnel.pinned`（`PIN_KEY`），加上存過的 IP 的 UDID。沒有用到 `pin_ip_map`。

要拿掉：

- `PIN_IP_MAP_KEY` 常數（`:360`）。
- `togglePin` 裡取消釘選時的刪除和註解（`:368-374`）。
- `togglePin` 裡釘選時的寫入和註解（`:375-385`）。
- `readSavedEntryFor` 和上面的註解（`:314-321`）。上面那段寫入是它唯一的呼叫端，拿掉之後就沒人用了。

要留：

- `togglePin` 的其他部分：更新 `pinnedUdids`、寫入 `PIN_KEY`，以及取消釘選時呼叫 `clearPinRetry`。
- `readSavedIps`：`readSavedEntriesFor` 還在用它。

## 2. 舊的 lockdownd WiFi 掃描沒有人用

現況：

- 這是 v0.1.49 拿掉 iOS 17 以前的 WiFi 直連之後留下來的。
- 它掃整個 /24 網段的 62078 port（lockdownd），找到 iOS 17 以後的手機也建不了 WiFi 通道。
- 沒有任何畫面呼叫它。

要拿掉的前端部分：

- `frontend/src/hooks/useDevice.ts`：
  - import 裡的 `wifiScan`（`:4`）。同一行的 `wifiConnect` 由第 3 節拿掉，兩節做完這一行就整行刪掉。
  - `WifiScanResult` 介面（`:34-39`）。只有這個檔案用到。
  - `wifiScanning`、`wifiDevices` 兩個 state 和上面的註解（`:154-156`）。
  - `scanWifi` 和上面的註解（`:258-274`）。
  - 回傳物件裡的 `scanWifi, wifiScanning, wifiDevices`（`:612`）。
- `frontend/src/services/api.ts:127` 的 `wifiScan`。

要拿掉的後端部分：

- `backend/api/device.py:23-31` 的 `/wifi/scan` 路由（`wifi_scan`）。
- `backend/core/device_manager.py:764-825` 的 `DeviceManager.scan_wifi_devices`。
- 只有 `scan_wifi_devices` 在用、拿掉之後跟著沒人用的：
  - `_load_pair_record`（`device_manager.py:992-1030`）。
  - `_guess_local_subnet`（`device_manager.py:1033-1048`）。
  - import：`create_using_tcp`（`:26`，同一行的 `create_using_usbmux` 要留）、`socket`（`:21`）、`Path`（`:23`）。

同名但不能動：

- `frontend/src/components/DeviceStatus.tsx` 的 `wifiScanning`：這是「掃描 WiFi 裝置」按鈕自己的 state。
- i18n 的 `device.wifi_scan*` 字串：這些是新按鈕的字串。
- `backend/api/device.py` 其他提到 62078 的地方，例如 `NON_REMOTEPAIRING_PORTS` 和探測用的 Port：這些是 RemotePairing 掃描在用。

## 3. 舊的 WiFi 直連（`/wifi/connect`）只剩前端

現況：

- v0.1.49（`91c4f7f`）拿掉 iOS 17 以前的 WiFi 直連時，拿掉了：
  - 後端的 `/wifi/connect` 路由和 `DeviceManager.connect_wifi`。
  - 前端 WiFi 面板的「iOS 17 以下」分頁，以及 `App.tsx` 傳給 `DeviceStatus` 的 `onWifiConnect={device.connectWifi}`。
- 留下來的有 hook 的 `connectWifi`、API 函式 `wifiConnect`，和 `DeviceStatus` 的 `onWifiConnect` prop。
- 沒有地方呼叫 `connectWifi`，也沒有地方傳 `onWifiConnect`。用到 `DeviceStatus` 的只有 `App.tsx:1560` 這一處。
- 真的呼叫的話不會回 404：
  - `POST /api/device/wifi/connect` 會對上 `POST /{udid}/connect`（`backend/api/device.py:1641`），`udid` 變成 `"wifi"`。
  - 後端會去連 UDID 是 `wifi` 的裝置，找不到就回錯誤，`connectWifi` 再把錯誤往上拋。
  - 這是讀 code 推出來的，沒有實際打過。
- iOS 17 以後的 WiFi 連線走 `startWifiTunnel`、`findAndConnectWifi`，跟它無關。

要拿掉：

- `frontend/src/hooks/useDevice.ts`：
  - import 裡的 `wifiConnect`（`:4`）。
  - `connectWifi`（`:233-256`）。
  - 回傳物件裡的 `connectWifi`（`:612`）。
- `frontend/src/services/api.ts:126` 的 `wifiConnect`。
- `frontend/src/components/DeviceStatus.tsx`：
  - `onWifiConnect` prop 的宣告（`:38`）和解構（`:65`）。
  - `:680` 的 `(onStartWifiTunnel || onWifiConnect) &&` 改成 `onStartWifiTunnel &&`。`App.tsx:1578` 一定會傳 `onStartWifiTunnel`，所以行為不變。
  - `:679` 的註解「collapsible with iOS version tabs」說的是 v0.1.49 拿掉的分頁，改成符合現況，只說這一段可以收合。
- `frontend/src/i18n/strings.ts` 裡沒有人用的三個分頁字串：
  - `wifi.tab_ios17minus`（`:277`）和 `wifi.legacy_unavailable`（`:804`）：v0.1.49 拿掉「iOS 17 以下」分頁時，`DeviceStatus` 裡用到它們的 `t(...)` 一起拿掉了，字串卻留了下來。
  - `wifi.tab_ios17plus`（`:276`）：同一組分頁的另一個標籤，來源跟上面兩個不同。它在 v0.1.23（`6a1ed55`）加進來之後就沒有被引用過，不是 v0.1.49 留下的。
  - 也查過用變數組出 key 的寫法，同樣沒有地方用到這三個字串。

要留：

- `connectWifi` 裡用到的 `setConnectedDevice`、`setDevices`、`DeviceInfo`：其他地方還在用。
- 後端兩段「v0.1.49 已拿掉」的註解：`backend/api/device.py:20` 和 `backend/core/device_manager.py:655-656`。它們寫的是後端為什麼沒有這個路由、這個方法，跟前端這次清掉的程式碼無關。
- `DeviceManager.connect_wifi_tunnel`，以及 `tests/device/test_wifi_skip_connected.py` 的同名假方法：這是 iOS 17 以後的 WiFi 通道在用，只是名字開頭一樣。
- `DeviceStatus.tsx:224` 的註解「WiFi tunnel remains iOS 17+ only; iOS 16 devices are supported over USB.」是對的，不要動：
  - v0.1.49 拿掉了 iOS 16 支援。隔天的 `d512094`（iOS 16.x support via LegacyLocationService）讓 iOS 16 改走 USB、重新支援，這行註解就是那次加的。
  - 現在後端的 `MIN_VERSION = "16.0"`（`device_manager.py:51`），`DeviceStatus.tsx:600` 也寫著 iOS 16 有支援。
  - 這一節講的都是 v0.1.49 拿掉的東西，很容易誤以為這行也過時了。

## 驗收

- 用 `git grep -n -e <名稱> -- ':!.scratch'` 搜尋，要分大小寫，以下名稱都要找不到：
  - 用 `git grep` 是因為它只搜 git 追蹤的檔案。`frontend/dist/` 的舊 build 和 `__pycache__/` 的 `.pyc` 雖然在 `.gitignore` 裡，檔案還在磁碟上。例如 `frontend/dist/assets/index-DN7WlHun.js` 現在就有 `pin_ip_map` 和 `wifi/scan`。用 rg 或 grep 搜的話會誤判成失敗。
  - `pin_ip_map`、`PIN_IP_MAP_KEY`、`readSavedEntryFor`
  - `scanWifi`、`WifiScanResult`、`wifiDevices`、`wifi/scan`
  - 路徑類的搜尋詞開頭不加 `/`。Git Bash 會把開頭是 `/` 的參數轉成 Windows 路徑，`git grep -e /wifi/scan` 什麼都搜不到，驗收照樣過。
  - `wifiScan` 要加 `-w` 整字比對，才不會搜到新按鈕的 `wifiScanning`、`wifiScanDisabled`。
  - `scan_wifi_devices`、`_load_pair_record`、`_guess_local_subnet`、`create_using_tcp`
  - `connectWifi`、`wifiConnect`、`onWifiConnect`。`findAndConnectWifi` 要留。
  - `tab_ios17minus`、`tab_ios17plus`、`legacy_unavailable`
  - `useDevice.ts` 裡也不能再有 `wifiScanning`。`DeviceStatus.tsx` 的那個要留。
- 以下名稱只能剩指定的那一處：
  - `wifi/connect` 只能剩 `backend/api/device.py:20` 那行註解。
  - `git grep -nw connect_wifi` 只能剩 `backend/core/device_manager.py:656` 那行註解。
- `backend/core/device_manager.py` 裡搜 `^import socket` 和 `^from pathlib import Path`，都要找不到。Python 不會因為沒用到的 import 報錯，repo 也沒有 linter，所以要另外查。
- `frontend` 的 `npm run build` 要過。它會先跑 `tsc`，還有地方用到拿掉的東西就會編譯不過。但 tsconfig 設了 `noUnusedLocals: false`，留下沒人用的東西 tsc 抓不到，要靠上面的 grep。
- 現有測試都要過，而且 0 skipped：
  - 前端：`tests/frontend/` 用 `node --test` 跑。
  - 後端：`tests/device/` 三支、`tests/launcher/` 一支、`tests/pipi/` 的 `test_*.py`，加上 `node tests/pipi/test_extension.js`。
  - `tests/pipi/check_live_anonymous.py` 會連到真網站，不用跑，但要寫明沒跑。
- 不加新測試：這張只刪掉沒有人呼叫的程式碼，沒有行為可以鎖住，mutation check 也套用不上。編譯和 grep 就是這張的檢查。
- 人工驗證：`togglePin` 沒有自動測試，所以在瀏覽器測。用 `fetch` 攔截假一條 WiFi 通道，不用真手機。
  - 先讓檢查真的驗得到東西：
    - 舊程式只有在 `locwarp.tunnel.savedips` 裡有那個 UDID 時才會寫 `pin_ip_map`。`readSavedEntryFor` 找不到就跳過，見 `useDevice.ts:378-379`。
    - 只攔截 `/wifi/tunnel/status` 做出來的假通道，不會寫進 savedips。這樣不管改沒改，`pin_ip_map` 都不會出現，這一步一定過。
    - 所以釘選前，先在 savedips 手動加一筆那個 UDID 的位址，例如 `{ ip, port, udid, lastUsed }`。假通道如果走 `start-and-connect`，`upsertSavedIp`（`useDevice.ts:492`）也會寫進去。
    - 動第 1 節之前，先照下面的步驟跑一次，確認 `pin_ip_map` 會出現。這證明這個檢查抓得到。
  - 刪掉 `locwarp.tunnel.pin_ip_map` 這個 key，再按通道卡片上的釘選。`locwarp.tunnel.pinned` 要多出那個 UDID，`pin_ip_map` 不能出現。
  - 再按一次取消釘選，`locwarp.tunnel.pinned` 要把那個 UDID 拿掉。
  - 後端要起得來，`GET /api/device/wifi/scan` 要回 404。
    - 這台機器的安裝版也用 8777 port，它還有這條路由，會回 200。
    - 所以先確認回應的是 dev 後端，例如看 dev 後端的 uvicorn access log 有沒有這筆請求。
- Commit：
  - 開票用 `.scratch:`。
  - 實作用 `裝置連線:`，三節各一個 commit。
    - 每個 commit 單獨跑 `npm run build` 都要過。
    - 第 2、3 節都會改到 `useDevice.ts:4` 的 import 和 `:612` 的回傳。後做的那個 commit 把這兩行整行刪掉，所以先做的那個 commit 不能單獨 revert，會在這兩行衝突。
  - 結果用 `.scratch:`。

## 不做

- 使用者瀏覽器裡已經存在的 `pin_ip_map` key：沒有人讀它，留著也不影響。

## Comments

- 2026-11-06：使用者決定把 `connectWifi`、`api.wifiConnect` 移進範圍，成為第 3 節。開票時它們列在「不做」，因為不在原本指定的兩件事裡。
- 2026-11-06：依另一個 session 的 review 修訂。九點都對過程式碼，全部採納：
  - 第 3 節漏了 `DeviceStatus` 的 `onWifiConnect` prop，補進範圍和驗收。現況改寫：v0.1.49 前端也拿掉了分頁和 App 傳的 prop，不是「只拿掉後端」。
  - `api.wifiScan` 這個搜尋詞本來就找不到東西，改成 `wifiScan` 整字比對。
  - 釘選的人工驗證：假通道的 UDID 不在 savedips 時，`pin_ip_map` 本來就不會寫，這一步一定過。補上先在 savedips 加一筆，並在動手前先跑一次、確認它會出現。
  - `socket`、`Path` 漏刪的話沒有任何檢查會發現，補上 grep。
  - 搜尋改用 `git grep`，避開 `frontend/dist/` 的舊 build 和 `.pyc`。
  - `connect_wifi` 改成 `-w` 整字比對，寫明只能剩哪一行。
  - 「相關」寫明只有第 1、2 節來自 wifi-scan-button 那張票。
  - Commit：`:612` 那行也是兩節都會改；拿掉「方便個別 revert」，改成每個 commit 單獨 build 都要過。
  - 確認 404 之前，先確認回應的是 dev 後端，不是同樣用 8777 的安裝版。
  - 修訂時另外發現（review 沒提到）：在 Git Bash 跑 `git grep -e /wifi/scan`、`-e /wifi/connect` 會被轉成 Windows 路徑，什麼都搜不到。搜尋詞改成不加開頭的 `/`，搜到的行跟 `MSYS_NO_PATHCONV=1` 時一樣。
- 2026-11-06：使用者決定再併進第 3 節：
  - `wifi.tab_ios17minus`、`wifi.legacy_unavailable`、`wifi.tab_ios17plus` 三個沒有人用的 i18n 字串。原本只提了前兩個，`tab_ios17plus` 是查的時候另外發現的，使用者同意一起拿掉。
  - 「要留」加上 `DeviceStatus.tsx:224` 的註解。我原本以為它過時、提議改掉，往後查 git 歷史才發現 `d512094` 讓 iOS 16 改走 USB、重新支援，所以這行是對的。寫進「要留」，避免做清理的人犯同樣的錯。
- 2026-11-07：實作完成，三節各一個 commit，依 1、2、3 的順序：`6902a8b`、`8a03caf`、`6730a1d`。
  - 驗收 grep：
    - 清單上的名稱都找不到。`useDevice.ts` 沒有 `wifiScanning`，`DeviceStatus.tsx` 的那個還在。
    - `wifi/connect` 只剩 `backend/api/device.py:20`。
    - `-w connect_wifi` 只剩 `device_manager.py:654`。票上寫 `:656`，少的兩行是第 2 節刪掉的 `socket`、`Path` import，是同一行註解。
    - `^import socket`、`^from pathlib import Path` 都找不到。
  - build：
    - 三個 commit 在乾淨的 worktree 各自跑 `npm run build`，都通過。
    - 反向檢查：在 `6730a1d` 的回傳物件放回 `connectWifi`，tsc 報 TS18004、build 失敗。所以這項檢查抓得到東西。
  - 測試：
    - 通過：前端 95/95（0 skipped）、`tests/device` 3 支、`tests/launcher` 1 支、`tests/pipi` 4 支 `test_*.py`、`test_extension.js`。
    - 沒跑：`check_live_anonymous.py`，它會連到真網站。
  - 人工驗證，都在 5174 的第二個 Vite 攔截 fetch，沒有用真手機：
    - [x] 釘選，改動前：savedips 先放一筆假 UDID 的位址。按釘選後 `pin_ip_map` 出現，內容是那個 UDID 對到 `192.168.0.250:49152`；取消釘選後變成 `{}`。這證明檢查抓得到。
    - [x] 釘選，改動後：同樣的步驟。釘選後 `pinned` 多了那個 UDID，`pin_ip_map` 沒有出現；取消釘選後 `pinned` 拿掉了它，`pin_ip_map` 一樣沒有出現。
    - [x] 第 3 節之後：連線頁的 WiFi 區塊照常顯示、可以展開，console 沒有錯誤。
    - [x] 重啟 dev 後端後，`GET /api/device/wifi/scan` 加上一個獨有的 query 標記，回 404。dev 後端的 uvicorn access log 有這筆請求，所以回的是 dev 後端，不是安裝版。`/api/device/list`、`/wifi/host-network` 照常回 200。
    - dev 後端的 log 裡沒有任何寫入類的 `/api/device/*` 請求。
  - 驗收的寫法跟實際不同的地方：只攔截 `/wifi/tunnel/status` 做不出通道卡片。
    - App 載入時不會呼叫 `checkTunnelStatus`。`tunnels` 只有在 `startWifiTunnel` 成功，或收到 WS 的 `tunnel_recovered` 時才會填進去。
    - 所以這次讓自動連線打攔截下來的 `start-and-connect`，做出假通道，savedips 照票上先放一筆。
  - review（Standards、Spec 兩軸）：都沒有發現問題，也沒有 scope creep。
  - 範圍外、沒修：
    - `device_manager.py:653-658` 的註解說 `_ensure_classic_ddi_mounted`、`_create_legacy_location_service` 在 v0.1.49 拿掉了，其實兩個都還在（`:521`、`:642`），只有 `connect_wifi` 那部分是對的。它們是 `d512094` 讓 iOS 16 改走 USB 時加回來的，跟 `DeviceStatus.tsx` 那行 iOS 16 註解同一次。這張票寫明這段註解要留，所以沒動，待另外開票。這是 Standards review 發現的，我對過程式碼和 git 歷史。
    - 5174 驗證頁掛載時，`AddressSearch` 會發 `PUT /api/geocode/provider-pref`，把那個 origin 的 geocode 設定寫進 `~/.locwarp/settings.json`：provider 是 `arcgis`，key 是空的。這個檔案跟安裝版共用。這是既有行為，每個前端掛載時都會推自己 localStorage 裡的值，下次開正式版會推回它自己的設定。
