# 03 裝置連線：02 號票「不做」留下的四項程式碼小問題（回傳型別、走不到的分支、沒人讀的 hint、ensure 改名）

Status: resolved
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

另外新增一支測試（第 5 節），鎖住第 1-4 節都不能改變的兩個行為。現在沒有任何測試涵蓋 `_create_dvt_location_service`。

下面的行號都是 `9cd9b56` 時的位置。triage 定案時，`9cd9b56` 之後只改過 `.scratch`，程式碼的行號仍然正確。第 2、3、4 節會改變行數，改完後後面的行號會移動。動手前和驗收時都以內容為準，先用 grep 再對一次。

## 1. `_create_dvt_location_service` 的回傳型別 `-> DvtLocationService`（`:586`）

現況：

- DVT 失敗時，`:633` 退回的是 `LegacyLocationService`。
- 兩個都是 `LocationService` 的子類（`backend/services/location_service.py:52`、`:70`、`:234`），彼此沒有繼承關係，所以這個型別標錯了。
- 唯一的呼叫端是 `get_location_service`（`:426`），它自己標的是 `-> LocationService`。改成 `-> LocationService` 不影響呼叫端。
- 02 號票第 3 節的新 docstring 寫著「退回 `LegacyLocationService`」，跟這個型別放在一起就看得出矛盾。
- 歷史：v0.1.0（`578ce35`）就是這樣標的，那時只會回傳 DVT。v0.1.34（`accfd76`）加了退回 Legacy，型別從那時就不對了。

要改：

- `:586` 改成 `    ) -> LocationService:`。
- `LocationService` 已經在檔案開頭 import 了（`:35-40`，`get_location_service` 也在用）。
- `DvtLocationService` 的 import 要留：`:614` 還會建立它。

## 2. `:636-640` 走不到的「Both DVT and legacy location services failed」分支

現況：

- 退回 Legacy 的 `try:`（`:629-635`）裡有四個敘述，都不會丟例外：
  - `legacy_lockdown = conn.usbmux_lockdown or conn.lockdown`：`pymobiledevice3` 的 lockdown 類別都沒定義 `__bool__`、`__len__`，`or` 不會丟例外。
  - `LegacyLocationService(legacy_lockdown)`：`__init__`（`location_service.py:244-247`）只存三個欄位。`DtSimulateLocation` 要等到 `_ensure_service`（`:249`）才建立。
  - `logger.info(...)`：handler 出錯時，logging 交給 `handleError` 印到 stderr，不會丟到呼叫端。
  - `return legacy`。
- 所以 `except Exception:`、`logger.exception(...)` 和 `raise dvt_exc` 都走不到。錯誤要到真的送位置時才會出現。
- 歷史：`LegacyLocationService.__init__` 從 v0.1.0（`578ce35`）起就是這樣。這段退回是 v0.1.34（`accfd76`）加的，所以這個分支從寫下來那天就走不到。

定案：拿掉 `try/except`。

- 留著當防呆的效果很小。就算以後 `__init__` 改成會丟例外，這時還在 `except Exception as dvt_exc:` 區塊裡，Python 會把 DVT 的例外記成新例外的 `__context__`，traceback 兩個都看得到。差別只在呼叫端最後收到哪一個例外。
- 留著反而讓人以為錯誤會在這裡出現。

要改：

- 拿掉 `:629` 的 `try:` 和 `:636-640` 的整段 `except`。`:630-635` 往左縮一層（4 個空格），內容不變。
- `:626-628` 的註解只改 `:628` 這一行：`try the legacy service before giving up entirely.` 改成 `use the legacy service instead.`。拿掉 `try/except` 後，這裡就沒有放棄的路了。
  - `:626-627` 說 iOS 17+ 有些裝置還有 `com.apple.dt.simulatelocation` 的理由，一字不動。
  - `:630-631` 的「Prefer the original usbmux…」註解只往左縮，一字不動。
- 不要在這裡加註解，說 Legacy 要到第一次 `set()` 才開 `DtSimulateLocation`：這是 `LegacyLocationService` 自己的行為，`_ensure_service` 的 docstring 已經寫了「Lazily create」。
- 參考寫法，照抄，包含註解。驗收的範圍檢查（`628-640`；加 `-w` 只能有 `628`、`629`、`636-640`）是照這個寫法算的，改了別行的字就會超出範圍：

```python
        except Exception as dvt_exc:
            logger.warning(
                "DVT location service failed for %s (%s). Falling back to "
                "legacy DtSimulateLocation over lockdown.",
                conn.udid, dvt_exc,
            )
            # iOS 17+ still exposes com.apple.dt.simulatelocation on some
            # devices (reported working on iOS 26 by multiple users), so
            # use the legacy service instead.
            # Prefer the original usbmux/TCP lockdown for DtSimulateLocation;
            # fall back to whatever we have stored if not available.
            legacy_lockdown = conn.usbmux_lockdown or conn.lockdown
            legacy = LegacyLocationService(legacy_lockdown)
            logger.info("Using LegacyLocationService fallback for %s", conn.udid)
            return legacy
```

