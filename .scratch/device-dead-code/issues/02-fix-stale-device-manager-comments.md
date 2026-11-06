# 02 裝置連線：device_manager.py 裡過時的 iOS 16 與 DDI 自動掛載說明改成符合現況

Status: resolved
Blocked by: (none)
Type: task
相關：`.scratch/device-dead-code/issues/01-remove-pin-ip-map-and-lockdownd-scan.md`。第 1 節是 01 號票的 Standards review 發現的。01 號票寫明那段註解要留，所以另開這張。第 2、3 節是開這張票時另外發現，第 4 節是另一個 session 審這張票時發現，都由使用者決定併進來。

## 為什麼

`backend/core/device_manager.py` 有四處說明跟程式碼對不上，讀 code 的人會被誤導：

- 第 1、2 節：兩段註解說 iOS 17 以下的路在 v0.1.49 拿掉了，但它們就緊接在給 iOS 16 用的函式旁邊。
  - 讀的人會以為 iOS 16 不支援，或以為旁邊的函式是沒清乾淨的殘骸。
  - 這跟 01 號票裡 `DeviceStatus.tsx` 那行 iOS 16 註解是同一段歷史：v0.1.49 拿掉 iOS 16 支援，隔天的 `d512094` 又加回來。
- 第 3 節：`_create_dvt_location_service` 的 docstring、註解和一行 warning 還說 iOS 17+ 會自動掛載 personalized DDI。
  - v0.2.58（`051de0e`）起，LocWarp 不再掛載，只檢查有沒有掛好。
- 第 4 節：`_ensure_personalized_ddi_mounted` 的 docstring 說 DDI 沒掛好時，前端會提示使用者，呼叫端會給出清楚的錯誤。這兩件事現在都不會發生。

第 1、2、4 節只改註解和 docstring，其中第 2 節是把一行註解換成小標題。第 3 節除了 docstring 和註解，還改一行 log 訊息的文字。程式邏輯不變，只有這一行 log 文字會變。

下面的行號都是 `b345bc8` 時的位置。第 1、3、4 節會改變行數，改完後後面的行號會移動。動手前和驗收時都以內容為準，先用 grep 再對一次。

## 1. `:653-658` 說 v0.1.49 拿掉了兩個函式

現況，註解全文：

```python
    # _ensure_classic_ddi_mounted, _create_legacy_location_service, and
    # connect_wifi (legacy direct-IP WiFi) removed in v0.1.49 — see
    # UnsupportedIosVersionError. iOS 17+ continues to use the
    # personalized DDI mount path + DvtLocationService (with
    # LegacyLocationService as a runtime fallback inside
    # _create_dvt_location_service when DVT itself fails).
```

逐句對過：

- 「`_ensure_classic_ddi_mounted`、`_create_legacy_location_service` removed」：**錯**。
  - `91c4f7f`（v0.1.49）拿掉了它們和 `_connect_legacy`，同時加了這段註解和第 2 節那行，`MIN_VERSION` 改成 `"17.0"`。
  - `d512094`（2026-04-15，iOS 16.x support via LegacyLocationService，第一次出現在 v0.2.5）把三個函式加回來，`MIN_VERSION` 改回 `"16.0"`，但沒改這兩段註解。
  - 現在 `_ensure_classic_ddi_mounted` 在 `:521`，`_create_legacy_location_service` 在 `:642`。iOS 16 會在 `:428` 呼叫後者。
- 「`connect_wifi` removed in v0.1.49」：**對**。`d512094` 沒把它加回來，現在也沒有。
- 「see `UnsupportedIosVersionError`」：**已經說不通**。
  - v0.1.49 時它擋掉 iOS 17 以下，iOS 16 的 WiFi 直連就跟著拿掉。
  - 現在它只擋 iOS 16 以下。iOS 16 有支援，經由 usbmux 走 `_connect_legacy`，沒有直接連 IP 的路，也沒有 WiFi 通道。
