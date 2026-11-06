# 03 裝置連線：02 號票「不做」留下的四項程式碼小問題（回傳型別、走不到的分支、沒人讀的 hint、ensure 改名）

Status: needs-triage
Blocked by: (none)
Type: task
相關：`.scratch/device-dead-code/issues/02-fix-stale-device-manager-comments.md` 的「不做」。02 號票只改說明文字，這四項都是程式碼變更，所以當時寫了「留給之後的票」，但沒有開票。另一個 session 審 02 號票的實作時指出這件事：它們埋在一張已關閉的票裡，之後掃還沒做完的票時會漏掉。

## 為什麼

四項都在 `backend/core/device_manager.py` 的 `_create_dvt_location_service` 和 `_ensure_personalized_ddi_mounted` 附近，都是程式碼跟實際行為對不上，或是留著沒有用：

- 型別標錯（第 1 節）。
- 一段永遠走不到的錯誤處理（第 2 節）。
- 後端送出、前端從 v0.2.96 起就不讀的欄位（第 3 節）。
- 函式名稱說會掛載，其實只檢查（第 4 節）。

現在都不會造成錯誤，但會誤導讀 code 的人。

下面的行號都是 `9cd9b56` 時的位置。

## 1. `_create_dvt_location_service` 的回傳型別 `-> DvtLocationService`（`:586`）

- DVT 失敗時，`:633` 退回的是 `LegacyLocationService`。
- 兩個都是 `LocationService` 的子類（`backend/services/location_service.py:52`、`:70`、`:234`），彼此沒有繼承關係，所以這個型別標錯了。
- 唯一的呼叫端是 `get_location_service`（`:426`），它自己標的是 `-> LocationService`。改成 `-> LocationService` 不影響呼叫端。
- 02 號票第 3 節的新 docstring 寫著「退回 `LegacyLocationService`」，跟這個型別放在一起就看得出矛盾。

## 2. `:636-640` 走不到的「Both DVT and legacy location services failed」分支

- 退回 Legacy 的 `try:` 裡只有兩件事：
  - `conn.usbmux_lockdown or conn.lockdown`
  - `LegacyLocationService(legacy_lockdown)`
- `LegacyLocationService.__init__`（`location_service.py:244-247`）只存三個欄位，不會丟例外。`DtSimulateLocation` 要等到 `_ensure_service`（`:249`）才建立。
- 所以 `except Exception:`、`logger.exception(...)` 和 `raise dvt_exc` 現在都走不到。錯誤要到真的送位置時才會出現。
- 待決定：
  - 拿掉 `try/except`。
  - 或是留著當防呆，以防 `__init__` 之後改成會丟例外。

## 3. `ddi_not_mounted` 附的 `hint`（`:512-515`）

- 後端在 `:510` 廣播 `ddi_not_mounted`，附 `udid` 和一段中文 `hint`。
- repo 裡唯一收這個事件的是前端 `frontend/src/hooks/useSimulation.ts:578-588`。
  - v0.2.96（`3fe4d69`）起，它只關掉進度遮罩，payload 完全不讀，`hint` 和 `udid` 都沒用到。
  - `git grep ddi_not_mounted` 沒有別的消費端，手機網頁控制也沒有。
- 同一段意思在 `:503-507` 有英文 warning log。
- 待決定：
  - 拿掉 `hint`，只送 `udid`。
  - 或是留給以後可能的 UI 用。
- 不論選哪個，事件本身都要留，前端靠它關掉進度遮罩。

## 4. `_ensure_personalized_ddi_mounted` 改名（`:432`）

- 名字裡的 `ensure` 看起來像會掛載。v0.2.58（`051de0e`）起，它只檢查。
- 02 號票第 3 節在 `:592-593` 加了一段註解來補這件事。審 02 號票實作的 review 指出：那段註解重寫了被呼叫函式的事件名稱 `ddi_not_mounted`，被呼叫的函式一改，這裡又會過時。改名之後，那段註解可以拿掉或縮短。
- 呼叫端只有 `:595`。改名候選：`_check_personalized_ddi_mounted`。
- `_ensure_classic_ddi_mounted`（`:520`）真的會掛載，名字是對的，不要一起改。

## 看過、沒列入

兩處說明都寫得不完整，但沒有寫錯，比照 02 號票「不做」裡 `:108` 的理由，不列入：

- `:108` `usbmux_lockdown` 的註解「for legacy fallback on iOS 17+」：iOS 16 的 `_connect_legacy` 和 `backend/api/device.py` 的 AMFI 也會用到這個欄位。
- `location_service.py:236` `LegacyLocationService` 的 docstring「for iOS < 17 devices」：它也是 iOS 17+ DVT 失敗時的退回（`device_manager.py:633`）。

## 待 triage 決定

- 第 1-4 節要做哪幾項。可以一張票做完，或拆開。
- 第 2、3 節各選哪個做法。
- 測試：
  - 第 1、4 節不改行為。
  - 第 2 節拿掉的是走不到的程式碼。
  - 第 3 節會改後端送出的內容。
  - 要不要、能不能寫出 mutation check 抓得到的測試，定案時再看。
- 定案後補「要改」、「驗收」、「不做」，再改成 `ready-for-agent`。

## Comments

- 2026-11-07：從另一個 session 對 02 號票實作的 review 開出來的。四項的現況都重新對過程式碼：
  - 呼叫端。
  - `LegacyLocationService.__init__`。
  - 前端 `ddi_not_mounted` 的處理。
  - `ddi_not_mounted` 的所有消費端。
