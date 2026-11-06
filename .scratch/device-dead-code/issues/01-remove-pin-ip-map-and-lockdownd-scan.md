# 01 裝置連線：拿掉只寫不讀的 pin_ip_map，和沒人用的舊 lockdownd WiFi 掃描

Status: ready-for-agent
Blocked by: (none)
Type: task
相關：`.scratch/wifi-scan-button/issues/01-wifi-scan-button.md`。兩件事都是在那張票發現，記成待清理。

## 為什麼

兩段程式碼都沒有人用。留著沒有害處，但會誤導讀 code 的人：

- `pin_ip_map` 的註解說，開啟 LocWarp 時的自動連線靠它挑出釘選的裝置。其實沒有任何地方讀它。
- 舊的 lockdownd 掃描叫 `scanWifi`、`wifiScan`、`/wifi/scan`，跟「掃描 WiFi 裝置」按鈕（GLOSSARY：裝置連線）同名，做的卻是另一件事。

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
  - import 裡的 `wifiScan`（`:4`）。同一行的 `wifiConnect` 先留著，見「不做」。
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

## 驗收

- 搜尋時排除 `.scratch/`、`.venv/`、`.cache/`、`node_modules/`，以下名稱都要找不到：
  - `pin_ip_map`、`PIN_IP_MAP_KEY`、`readSavedEntryFor`
  - `scanWifi`、`WifiScanResult`、`wifiDevices`、`api.wifiScan`、`/wifi/scan`
  - `scan_wifi_devices`、`_load_pair_record`、`_guess_local_subnet`、`create_using_tcp`
  - `useDevice.ts` 裡也不能再有 `wifiScanning`。`DeviceStatus.tsx` 的那個要留。
- `frontend` 的 `npm run build` 要過。它會先跑 `tsc`，還有地方用到拿掉的東西就會編譯不過。
- 現有測試都要過，而且 0 skipped：
  - 前端：`tests/frontend/` 用 `node --test` 跑。
  - 後端：`tests/device/` 三支、`tests/launcher/` 一支、`tests/pipi/` 的 `test_*.py`，加上 `node tests/pipi/test_extension.js`。
  - `tests/pipi/check_live_anonymous.py` 會連到真網站，不用跑，但要寫明沒跑。
- 不加新測試：這張只刪掉沒有人呼叫的程式碼，沒有行為可以鎖住，mutation check 也套用不上。編譯和 grep 就是這張的檢查。
- 人工驗證：`togglePin` 沒有自動測試，所以在瀏覽器測。用 `fetch` 攔截假一條 WiFi 通道，不用真手機。
  - 先刪掉 `locwarp.tunnel.pin_ip_map` 這個 key，再按通道卡片上的釘選。`locwarp.tunnel.pinned` 要多出那個 UDID，`pin_ip_map` 不能再出現。
  - 再按一次取消釘選，`locwarp.tunnel.pinned` 要把那個 UDID 拿掉。
  - 後端要起得來，`GET /api/device/wifi/scan` 要回 404。
- Commit：
  - 開票用 `.scratch:`。
  - 實作用 `裝置連線:`，兩件事各一個 commit，方便個別 revert。
  - 結果用 `.scratch:`。

## 不做

- `connectWifi`（`useDevice.ts:233-256`）和 `api.wifiConnect`（`api.ts:126`）：
  - 它們也沒有人呼叫，而且打的 `/wifi/connect` 後端在 v0.1.49 就拿掉了，見 `backend/api/device.py:20` 的註解。
  - 這是開這張票時另外發現的，不在指定的範圍內。要一起清的話，由使用者決定移到上面，否則另開一張票。
- 使用者瀏覽器裡已經存在的 `pin_ip_map` key：沒有人讀它，留著也不影響。

## Comments
