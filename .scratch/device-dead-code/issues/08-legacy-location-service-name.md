# 08 裝置連線：`LegacyLocationService` 的「Legacy」容易被當成 iOS 16 的程式

Status: needs-triage
Blocked by: (none)
Type: task
相關：`.scratch/device-dead-code/issues/06-create-dvt-location-service-name.md` 2026-11-08 triage 的 Comment。那次討論 DVT、`DtSimulateLocation` 各是哪個 iOS 版本的路，記在「看過、沒列入」，同一天照使用者的決定開成這張。

## 為什麼

`LegacyLocationService` 是 iOS 17+ 的 DVT 打不開時退回的定位服務，不是 iOS 16 的程式。但這個 fork 從 `c20a1b6` 起拿掉了 iOS 16，名字裡的「Legacy」看起來像該跟著一起刪的舊東西。

- 名字從 v0.1.0 起就是這樣，那時它只給 iOS 17 以下用。v0.1.34（`accfd76`）起，它也是 iOS 17+ 的退路。`c20a1b6` 刪掉 iOS 16 後，它只剩退路這個用途。
- 「Legacy」說的是 `DtSimulateLocation`（`com.apple.dt.simulatelocation`）比 DVT 舊，這點沒寫錯。
- 現在不會造成錯誤。風險是之後清 dead code 或合併上游時，有人把它當成 iOS 16 的程式刪掉，DVT 打不開的手機就沒有退路。

下面的行號都是 `116d357` 時的位置。動手前以內容為準，先用 grep 再對一次。

## 現況

- 定義：`backend/services/location_service.py:234`。
  - docstring（`:236`）寫「Location simulation via DtSimulateLocation, the fallback when DVT fails.」，是 `c20a1b6` 改寫的。v0.1.0（`578ce35`）原本寫「Location simulation for iOS < 17 devices via DtSimulateLocation.」
  - 同一個檔案的 `DvtLocationService`（`:70`）是照它用的服務（DVT）取名。
- 唯一建立它的地方：`backend/core/device_manager.py:538`，在 `_create_dvt_location_service` DVT 失敗的 `except` 裡（`:526-540`）。`:532-534` 的註解寫著有使用者回報 iOS 26 上 `DtSimulateLocation` 也能用。
- 已經擋著不讓它被刪的：
  - `AGENTS.md:16`：合併上游時丟掉 iOS 16 的程式，但 `LegacyLocationService` 是 iOS 17+ DVT 失敗時的退路，要留著。
  - `tests/device/test_dvt_location_fallback.py`：`:22` import 它，`:89` 斷言 DVT 失敗時拿到的是它。類別被刪的話，這支測試會失敗。
- 用到這個名字的地方（不含 `.scratch`）共 14 處、6 個檔案：
  - `backend/core/device_manager.py`：`:38` import，`:390`、`:424`、`:498` 三處 docstring，`:538` 建立，`:539` log。
  - `backend/services/location_service.py:234`：定義。
  - `tests/device/test_dvt_location_fallback.py`：`:3` docstring、`:22` import、`:89` 斷言、`:90` 印出的訊息。
  - `README.md:300`、`README.en.md:300`：技術棧表格。
  - `AGENTS.md:16`。
- 名字以外，還有幾處「legacy」講的也是這個退路：
  - `device_manager.py`：`:108` `usbmux_lockdown` 的註解、`:529` 的 warning、`:534` 的註解、`:537-540` 的區域變數 `legacy_lockdown` 和 `legacy`。
  - `location_service.py`：`:253` 的 debug log、`:271` `set` 的 docstring。
- 上游 `upstream/main` 還用這個名字 9 次（`device_manager.py` 8 次、`location_service.py` 1 次），iOS 16 那條路和退路都用它。

## 可能的做法

- A. 不改名，改成 `wontfix`：
  - docstring 第一句已經寫它是 DVT 失敗時的退路，`AGENTS.md` 和測試也擋著不讓它被刪。
  - 「Legacy」說的是 `DtSimulateLocation` 比 DVT 舊，沒寫錯。跟 06 號票同一個原則：說明不完整但沒寫錯，就不改。
- B. 照它用的服務取名，跟 `DvtLocationService` 對稱，例如 `DtSimulateLocationService`：
  - 名字不再帶版本的意味，讀名字就知道它用 `DtSimulateLocation`。
  - 要改 14 處、6 個檔案，包含測試和 README。上游還在用舊名字，之後合併上游碰到這幾行都會衝突，`AGENTS.md:16` 的規則也要跟著改寫。
  - 要另外決定「現況」最後列的那些「legacy」註解、log 和變數要不要一起改。
- C. 名字不動，在 `GLOSSARY.md` 的「裝置連線」加詞條：說明 DVT 是主要路徑、`DtSimulateLocation` 是退路，`_Avoid_` 寫明「Legacy」不是指 iOS 16。
  - 不動程式，不影響合併上游。
  - 但讀 code 的人不一定會去看 `GLOSSARY.md`。而且 GLOSSARY 現在收的是 WiFi 通道、自動連線這類詞，連 WiFi Tunnel 都標成「實作用語」要避免；DVT、`DtSimulateLocation` 是實作用語。

## 看過、沒列入

- `backend` 裡的「legacy」還有別的意思，跟這個退路無關，選 B 時不要一起改：
  - 舊的 API 格式或相容路徑，例如 `backend/api/device.py:1283`、`backend/main.py:170-185`、`backend/api/location.py:558`。
  - `DvtLocationService` 沒有傳 `dvt_factory` 時的重連路徑（`location_service.py:85`、`:126`、`:159`）。
  - `websockets.legacy`（`backend/locwarp-backend.spec:76-78`）是第三方套件的名字。

## 待 triage 決定

- 選 A、B、C 哪個做法。
- 選 B 的話：
  - 新名字，`DtSimulateLocationService` 只是例子。
  - 「現況」最後列的那些「legacy」註解、log、變數要不要一起改。
  - `AGENTS.md:16` 的規則怎麼改寫：上游還叫 `LegacyLocationService`，合併時要知道兩個名字是同一個東西。
- 選 C 的話：詞條的名字和 `_Avoid_` 怎麼寫。
- `README.md:300`、`README.en.md:300` 把 `LegacyLocationService` 列在 pymobiledevice3 的「iOS 裝置協議」裡。它其實是 LocWarp 自己的類別，pymobiledevice3 的服務叫 `DtSimulateLocation`。選 B 時會碰到這兩行，要不要順便改成 `DtSimulateLocation`；不選 B 的話，要不要另外處理。
- 測試：選 B 是改名不改行為，`test_dvt_location_fallback.py` 跟著改名，它會鎖住 DVT 失敗時拿到的是改名後的類別。選 A、C 不用改測試。

## Comments

- 2026-11-08：從 06 號票 2026-11-08 triage 的「看過、沒列入」開出來的。開票時對過：
  - 用到這個名字的 14 處：`git grep -n LegacyLocationService -- ':!.scratch'`。
  - 名字的歷史：`git log -S "class LegacyLocationService" -- backend` 只找到 `578ce35`（v0.1.0），那一版的 docstring 寫「for iOS < 17 devices」。
  - 上游：`git grep -c LegacyLocationService upstream/main -- backend tests`，`device_manager.py` 8 次、`location_service.py` 1 次。
  - `tests/device/test_dvt_location_fallback.py` 在 `90c552d` 印 `all ok`，結束碼 0。之後的 `116d357` 只改了 `.scratch`。