- 「iOS 17+ 用 DvtLocationService，DVT 失敗時在 `_create_dvt_location_service` 裡退回 LegacyLocationService」：**對**。見 `:585-640`，退回的地方在 `:633`。
- 「iOS 17+ 走 personalized DDI mount path」：**錯**，原因同第 3 節。

要改：

- 改寫成只寫還成立的事：
  - `connect_wifi` 在 v0.1.49 拿掉了。
  - iOS 16 經由 usbmux 連（`_connect_legacy`），沒有直接連 IP 的路。WiFi 通道只有 iOS 17+，見下面的 `connect_wifi_tunnel`。
- 不要寫成「iOS 16 只走 USB」：
  - `connect()`（`:233`）沒有擋 usbmux 的 `Network` 類型。usbmux 只列出 WiFi 那筆時，iOS 16 照樣會走 `_connect_legacy`。
  - 這樣實際能不能用沒有驗證過，程式碼看得出來的只有「經由 usbmux」。`connect()` 的 docstring 也是這樣寫的。
- 改寫後不能再有：
  - `_ensure_classic_ddi_mounted`、`_create_legacy_location_service` 被拿掉的說法。
  - iOS 17+ 會掛載 personalized DDI 的說法。
  - 指向 `UnsupportedIosVersionError` 的「see」。
- 「iOS 17+ 用 DVT、失敗退回 Legacy」可以不寫。`:424-428` 的分派和 `_create_dvt_location_service` 的程式碼本身就看得出來，AGENTS.md 也規定註解只放在不直覺的邏輯。
- 參考寫法。實作時可以改字，但意思要對：

```python
    # connect_wifi (legacy direct-IP WiFi) removed in v0.1.49. iOS 16 goes
    # through usbmux (_connect_legacy); the WiFi tunnel below is iOS 17+ only.
```

## 2. `:334` 說 iOS < 17 的路已經拿掉

現況：

```python
    # iOS < 17 path removed in v0.1.49 — see UnsupportedIosVersionError.

    def _connect_legacy(
        self, udid: str, lockdown, ios_version: str
    ) -> _ActiveConnection:
        """Direct usbmux lockdown connection for iOS 16.x devices."""
```

- **錯**：下一個函式就是 `d512094` 加回來、給 iOS 16.x 用的 `_connect_legacy`（`:336`），`:284` 會呼叫它。來源同第 1 節。
- 這個位置原本是小標題：
  - `91c4f7f^` 的 `:242` 是 `# -- iOS < 17 ---…`，跟同檔 `:201`（現在的 `:293`）的 `# -- iOS 17+ via CoreDeviceTunnelProxy ---…` 是一對。
  - `91c4f7f` 拿掉函式時，把這個小標題換成現在這行註解。`d512094` 把函式加回來，小標題沒補回來。
  - 現在檔案裡 `# -- ` 開頭的小標題只剩 `:293` 一個，所以 `_connect_legacy` 看起來就屬於「iOS 17+」那一段。

要改：

- 把 `:334` 換成跟 `:293` 成對的小標題，前後的空行不動。寬度跟 `:293` 一樣是 76 個字元：

```python
    # -- iOS 16.x via usbmux lockdown --------------------------------------
```

- 不要整行刪掉。刪掉的話，`_connect_legacy` 會落在 `:293` 的「iOS 17+」小標題底下，一樣會誤導人。
- 這是把原本的結構補回來，不是新加說明，所以不違反 AGENTS.md「註解只放在不直覺的邏輯」。`_connect_legacy` 的 docstring 已經寫了它是給 iOS 16.x 的，不用再補別的註解。
- 這一節只改一行，行號不會移動。

## 3. `_create_dvt_location_service` 還說會自動掛載 personalized DDI

現況（`:585-597`）：