## 3. `ddi_not_mounted` 附的 `hint`（`:512-515`）

現況：

- 後端在 `:510` 廣播 `ddi_not_mounted`，附 `udid` 和一段中文 `hint`。
- repo 裡唯一收這個事件的是前端 `frontend/src/hooks/useSimulation.ts:578-588`。
  - v0.2.96（`3fe4d69`）起，它只關掉進度遮罩，payload 完全不讀，`hint` 和 `udid` 都沒用到。
  - `git grep ddi_not_mounted` 沒有別的消費端。`broadcast`（`backend/api/websocket.py:16`）只是把同一則訊息送給所有連線，手機網頁控制的 `backend/static/phone.html` 也不處理這個事件。
- 同一段意思在 `:503-507` 有英文 warning log。
- 文件：`README.md`、`README.en.md` 的 `:233`（步驟 4）和 `:260`（疑難排解表）都跟使用者說，LocWarp 會提示「iPhone 上未偵測到 DDI」（英文版是「No DDI detected」）。
  - 這個說法最早是 `dd684ee` 寫的。它跟 v0.2.58 同一天，第一個包含它的 tag 是 v0.2.64。那時前端會把 `hint` 用 `setError` 顯示出來（v0.2.58，`051de0e`）。
  - v0.2.96（`3fe4d69`）拿掉顯示後，這幾段就不對了。現在 `:233`、`:260` 的字和英文版，是 v0.2.198 的 README 重寫（`73e3b42`）寫的，沿用了這個說法。
  - 第 3 節做完後，repo 裡就沒有任何地方會送出這段字。這張不改 README，開成 05 號票，見「不做」。

定案：拿掉 `hint`，只送 `udid`。

- 以後如果 UI 要顯示，文字應該放在前端的 i18n 字串表（`frontend/src/i18n/strings.ts`，中英兩種）。後端寫死的中文沒辦法切換語言，留著也用不上。
- 事件本身要留，前端靠它關掉進度遮罩。第 5 節的 (b) 鎖的就是這件事。

要改：

- `:510-516` 的 `broadcast` 改成一行，照抄，驗收會搜這一行：

```python
            await broadcast("ddi_not_mounted", {"udid": conn.udid})
```

- 外面的 `try:` / `except Exception: pass`（`:508-509`、`:517-518`）留著，跟同函式兩處 `ddi_mounted` 的廣播一樣。
- `:503-507` 的英文 warning 不動。前端和 README 不動。
- 這是唯一改變行為的一節：前端收到的 `ddi_not_mounted` payload 少了 `hint`。repo 裡沒有消費端讀它，見現況。

## 4. `_ensure_personalized_ddi_mounted` 改名（`:432`）

現況：

- 名字裡的 `ensure` 看起來像會掛載。v0.2.58（`051de0e`）起，它只檢查。
- 02 號票第 3 節在 `:592-593` 加了一段註解，在名字改掉之前先補這個洞。02 號票的 Comments 記著：根本解是改名，改名後這段註解可以拿掉。
  - 審 02 號票實作的 review 另外說，這段註解重寫了事件名稱 `ddi_not_mounted`，會過時。02 號票沒採納這點：事件名稱是 02 號票第 3 節規定要寫的，事件改名時 `git grep ddi_not_mounted` 也找得到這裡。這張拿掉註解不是因為這個理由。
- repo 裡（不含 `.scratch`）只有 `:432` 的定義和 `:595` 的呼叫用到這個名字。

定案：改名成 `_check_personalized_ddi_mounted`，拿掉 `:592-593` 的註解。

要改：

- `:432` 的定義和 `:595` 的呼叫一起改名。
- 拿掉 `:592-593` 兩行註解：
  - 改名後「Despite the name」就不對了，所以要整段拿掉，不是縮短。
  - 剩下的意思已經在名字和 docstring 裡：docstring 第一句是「Check whether the Personalized DDI is mounted」，也寫了 v0.2.58 起不再掛載。
  - 這跟 02 號票人工核對的「第 3 節的 `try:` 上方還有註解，說明只檢查、不掛載」相反。那段註解是在名字改掉之前先補洞，02 號票的「不做」和 Comments 已經寫了根本解是改名，這裡拿掉是照原本的打算。
- 不動：
  - 這個函式的 docstring（02 號票第 4 節剛改好）。
  - `:597` 的 warning「DDI status check failed; DVT may still fail」。
  - `.scratch` 裡的舊名字，那些是歷史紀錄。
  - `_ensure_classic_ddi_mounted`（`:520`）：它真的會掛載，名字是對的。
- 改完後，`_create_dvt_location_service` 的 docstring 結尾到 warning 會是：

```python
        """
        try:
            await self._check_personalized_ddi_mounted(conn)
        except Exception:
            logger.warning("DDI status check failed; DVT may still fail", exc_info=True)
```

