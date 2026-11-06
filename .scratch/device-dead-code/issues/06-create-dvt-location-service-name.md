# 06 裝置連線：`_create_dvt_location_service` 在 DVT 失敗時回傳 `LegacyLocationService`，名字只講了一半

Status: needs-triage
Blocked by: (none)
Type: task
相關：`.scratch/device-dead-code/issues/03-dvt-location-service-leftovers.md` 的 Comments。03 號票實作後兩個 session 的 review 都提到這點，03 號票沒討論過這個名字，所以另開這張。

## 為什麼

`_create_dvt_location_service` 的名字說它建立 DVT 的定位服務。但 DVT 失敗時，它回傳的是 `LegacyLocationService`。

- 03 號票第 1 節把回傳型別從 `-> DvtLocationService` 改成 `-> LocationService`。型別對了以後，名字跟回傳的東西對不上就更明顯。
- 跟 03 號票第 4 節的 `_ensure_` 不完全一樣：`ensure` 講的是一件根本沒做的事。這個名字講的是主要路徑，只是沒講退回。

現在不會造成錯誤，但讀名字的人會以為 iOS 17+ 一定拿到 DVT。

下面的行號都是 `0d45549` 時的位置，開票時逐一對過。動手前以內容為準，先用 grep 再對一次。

## 現況

- 定義：`backend/core/device_manager.py:578`。
  - docstring（`:581-585`）第一句寫「Spin up a DVT provider and hand it to ``DvtLocationService``」，第二段寫 DVT 失敗時退回 ``LegacyLocationService``。
  - 回傳型別是 `-> LocationService`（`:580`），03 號票第 1 節改的。
- 用到這個名字的地方，repo 裡（不含 `.scratch`）只有三處：
  - `:426`：唯一的呼叫端 `get_location_service`，`ver >= (17, 0)` 時呼叫。
  - `:578`：定義。
  - `:445`：`_check_personalized_ddi_mounted` 的 docstring 說呼叫端是 ``_create_dvt_location_service``。
- iOS 16 那支是 `_create_legacy_location_service`（`:628`），名字和回傳型別 `-> LegacyLocationService` 都對。
- `get_location_service` 的 docstring（`:408`）寫「iOS 17+ -> ``DvtLocationService``」。03 號票「看過、沒列入」判定它沒寫錯：寫的是依 iOS 版本走哪條主要路徑。
- 歷史：
  - 名字從 v0.1.0（`578ce35`）就是這樣，那時只會回傳 DVT。
  - v0.1.34（`accfd76`）加了退回 Legacy，名字沒跟著改。
- 測試：`tests/device/test_dvt_location_fallback.py` 從 `get_location_service` 進去，改名不用改測試，它也會鎖住 DVT 失敗時退回 Legacy。

## 可能的做法

- A. 不改名，改成 `wontfix`：
  - 名字講的是主要路徑，退回已經寫在 docstring，回傳型別也寫了 `LocationService`。
  - 跟 03 號票「看過、沒列入」裡 `:408` 的理由一樣。
- B. 依 iOS 版本取名，例如 `_create_ios17_location_service`：
  - 跟呼叫端 `ver >= (17, 0)` 的分支對上，不管回傳哪一種都對。
  - 要另外決定 iOS 16 那支要不要一起改成 `_create_ios16_location_service`。它現在的名字沒錯，一起改只是為了對稱。
- C. 名字寫出兩條路，例如 `_create_dvt_or_legacy_location_service`：讀名字就知道會退回，但名字很長。

選 B 或 C 時，三處要一起改，包含 `:445` 的 docstring。`.scratch` 裡的舊名字是歷史紀錄，不改。

## 看過、沒列入

- `_check_personalized_ddi_mounted` 不回傳結果，卻會廣播事件，跟一般人對「check」的預期不同。這是另一個 session 的 review 提的。
  - 這個名字是 2026-11-07 使用者在 03 號票 triage 時定的（03 號票「定案」第 4 節），不重開。
- 同函式三處包 `broadcast` 的 `try/except` 一模一樣（`:463-467`、`:496-500`、`:508-512`）。這是兩個 session 的 review 都提到的 Duplicated Code。
  - 03 號票第 3 節規定外面的 `try/except` 要跟另外兩處一樣留著。這張只談名字，不列入。

## 待 triage 決定

- 選 A、B、C 哪個做法；選 B 的話，iOS 16 那支要不要一起改。
- 選 B 或 C 時，`:408` 的 docstring 要不要跟著看。03 號票判定它沒寫錯。
- 測試：改名不改行為，`test_dvt_location_fallback.py` 已經從 `get_location_service` 進去。選 B 或 C 的話，驗收用 `git grep` 確認舊名字找不到（不含 `.scratch`），加上這支測試和 import 檢查。
- 定案後補「要改」、「驗收」、「不做」，再改成 `ready-for-agent`；選 A 就改成 `wontfix`。

## Comments

- 2026-11-07：從 03 號票實作後的 review 開出來的。兩個 session 的 Standards review 都把它列成「可能是 Mysterious Name」。開票時重新對過：
  - 用到這個名字的三處：`:426`、`:445`、`:578`。
  - `:581-585` 的 docstring 和 `:580` 的回傳型別。
  - `_create_legacy_location_service` 的名字、回傳型別和 docstring。
  - 歷史：`git describe --tags --contains` 是 `578ce35` → v0.1.0、`accfd76` → v0.1.34。`578ce35` 裡已經有 `_create_dvt_location_service`，型別是 `-> DvtLocationService`。`accfd76` 裡已經有「Falling back to legacy」的 warning。