```python
    async def _create_dvt_location_service(
        self, conn: _ActiveConnection
    ) -> DvtLocationService:
        """Spin up a DVT provider and hand it to ``DvtLocationService``.

        If DVT fails because the Developer Disk Image is not mounted,
        we try to mount it automatically and retry once.
        """
        # Try to mount DDI proactively (fast no-op when already mounted).
        try:
            await self._ensure_personalized_ddi_mounted(conn)
        except Exception:
            logger.warning("DDI auto-mount failed; DVT may still fail", exc_info=True)
```

逐句對過：

- `:590-591`「DDI 沒掛載時自動掛載、重試一次」：**錯**。
  - 掛載：v0.2.58（`051de0e`，drop DDI auto-mount）起，`_ensure_personalized_ddi_mounted`（`:432`）只檢查。沒掛好的話，它會廣播 `ddi_not_mounted` 給前端，然後照樣返回，見 `:504-519`。
  - 重試：現在沒有。v0.2.58 前一版（`051de0e^`）也沒有。DVT 失敗就在 `:620-635` 退回 `LegacyLocationService`。
  - `:636-640` 寫了「兩個都失敗就把 DVT 的例外丟出去」，但實際上走不到。`LegacyLocationService.__init__`（`backend/services/location_service.py:244-247`）只存三個欄位，建構時不會丟例外。見「不做」。
- `:593`「Try to mount DDI proactively」：**錯**，同上。
- `:597` 的 warning「DDI auto-mount failed」：**錯**。
  - 會走到這裡的，是檢查本身丟了沒預期的例外。`_ensure_personalized_ddi_mounted` 自己已經接住 import 失敗和查詢失敗（`:471-493`）。
  - 出錯的是「檢查」，不是「掛載」。

要改：

- docstring：寫 DVT 失敗時退回 `LegacyLocationService`。不寫自動掛載、不寫重試，也不寫兩個都失敗會怎樣。
- `:593` 的註解：寫明它只檢查、不會掛載，沒掛好時會廣播 `ddi_not_mounted`。
  - 這行註解要留著：函式名稱是 `ensure`，看起來像會掛載，這件事不直覺。
  - 不要寫前端收到事件後會怎樣，例如「會告訴 UI」「會提示使用者」。前端從 v0.2.96 起只會關掉進度遮罩，見第 4 節。
- `:597` 的 warning：文字定為 `DDI status check failed; DVT may still fail`，驗收會搜這段字串。
  - 這是 log 訊息，改了之後 log 內容會變。查過 repo 裡沒有別的地方依賴這段文字。
- 參考寫法。docstring 和註解實作時可以改字，但意思要對；warning 文字照抄：

```python
        """Spin up a DVT provider and hand it to ``DvtLocationService``.

        If DVT fails (for example the Developer Disk Image is not mounted),
        fall back to ``LegacyLocationService`` over lockdown.
        """
        # Despite the name, this only checks whether the DDI is mounted
        # (broadcasting ddi_not_mounted if not); no mounting since v0.2.58.
        try:
            await self._ensure_personalized_ddi_mounted(conn)
        except Exception:
            logger.warning("DDI status check failed; DVT may still fail", exc_info=True)
```

## 4. `_ensure_personalized_ddi_mounted` 的 docstring 說前端會提示、呼叫端會給清楚的錯誤

現況（`:442-447`）：

```python
        This method is therefore a pure status check. If the iPhone
        has DDI mounted we log it and return happily. If not, we emit
        a WS event so the UI can tell the user to mount it via another
        tool, and we return anyway — the caller (`_create_dvt_location_service`)
        will then attempt DVT directly and produce a clean error if
        dtservicehub isn't advertised.
```

逐句對過：

- 「pure status check」、掛好了就記 log 返回、沒掛好也照樣返回：**對**。見 `:459-469`、`:495-502`、`:504-519`。
- 「emit a WS event so the UI can tell the user to mount it」：**錯**。
  - 後端確實會廣播 `ddi_not_mounted`（`:511`），還附了一段中文 `hint`。
  - v0.2.58 寫這段時，前端會把 `hint` 顯示成錯誤訊息。v0.2.96（`3fe4d69`）起，前端收到後只關掉進度遮罩，不提示使用者，`hint` 也沒人讀了，見 `frontend/src/hooks/useSimulation.ts:578-588`。