## 5. 新增 `tests/device/test_dvt_location_fallback.py`

現況：

- 沒有測試涵蓋 `_create_dvt_location_service`。
- `tests/device` 原有三支：
  - `test_wifi_skip_connected.py`、`test_wifi_tunnel_parallel_start.py` 從 `api.device` 進去，把 device manager 換成假的。
  - `test_wifi_tunnel_runner.py` 直接測 `core.wifi_tunnel.TunnelRunner`，換掉 `pymobiledevice3.remote.tunnel_service` 模組上的屬性。新測試照這支的做法：用真的 `DeviceManager`，換掉它用到的模組屬性。

要改：

- 寫法照 `tests/device` 現有的測試：
  - 一般的 Python 程式，不用 pytest。跑法：`.venv/Scripts/python.exe tests/device/test_dvt_location_fallback.py`。
  - 每項檢查用 `assert`，過了印 `ok  ...`，最後印 `all ok`。
  - 檔案開頭的 docstring 寫：鎖住什麼、為什麼；這張票的路徑；跑法；哪些是假的，不連網、不接手機。
- 從 `DeviceManager.get_location_service(udid)` 進去，不要直接呼叫 `_create_dvt_location_service` 或 DDI 檢查函式：
  - 這樣第 4 節改名不用改測試。
  - 測到的也是 `backend/main.py` 實際走的入口。
  - 建一個 `DeviceManager()`，把 `ios_version` 為 17 以上的 `_ActiveConnection` 放進 `_connections`。
- 換成假的。triage 時在暫存區試跑過，不接手機就能跑到這兩條路：
  - `core.device_manager.DvtProvider`：`__init__` 收一個位置參數（lockdown），async 的 `__aenter__` 丟例外，模擬 DVT 失敗。
  - `pymobiledevice3.services.mobile_image_mounter` 模組上的 `MobileImageMounterService`。它是在函式裡才 import 的，所以要換模組上的屬性。假的要有：
    - 收 `lockdown=` 關鍵字參數的 `__init__`。
    - async 的 `connect()`、`close()`。
    - async 的 `is_image_mounted(...)`，回傳 `False`。
  - `api.websocket` 模組上的 `broadcast`：記下送出的事件。同樣是在函式裡才 import。
  - lockdown 用沒有 `peer_info` 的假物件，讓 DDI 檢查走 `MobileImageMounterService` 那條路。
- 假的 `MobileImageMounterService` 少了 `lockdown=` 或 `connect()`，錯誤不會丟到測試這裡：`:490` 的 `except Exception` 會吞掉，只記 warning 就返回，不廣播。結果是 (b) 在重構前就紅。遇到這種情況先查假物件，不是查邏輯。
- 兩項檢查，可以共用同一次 `get_location_service` 呼叫，但要分開 `assert` 和印 `ok`：
  - (a) DVT 失敗時，`get_location_service` 回傳 `LegacyLocationService`。鎖的是第 2 節重構後必須保持的退回。
  - (b) DDI 沒掛好時，照樣廣播 `ddi_not_mounted`，payload 的 `udid` 是這台的 UDID。鎖的是第 3 節的「事件本身要留」，前端靠它關掉進度遮罩。
    - 只檢查 `udid`，不要檢查 payload 剛好等於 `{"udid": ...}`。那樣以後加任何合理的欄位都會紅，鎖的是寫法，不是意圖。
    - `hint` 有沒有拿掉，由驗收的 grep 檢查。
- 這兩項在現在的程式碼上就會過：它們鎖的是第 1-4 節都不能改變的行為。所以要先單獨 commit，證明重構前就是綠的，見驗收的 commit 切法。

## 要留

- 第 2 節：DVT 失敗的 warning（`:621-625`）和 `:634` 的 info log，文字都不動。`except Exception as dvt_exc:` 的 `dvt_exc` 還用在 warning 裡。
- 第 3 節：`ddi_not_mounted` 事件本身，和 `:503-507` 的英文 warning。
- 第 4 節：`_check_personalized_ddi_mounted` 的 docstring，和 `:597` 的 warning 文字。

## 驗收

- 搜尋用 `git grep -n -e <詞> -- ':!.scratch'`，要分大小寫。以下都要找不到：
  - `_ensure_personalized_ddi_mounted`
  - `Despite the name`
  - `Both DVT and legacy location services failed`
  - `raise dvt_exc`
  - `before giving up entirely`
  - `-> DvtLocationService`：開頭是 `-`，一定要用 `-e`。
  - `iPhone 上未偵測到 DDI`：`hint` 的文字，只搜 `backend`。`README.md:233` 也有這段字，那是 05 號票的範圍。
  - `'"hint"'`，只搜 `backend`。`9cd9b56` 時 `backend` 裡只有 `:512` 這一處。