- 「the caller will then attempt DVT directly and produce a clean error if dtservicehub isn't advertised」：**錯**。
  - 呼叫端 DVT 失敗時會退回 `LegacyLocationService`（`:620-635`）。它的建構子不會丟例外（見第 3 節），所以這一步不會產生錯誤。`DtSimulateLocation` 要等到 `_ensure_service`（`location_service.py:249`）才建立，錯誤要到真的送位置時才會出現。
  - 這句是 v0.2.58（`051de0e`）寫的。那時退回 Legacy 的機制已經在了（`accfd76`，v0.1.34），所以一寫下來就不對。

要改：

- 只改 `:443` 的「If not」到 `:447`。第一句和前後兩段（`:433-442`、`:449-455`）是對的，不動。
- 改寫成：沒掛好時廣播 `ddi_not_mounted`，然後照樣返回；呼叫端照樣試 DVT，失敗就退回 `LegacyLocationService`。
- 不要描述前端收到事件後怎麼處理。這段就是因為後端 docstring 寫了前端的行為，前端一改就過時了。
- 不要寫呼叫端會產生錯誤，也不要寫兩個都失敗會怎樣。
- 參考寫法。實作時可以改字，但意思要對：

```python
        This method is therefore a pure status check. If the iPhone
        has DDI mounted we log it and return happily. If not, we
        broadcast `ddi_not_mounted` and return anyway; the caller
        (`_create_dvt_location_service`) still tries DVT and falls back
        to `LegacyLocationService` if DVT fails.
```

## 要留

- 第 1 節 `connect_wifi` 拿掉的那句：它跟 `backend/api/device.py:20` 一起說明為什麼沒有 `/wifi/connect`。01 號票把這兩行都列在「要留」。
- `backend/api/device.py:20` 的「/wifi/connect (legacy direct-IP WiFi for iOS <17) removed in v0.1.49.」：是對的。
- `backend/api/device.py:67`、`:1663` 給使用者看的「偵測到 iOS …,LocWarp 自 v0.1.49 起僅支援 iOS 16.0 以上。」：
  - 會看到這句的是 iOS 16 以下的裝置。v0.1.49 以前沒有版本下限，iOS 17 以下都走 legacy。從 v0.1.49 起，iOS 16 以下就一直不支援，所以對看到它的人來說是對的。
  - 這是使用者看得到的字串，改了就是改行為。
- iOS 16 的 classic DDI 真的會自動掛載（`_ensure_classic_ddi_mounted`），所以這些都是對的：
  - `:557` 的「No classic DDI auto-mount helper found」。
  - `:560` 的「attempting auto-mount」。
  - `:573`、`:649` 的「Classic DDI auto-mount failed」。
- personalized DDI 那邊已經是對的：
  - `:435` 的「v0.2.58 change: LocWarp no longer auto-downloads / auto-mounts」。
  - `:505-506` 的「LocWarp will not auto-mount」。
  - 第 4 節那個 docstring 的其他部分（`:433-442`、`:449-455`）。
- `frontend/src/hooks/useSimulation.ts:581` 的「DDI auto-mounted by a prior tool」：說的是被別的工具掛好，是對的。

## 驗收

- 搜尋用 `git grep -n -e <詞> -- ':!.scratch'`，要分大小寫。以下都要找不到：
  - `_ensure_classic_ddi_mounted, _create_legacy_location_service`
  - `personalized DDI mount`
  - `iOS < 17 path removed`
  - `mount it automatically`
  - `Try to mount DDI`
  - `'"DDI auto-mount failed'`：
    - 開頭要帶雙引號，只對得到 `:597` 的 log 字串。
    - 不帶引號的話，`:649` 的「Classic DDI auto-mount failed;」也會搜到。
  - `retry once`，只搜 `backend/core/device_manager.py`。`backend/services/pipi_mushroom.py` 也有這個詞，跟這張無關。
  - `tell the user to mount`
  - `clean error`