- 以下要剛好找到指定的處數：
  - `_check_personalized_ddi_mounted`：2 處，都在 `backend/core/device_manager.py`，一處是 `async def`，一處是 `await self.`。
  - `git grep -n -F 'await broadcast("ddi_not_mounted", {"udid": conn.udid})' -- backend`：1 處。
  - `git grep -n ddi_not_mounted -- backend`：2 處，就是上面那行和 `_check_personalized_ddi_mounted` docstring 裡的那處。
  - `git grep -n -e '^    ) -> LocationService:' -- backend/core/device_manager.py`：1 處，在 `async def _create_dvt_location_service(` 往下第 2 行。
    - 要有 `^` 和開頭的四個空格：`get_location_service` 那行也包含 `) -> LocationService:`，但開頭是 `    async def`。
    - 不要加 `$`：工作目錄是 CRLF 時，行尾的 `\r` 會讓 `$` 對不到。`git grep` 也沒有 `-x`，git 2.43 會報 `unknown switch 'x'`。
  - `"DDI status check failed; DVT may still fail"`：1 處。
  - `Using LegacyLocationService fallback for %s`：1 處。
- 改動範圍：
  - `git diff 9cd9b56 --stat -- ':!.scratch'` 只能有 `backend/core/device_manager.py` 和新的 `tests/device/test_dvt_location_fallback.py`。
  - `git diff 9cd9b56 -U0 -- backend/core/device_manager.py` 的每個 hunk，舊行範圍（`@@ -a,b` 的第 a 行到第 a+b-1 行）都要落在下面這些範圍裡，而且每一節都要有改到：
    - 第 4 節：`432`、`592-593`、`595`。
    - 第 3 節：`510-516`。
    - 第 1 節：`586`。
    - 第 2 節：`628-640`。
    - b 是 0 的純新增，新內容接在第 a 行後面，第 a 行要在上面的範圍裡，或是某個範圍的前一行。
  - 不要用 hunk 數來驗，hunk 數會跟著改寫的行數變。
  - 第 2 節只能是縮排變化：`git diff 9cd9b56 -w -U0 -- backend/core/device_manager.py` 裡，第 2 節的舊行範圍只能有 `628`、`629`、`636-640`。`630-635` 出現的話，就是除了縮排還改了別的。
  - 改到的內容只能是：第 1 節的型別、第 2 節拿掉的 `try/except` 和縮排、第 3 節的 payload、第 4 節的改名，加上第 2 節 `:628` 改的註解和第 4 節拿掉的註解。
- import：每個實作 commit 單獨跑 `.venv/Scripts/python.exe -I -c "import sys; sys.path.insert(0, 'backend'); import core.device_manager"`，都要成功。
  - 這一步要另外跑：`tests/device` 原有的三支都不會在載入時 import `core.device_manager`（`api.device` 是在函式裡才 import，`test_wifi_tunnel_runner.py` 完全不用它），跑測試不一定會載入它。
- 新測試：每個實作 commit 單獨跑 `.venv/Scripts/python.exe tests/device/test_dvt_location_fallback.py`，都要印 `all ok`、結束碼 0。第一個 commit 只加測試，跑的是重構前的程式碼。
- mutation check：在最後的程式碼上做，一次改一處，做完還原，`git diff` 要回到乾淨：
  - M1：把第 2 節的 `return legacy` 換成 `raise dvt_exc`。新測試要失敗，(a) 不能印 `ok`。
  - M2：把第 3 節那行 `await broadcast("ddi_not_mounted", ...)` 換成 `pass`。新測試要失敗，(b) 不能印 `ok`。
  - 兩項的結果都記到 Comments。
- 現有測試都要過，而且 0 skipped：
  - 前端：在 repo 根目錄跑 `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"`（`tests/frontend/test_defaults.ts` 開頭寫的跑法）。
  - 後端：`tests/device/` 四支（含新的一支）、`tests/launcher/` 一支、`tests/pipi/` 的 `test_*.py`，加上 `node tests/pipi/test_extension.js`。
  - `tests/pipi/check_live_anonymous.py` 會連到真網站，不用跑，但要寫明沒跑。
- 人工核對 grep 驗不到的：
  - 第 2 節：`except Exception as dvt_exc:` 區塊裡沒有 `try:`。註解跟參考寫法一字不差：沒有「giving up」，也沒有說 Legacy 要到 `set()` 才開 `DtSimulateLocation`。
  - 第 3 節：`frontend/src/hooks/useSimulation.ts` 沒動。
  - 第 4 節：`try:` 上方沒有註解，docstring 沒動。
  - 新測試：從 `get_location_service` 進去；(b) 沒有檢查 payload 剛好等於某個 dict；docstring 照現有測試的格式。