- 以下都要剛好找到 1 處，在 `backend/core/device_manager.py`：
  - `'"DDI status check failed; DVT may still fail"'`：第 3 節的 warning。
  - `'# -- iOS 16.x via usbmux lockdown -'`：第 2 節的小標題，它下面第一個非空行要是 `def _connect_legacy(`。
- 以下名稱只能剩指定的那幾處：
  - `git grep -nw connect_wifi -- ':!.scratch'` 只剩第 1 節改寫後的那行註解。
  - `git grep -n "Classic DDI auto-mount failed" -- ':!.scratch'` 還是 2 處，也就是 `b345bc8` 的 `:573`、`:649`。改完後 `:649` 那處的行號會移動。
- 改動範圍：
  - `git diff b345bc8 --stat -- ':!.scratch'` 只能有 `backend/core/device_manager.py`。
  - `git diff b345bc8 -U0 -- backend/core/device_manager.py` 的每個 hunk，舊行範圍（`@@ -a,b` 的第 a 行到第 a+b-1 行）都要落在下面這些範圍裡，而且每一節都要有改到：
    - 第 2 節：`334`。
    - 第 4 節：`443-447`。
    - 第 3 節：`590-591`、`593`、`597`。
    - 第 1 節：`653-658`。
    - b 是 0 的純新增，新內容接在第 a 行後面，第 a 行要在上面的範圍裡，或是某個範圍的前一行。
  - 不要用 hunk 數來驗：`-U0` 不帶上下文，沒改的 `:592`、`:594-596` 會把第 3 節切成三段，hunk 數也會跟著改寫的行數變。
  - 除了 `597` 那行 warning，改到的內容都只能是註解、docstring 或第 2 節的小標題。
- `.venv/Scripts/python.exe -I -c "import sys; sys.path.insert(0, 'backend'); import core.device_manager"` 要成功。
  - 這一步要另外跑：`tests/device` 用的 `api.device` 是在函式裡才 import `core.device_manager`，跑測試不一定會載入它。
- 人工核對 grep 驗不到的：
  - 第 1 節改寫後的意思是：`connect_wifi` 在 v0.1.49 拿掉；iOS 16 經由 usbmux（`_connect_legacy`）；WiFi 通道只有 iOS 17+。沒有「只走 USB」。
  - 第 2 節的小標題寬度是 76 個字元，跟 `:293` 一樣，上下各一個空行。
  - 第 3 節的 `try:` 上方還有註解，說明只檢查、不掛載。docstring 寫的是退回 Legacy，沒有掛載、重試、兩個都失敗的說法。
  - 第 3、4 節都沒有描述前端收到 `ddi_not_mounted` 後怎麼處理，也沒有說呼叫端會產生錯誤。
- 現有測試都要過，而且 0 skipped：
  - 前端：`tests/frontend/` 用 `node --test` 跑。
  - 後端：`tests/device/` 三支、`tests/launcher/` 一支、`tests/pipi/` 的 `test_*.py`，加上 `node tests/pipi/test_extension.js`。
  - `tests/pipi/check_live_anonymous.py` 會連到真網站，不用跑，但要寫明沒跑。
- 不加新測試：只改說明文字和一行 log 文字，沒有行為可以鎖，mutation check 也套用不上。grep、範圍檢查、import 和人工核對就是這張的檢查。
- Commit：
  - 開票用 `.scratch:`。
  - 實作用 `裝置連線:`，依原因分兩個 commit，每個 commit 單獨跑上面的 import 都要成功：
    - 第 1、2 節：v0.1.49 留下、`d512094` 之後就不對的兩段說明。
      - 第 1 節改寫時會一起拿掉 v0.2.58 才變錯的「personalized DDI mount path」那句。commit 訊息要寫到這件事，不然看這個 commit 只會看到 v0.1.49 的理由。
      - 所以第二個 commit 不會再碰 `:653-658`。
    - 第 3、4 節：v0.2.58 改成只檢查、不掛載之後就不對的 DDI 說明，前端那句是 v0.2.96 起才不對。這個 commit 改了 log 文字，分開才能單獨 revert。
  - 結果用 `.scratch:`。

## 不做

- 把 `_ensure_personalized_ddi_mounted` 改名，例如 `_check_personalized_ddi_mounted`：
  - 名字裡的 `ensure` 看起來像會掛載，跟它現在只檢查不符。
  - 但改名是程式碼變更，要動呼叫端。這張只改說明文字，靠第 3 節 `:593` 的註解講清楚。
- `_create_dvt_location_service` 的回傳型別 `-> DvtLocationService`（`:587`）：
  - 退回時回傳的是 `LegacyLocationService`。兩個都是 `LocationService` 的子類，彼此沒有繼承關係，所以這個型別標錯了。第 3 節新的 docstring 寫著退回 Legacy，跟它放在一起就看得出矛盾。
  - 改型別是程式碼變更，留給之後的票。
- `:636-640` 走不到的「Both DVT and legacy location services failed」分支：拿掉是程式碼變更。
- `ddi_not_mounted` 附的 `hint`（`:513-516`）：前端從 v0.2.96 起就不讀了，但拿掉要改後端送出的內容，是程式碼變更。
- `:108` `usbmux_lockdown` 的註解「for legacy fallback on iOS 17+」：
  - 寫得不完整：iOS 16 的 `_connect_legacy`（`:345`）也會設這個欄位，`backend/api/device.py:1606` 的 AMFI 也會用到它。
  - 但它沒有寫錯。這張只改跟程式碼對不上的說明。

## Comments

- 2026-11-07：使用者決定把第 2 節（`:334`）和第 3 節（`:591`、`:593`、`:597`）併進來。開票時它們列在「不做」，因為不在原本指定的 `:653-658` 裡。
  - 範圍變大，檔名從 `02-fix-stale-v0149-removed-comment.md` 改成 `02-fix-stale-device-manager-comments.md`，標題和「為什麼」也跟著改。
  - 寫第 3 節時另外查到：v0.2.58 前一版本來就沒有 docstring 說的「retry once」。所以「自動掛載」是 v0.2.58 起才變錯，「重試」則從那時之前就不對。
- 2026-11-07：另一個 session 審了這張票（`99cdf43` 的版本），提了 9 點。逐條對過程式碼和 git 歷史後全部採納，第 4 節由使用者決定併進來：
  - 驗收原本寫「`git diff -U0` 只能有三處 hunk」，照參考寫法一定不會過（`-U0` 會切成 5 處），改成檢查每個 hunk 的舊行範圍。
  - 第 2 節從「整行刪掉」改成補回小標題。`91c4f7f` 把原本的 `# -- iOS < 17 ---` 小標題換成那行註解；整行刪掉的話，`_connect_legacy` 會落在 iOS 17+ 的小標題底下。
  - 新增第 4 節：`_ensure_personalized_ddi_mounted` docstring 的 `:443-447`。第 3 節參考註解原本寫「tells the UI if it isn't」，也跟著改成只寫會廣播 `ddi_not_mounted`。
  - 第 3 節補上：`:636-640` 實際上走不到。
  - 「不做」加了四項：回傳型別、走不到的分支、沒人讀的 `hint`、`:108` 的註解。
  - warning 文字定死，驗收加上「剛好找到 1 處」的正向檢查和人工核對清單。
  - 行號會移動，所以驗收改以內容為準。
  - 「行為都不變」改成「程式邏輯不變，只有這一行 log 文字會變」。
  - 「要留」補上 `:557`。
  - 第一個實作 commit 的訊息要提到順手拿掉的「personalized DDI mount path」。
  - 改完後，把四節參考寫法套在 `device_manager.py` 的暫存副本上試跑：範圍檢查、找不到和剛好找到的搜尋、`connect_wifi` 和 `Classic DDI auto-mount failed` 的處數、小標題寬度與位置、import 都過。