- Commit：
  - 開票和 triage 用 `.scratch:`。
  - 實作用 `裝置連線:`，依原因分四個 commit，照下面的順序：
    1. 新增 `test_dvt_location_fallback.py`。commit 訊息寫明：鎖住「DVT 失敗退回 Legacy」和「DDI 沒掛好照樣廣播 `ddi_not_mounted`」，給後面三個 commit 當護欄。
    2. 第 1、2 節：都是 v0.1.34（`accfd76`）加入退回 Legacy 時留下的。commit 訊息要寫到兩件事：
       - 型別從那時就標錯。
       - 「兩個都失敗」的分支從寫下來就走不到，因為 `LegacyLocationService.__init__` 從 v0.1.0 起就不會丟例外。
    3. 第 3 節：`hint` 從 v0.2.96（`3fe4d69`）起沒人讀。這是唯一改變後端送出內容的 commit，分開才能單獨 revert。
    4. 第 4 節：v0.2.58（`051de0e`）起只檢查、不掛載。改名後，`:592-593` 那段補洞的註解跟著拿掉。
  - 結果用 `.scratch:`。

## 不做

- 測試 Legacy 用的是 `usbmux_lockdown`（`conn.usbmux_lockdown or conn.lockdown`）：
  - 要測就得讀 `LegacyLocationService._lockdown` 這個私有欄位，或是再換掉 `DtSimulateLocation`、呼叫 `set()`。
  - 第 2 節只改這一行的縮排，驗收的 `-w` 範圍檢查就驗得到。
- 在呼叫端加註解，說明 Legacy 要到第一次 `set()` 才開 `DtSimulateLocation`：理由見第 2 節。
- 退回時先試開 `DtSimulateLocation`，確定能用才回傳：這是改行為，不是清理。
- 前端 `useSimulation.ts:579-585` 註解裡的「we no longer surface the hint as a banner」：
  - 拿掉 `hint` 之後，payload 裡就沒有這個欄位了。但這句是在說前端以前會顯示、現在不顯示，用來解釋為什麼這裡什麼都不顯示，意思還是對的。
  - 改它要動前端，超出這張只改後端的範圍。
- README 說 LocWarp 會提示「未偵測到 DDI」（`README.md`、`README.en.md` 的 `:233`、`:260`），見第 3 節現況：
  - 改 README 是改使用者看得到的說明，要另外決定該寫使用者實際會看到什麼。
  - 這張只改後端，第 3 個 commit 才能單獨 revert。
  - 開成 05 號票（`.scratch/device-dead-code/issues/05-readme-ddi-not-mounted-prompt.md`）。
- 同一類「前後端對不上」、但在 iOS 16 classic DDI 和前端進度 UI 那邊的兩處，開成 04 號票（`.scratch/device-dead-code/issues/04-ddi-mount-event-payload-mismatch.md`）：
  - 前端處理 `ddi_mounting` 時會讀 `stage`、`elapsed`（`useSimulation.ts:564-571`，畫在 `frontend/src/App.tsx:2238-2277`）。
    - 後端送這兩個欄位的地方在 v0.2.58（`051de0e`）跟著 personalized DDI 自動掛載一起拿掉了。
    - 現在唯一送 `ddi_mounting` 的 `:562` 只帶 `udid`。
  - `ddi_mount_failed` 帶的 `error`（`:579`），前端沒有讀（`useSimulation.ts:572-577` 只關掉進度遮罩）。

## 看過、沒列入

四處說明都寫得不完整，但沒有寫錯，比照 02 號票「不做」裡 `:108` 的理由，不列入：

- `:108` `usbmux_lockdown` 的註解「for legacy fallback on iOS 17+」：iOS 16 的 `_connect_legacy` 和 `backend/api/device.py` 的 AMFI 也會用到這個欄位。
- `location_service.py:236` `LegacyLocationService` 的 docstring「for iOS < 17 devices」：它也是 iOS 17+ DVT 失敗時的退回（`device_manager.py:633`）。
- `:408` `get_location_service` 的 docstring「iOS 17+ -> ``DvtLocationService``」：DVT 失敗時回傳的是 `LegacyLocationService`。
  - 跟第 1 節不一樣：第 1 節的型別是對呼叫端的保證，標錯就是錯。這裡寫的是依 iOS 版本走哪條主要路徑。
  - 退回 Legacy 已經寫在 `_create_dvt_location_service` 的 docstring（02 號票第 3 節）。
- `location_service.py:56-58` `LocationService` 的 docstring：DVT 對 iOS 17+，`DtSimulateLocation` 對 iOS < 17。理由跟 `:236`、`:408` 一樣。

## 定案

2026-11-07 triage 時由使用者決定：

- 第 1-4 節都做，放在同一張票，依原因分 commit。
- 第 2 節：拿掉 `try/except`。
- 第 3 節：拿掉 `hint`，只送 `udid`。
- 第 4 節：改名成 `_check_personalized_ddi_mounted`，拿掉 `:592-593` 的註解。
- 測試：新增 `test_dvt_location_fallback.py`，兩項檢查，見第 5 節。
- 2026-11-07 第二次 review 後：README 不併進這張，開成 05 號票。

## Comments

- 2026-11-07：從另一個 session 對 02 號票實作的 review 開出來的。四項的現況都重新對過程式碼：
  - 呼叫端。
  - `LegacyLocationService.__init__`。
  - 前端 `ddi_not_mounted` 的處理。
  - `ddi_not_mounted` 的所有消費端。