- 2026-11-07：實作完成，照票上的切法分兩個 commit：
  - `197cf75`：第 1、2 節。commit 訊息有寫到順手拿掉的、v0.2.58 才變錯的「personalized DDI mount path」那句。
  - `ab25812`：第 3、4 節，包含唯一一行 log 文字的變更。
  - 四節的 docstring 和註解都照參考寫法，warning 文字照抄。
  - 驗收 grep：
    - 「要找不到」的 9 個詞都找不到。`retry once` 只搜 `device_manager.py`，也找不到。
    - 「剛好 1 處」：warning 在 `:597`；小標題在 `:334`，它下面第一個非空行是 `def _connect_legacy(`。
    - `-w connect_wifi` 只剩 `:653` 改寫後的那行。`Classic DDI auto-mount failed` 還是 2 處。
  - 範圍：
    - `git diff b345bc8 --stat -- ':!.scratch'` 只有 `device_manager.py`，+12/−16。
    - `-U0` 的舊行範圍是 `334`、`443-447`、`590-591`、`593`、`597`、`653-658`，都在票列的範圍內，四節都有改到。
    - Spec review 另外用 AST 比對過，docstring 先正規化：只有 `:597` 的 log 文字不同，其他都是註解或 docstring。
  - import：兩個 commit 各自的內容都跑過，都成功。`197cf75` 是 commit 前在工作目錄跑的，Spec review 又單獨載入一次。
  - 測試：
    - 通過：前端 95/95（0 skipped）、`tests/device` 3 支、`tests/launcher` 1 支、`tests/pipi` 4 支 `test_*.py`、`test_extension.js`。結束碼都是 0。
    - 沒跑：`check_live_anonymous.py`，它會連到真網站。
  - 人工核對清單逐條都過：
    - 第 1 節沒有「只走 USB」。
    - 第 2 節小標題 76 字元，上下各一個空行。
    - 第 3 節 `try:` 上方有「只檢查、不掛載」的註解。
    - 第 3、4 節都沒寫前端怎麼處理 `ddi_not_mounted`，也沒寫呼叫端會產生錯誤，或兩個都失敗會怎樣。
    - 新 docstring 的「over lockdown」跟同函式 fallback 的 log 用詞一致。
  - 票上寫錯的地方：驗收寫「改完後 `:649` 那處的行號會移動」，實際上相反。
    - 第 4 節少 1 行，第 3 節多 1 行，所以只有 `:448-592` 之間的行往上移 1 行，`:649` 沒動。
    - 「要留」裡的 `:557`、`:560`、`:573` 現在是 `:556`、`:559`、`:572`。
    - 這是 Spec review 發現的，我用 `git grep b345bc8` 對過。
  - review（Standards、Spec 兩軸）：
    - Spec：沒有缺漏，沒有 scope creep，也沒有實作錯的地方。
    - Standards：沒有硬性違規，有兩點判斷題，都是這張票已經決定的事，所以沒改：
      - `_ensure_personalized_ddi_mounted` 可能是 Mysterious Name，`:592` 的註解是在幫名稱補洞。根本解是改名，已經列在「不做」。
      - `:653` 的註解寫的是歷史，跟 AGENTS.md「註解只放在不直覺的邏輯」有點擦邊；「iOS 17+ only」也跟下面的區段標題重複。不過這是第 1 節指定的寫法，「要留」也寫了它跟 `backend/api/device.py:20` 一起說明為什麼沒有 `/wifi/connect`。
  - 範圍外、沒修：沒有新發現。「不做」那五項維持原樣。