- 2026-11-07 triage：照使用者的決定定案，改成 `ready-for-agent`。

  > *This was generated by AI during triage.*

  - 重新對過的內容：
    - 票上的行號都在 `9cd9b56` 對過；`9cd9b56` 之後只改過 `.scratch`，程式碼沒動。
    - 四項都還沒做。repo 裡沒有 `.out-of-scope/`，沒有之前拒絕過的類似需求。
    - 第 3 節：`broadcast` 只是把同一則訊息送給所有連線，`phone.html` 不處理 `ddi_not_mounted`，所以 `hint` 確實沒人讀。
  - 更正：第 2 節原本寫退回 Legacy 的 `try:` 裡「只有兩件事」，實際上還有 `logger.info(...)` 和 `return`。這兩個也不會丟例外，結論不變。
  - 補上歷史：型別和「兩個都失敗」的分支，都是 v0.1.34（`accfd76`）加入退回 Legacy 時留下的；`LegacyLocationService.__init__` 從 v0.1.0 起就不會丟例外。
  - 在暫存區用假的 `DvtProvider`、`MobileImageMounterService`、`broadcast` 試跑過，不接手機就能跑到「退回 `LegacyLocationService`」和「廣播 `ddi_not_mounted`」。第 5 節的測試就是照這個做法寫的。
  - 順便發現的兩處：前端會讀 `ddi_mounting` 的 `stage`、`elapsed`，但後端已經不送；`ddi_mount_failed` 帶的 `error` 前端不讀。在別的區域，記在「不做」，之後另開票。
  - 寫完後，把四節的參考寫法套在 `9cd9b56` 版 `device_manager.py` 的暫存副本上試跑驗收：
    - `-U0` 的舊行範圍是 `432`、`510-516`、`586`、`592-593`、`595`、`628-640`。加 `-w` 後，第 2 節只剩 `628-629`、`636-640`。
    - 「找不到」的 8 個詞都找不到。「剛好幾處」的 6 項處數都對，`-x` 那行在 `async def` 往下第 2 行。（這兩句有誤，見下一筆的更正。）
    - 照第 5 節的做法，從 `get_location_service` 進去試跑：重構前和重構後的副本都印 `all ok`。
    - M1 讓 (a) 失敗（`RuntimeError` 往上丟）。M2 讓 (b) 失敗，(a) 照樣 `ok`。
  - 格式：照 02 號票的寫法，把要改、驗收、不做寫在本文，行號以 `9cd9b56` 為準，動手前以內容為準。沒有另寫 Agent Brief 段。
- 2026-11-07 第二次 review：另一個 session 審這張票，提了八點，都對過程式碼和 git 紀錄，全部成立。照使用者的決定全部採納，其中四點照我的修改做。另外補上 review 沒提到的兩處。Status 維持 `ready-for-agent`。

  > *This was generated by AI during triage.*

  - 照寫的跑會失敗，已改：
    - `git grep` 沒有 `-x`（git 2.43 報 `unknown switch 'x'`）。改成 `'^    ) -> LocationService:'`。
      - review 提的寫法多了 `$`。拿參考寫法的副本做成 LF、CRLF 兩份試：加 `$` 時 CRLF 那份找到 0 處；不加 `$` 兩份都是 1 處，重構前的副本 0 處。
      - review 說在 CRLF 的工作目錄試過，但這個 repo 的工作目錄是 LF（`git ls-files --eol` 是 `w/lf`）。
    - `iPhone 上未偵測到 DDI` 在 `README.md:233` 也有，「找不到」那條照寫一定失敗，也跟改動範圍衝突。改成只搜 `backend`，第 3 節現況補上 README，README 開成 05 號票。
      - review 說這幾段是 v0.2.58 時（`dd684ee`）寫的。查過：`dd684ee` 跟 v0.2.58 同一天，第一個包含它的 tag 是 v0.2.64。現在 `:233`、`:260` 的字和英文版，是 `73e3b42`（v0.2.198）重寫的。
  - 互相矛盾，已改：
    - 第 2 節「註解可以改字」跟驗收的範圍檢查衝突。review 建議明寫只有 `:628` 可以改字；這裡改得更嚴：參考寫法照抄，包含註解，`:626-627`、`:630-631` 一字不動。
    - 第 2、4 節把 02 號票沒採納的「會過時」當成拿掉 `:592-593` 註解的理由。第 4 節改成引用 02 號票的結論，第 2 節刪掉那句。
    - 「不做」的行號跟 04 號票不一致，改成 `App.tsx:2238-2277`、`useSimulation.ts:564-571`、`:572-577`。
  - 遺漏，已補：
    - `:408` 和 `location_service.py:56-58` 的 docstring：列進「看過、沒列入」，理由比照 `:236`。
    - 第 5 節的假 `MobileImageMounterService` 要有哪些方法。在暫存區試過：少了 `connect()`，或 `__init__` 不收 `lockdown=`，`:490` 都會把錯誤吞掉，(b) 在重構前就紅。
    - 第 5 節改成引用 `test_wifi_tunnel_runner.py` 當先例。
  - review 沒提到、另外改的：
    - 「不做」的 `useSimulation.ts:579-584` 改成 `579-585`，註解到 `:585` 才結束。
    - 驗收 import 那步的說明：`test_wifi_tunnel_runner.py` 完全不 import `core.device_manager`，不是「在函式裡才 import」。
  - 想過、沒寫進票：本來以為假的 `broadcast` 不是 `async def` 時 (b) 也會紅。試過不會：事件在 `await` 之前就記下了，`await None` 的 `TypeError` 被外面的 `except Exception: pass` 吞掉，(b) 照樣過。
  - 更正上一筆：
    - 「`-x` 那行在 `async def` 往下第 2 行」：當時是在暫存副本上對的，跑的不是票上這條 `git grep` 指令。
    - 「找不到的 8 個詞都找不到」：當時只對了 `device_manager.py` 的暫存副本，沒有對整個 repo 跑，所以沒發現 README 也有。
  - review 核對過、沒問題的部分（`9cd9b56` 的行號、歷史、第 2 節的論證、`ddi_not_mounted` 的消費端、在暫存區的試跑）沒動。
- 2026-11-07：實作完成，照票上的切法分四個 commit：
  - `5514089`：第 5 節的新測試。在重構前的程式碼上印 `all ok`。
  - `ce993e1`：第 1、2 節。
  - `9047e8a`：第 3 節，唯一改變後端送出內容的 commit。
  - `fff1286`：第 4 節。
  - 第 2、4 節：把票上的參考寫法抽出來，跟檔案 `diff`，一字不差。第 2 節的參考寫法下一行是空行。
  - 驗收 grep：
    - 「要找不到」的 8 個詞都找不到。同樣的指令對 `9cd9b56` 跑，每個都找得到，確定 0 處不是指令寫錯。
    - 「剛好幾處」6 項都對：
      - `_check_personalized_ddi_mounted`：`:432` 是 `async def`，`:587` 是 `await self.`。
      - broadcast 那行在 `:510`。`ddi_not_mounted` 在 `:444`（docstring）和 `:510`。
      - `'^    ) -> LocationService:'` 在 `:580`，`async def _create_dvt_location_service(` 在 `:578`。對 `9cd9b56` 是 0 處。
      - warning 在 `:589`，info log 在 `:625`。
  - 範圍：
    - `git diff 9cd9b56 --stat -- ':!.scratch'` 只有 `device_manager.py`（+11/−25）和新測試。
    - `-U0` 的舊行範圍是 `432`、`510-516`、`586`、`592-593`、`595`、`628-640`，四節都有改到。加 `-w` 後，第 2 節只剩 `628-629`、`636-640`。
  - import 和新測試：在暫存區開一個 detached worktree，四個 commit 各自 checkout 出來跑，都 import 成功、印 `all ok`、結束碼 0。
  - mutation check：在最後的程式碼上做，每項做完 `git status` 都是乾淨的。
    - M1（`return legacy` 換成 `raise dvt_exc`）：`RuntimeError: fake DVT failure` 往上丟，結束碼 1，(a) 沒印 `ok`。
    - M2（broadcast 那行換成 `pass`）：(a) 印 `ok`，(b) `AssertionError: []`，結束碼 1。
  - 測試：
    - 通過：前端 95/95（0 skipped）、`tests/device` 4 支（含新的）、`tests/launcher` 1 支、`tests/pipi` 4 支 `test_*.py`、`test_extension.js`。結束碼都是 0。
    - 沒跑：`check_live_anonymous.py`，它會連到真網站。
    - Spec review 在 worktree 裡跑前端，有 2 項失敗。原因是 `test_defaults.ts:104-105` 要用 repo 根目錄的 `.venv`，worktree 裡沒有（`.gitignore`），不是這次改動造成的。主目錄同一份程式碼 95/95。
  - 型別檢查：repo 沒有 Python 型別檢查工具（沒裝 mypy、pyright，也沒有設定檔），沒有另外安裝，改用 import 和新測試。
  - 人工核對清單逐條都過：
    - 第 2 節：`except Exception as dvt_exc:` 區塊裡沒有 `try:`，沒有「giving up」，也沒寫 Legacy 要到 `set()` 才開 `DtSimulateLocation`。
    - 第 3 節：`useSimulation.ts` 沒動。
    - 第 4 節：`try:` 上方沒有註解。docstring 不在任何 hunk 的範圍內，沒動。
    - 新測試：從 `get_location_service` 進去；(b) 只看 `ddi_not_mounted` 事件的 `udid`，沒有比對整個 payload；docstring 照 `tests/device` 既有的格式。
  - review（Standards、Spec 兩軸）：
    - Spec：第 1-5 節都照票做了，沒有 scope creep，也沒有做法不對的。唯一缺的是這筆結果紀錄。
    - Standards：沒有硬性違規。三點判斷題，都沒改：
      - `_create_dvt_location_service` 可能是 Mysterious Name，因為 DVT 失敗時回傳 Legacy。
        - 沒改：名字講的是主要路徑，退回已經寫在 docstring，回傳型別現在也寫 `LocationService`。
        - 跟 `_ensure_` 不一樣：`ensure` 講的是一件沒做的事。理由跟「看過、沒列入」的 `:408` 一樣。
        - 這張沒討論過這個名字，要改的話另開票。
      - 同函式三處 `broadcast` 的 `try/except` 包法一樣，可能是 Duplicated Code：超出這張的範圍。第 3 節也規定外面的 `try/except` 要留著，跟另外兩處一樣。
      - 新測試的情境用 `# a)`、`# b)`，既有測試用 `# 1)`：照第 5 節的 (a)、(b)，`FakeMounter` 的 docstring 也是這樣指。
  - 範圍外、沒修：除了上面的判斷題，沒有新發現。「不做」的各項維持原樣。
  - 04、05 號票都是 `Blocked by: 03`，現在解除封鎖。兩張的行號、舊函式名 `_ensure_personalized_ddi_mounted` 和 05 號票說的 `device_manager.py:513` 的 `hint`，都是開票時（`933d910`、`b21190c`）的紀錄，現在已經不是這樣。兩張都寫了以內容為準，所以沒改，triage 時再對一次。
- 2026-11-07：另一個 session 審了實作（`c655e91..cefd8fa`，5 個 commit；`cefd8fa` 補內文後是 `8178329`）。Spec 0 項。Standards 沒有違規，全是判斷題；Spec 另外指出驗收有一處筆誤。我逐條對過，重現了測試那點，下面列出要處理的 6 點，採納 4 項：
  - 採納：
    - (a) 沒檢查「DVT 失敗」這個前提有沒有真的發生：`0d45549`。
      - 重現了兩種情況，原本的測試照樣印 `all ok`：
        - 在 DVT 的 `try` 前面直接 `return LegacyLocationService(...)`。
        - `core.device_manager.DvtProvider` 的替換沒打到。真的 `DvtProvider` 吃到 `FakeLockdown`，會因為沒有 `product_version` 在同一個 `try` 裡失敗，照樣退回 Legacy。
      - `FakeDvtProvider.__aenter__` 每次被開都記一筆，(a) 先斷言有記到。仍然只有 (a)、(b) 兩項檢查，第 5 節「兩項檢查」沒變。
      - 驗證：
        - 現在的程式碼和重構前的 `c655e91` 都印 `all ok`。
        - 上面兩種情況都在新斷言失敗，結束碼 1。
        - M1 還是讓 (a) 失敗，M2 還是讓 (b) 失敗。
    - `_create_dvt_location_service` 的名字：開成 06 號票（`.scratch/device-dead-code/issues/06-create-dvt-location-service-name.md`），`needs-triage`。
      - 兩個 session 的 Standards review 都提了這點。上一筆把它記成「沒改」，理由寫在 06 號票的做法 A，要不要改名由 triage 決定。
    - 結果 commit 沒有內文：01、02 號票「記下實作結果」的 commit 都有條列內文。
      - 那個 commit 是 HEAD，還沒 push，所以用 `--amend` 補上內文，內容不變：`cefd8fa` 變成 `8178329`，`git diff cefd8fa 8178329` 是空的。
    - 驗收的「`tests/frontend/` 用 `node --test` 跑」照字面跑會失敗（Node 24 回 `✖ tests\frontend`）。改成 `test_defaults.ts` 開頭寫的指令，上一筆的 95/95 就是用這條跑的。
      - 01、02 號票的驗收也是同樣的寫法，已經 resolved，沒改。
  - 不採納：
    - `_check_personalized_ddi_mounted` 不回傳結果、卻會廣播事件，跟「check」的預期不同：這個名字是「定案」第 4 節使用者定的，不重開。06 號票「看過、沒列入」記了一筆。
    - 三處 `broadcast` 的 `try/except` 包法一樣：第 3 節規定外面的 `try/except` 要留著，跟另外兩處一樣。06 號票「看過、沒列入」記了一筆。
  - 改完重跑：前端 95/95（0 skipped）、`tests/device` 4 支、`tests/launcher` 1 支、`tests/pipi` 4 支 `test_*.py`、`test_extension.js`，結束碼都是 0。`check_live_anonymous.py` 會連到真網站，沒跑。
- 2026-11-07：使用者決定拿掉 LocWarp 的 iOS 16 支援，04 號票跟著刪了。上面提到 04 號票的地方（例如「不做」最後一項）請看 `git show 900e80d:.scratch/device-dead-code/issues/04-ddi-mount-event-payload-mismatch.md`。這張的內容和結論不受影響。

  > *This was generated by AI during triage.*
