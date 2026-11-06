# 02 裝置連線：device_manager.py 裡過時的 iOS 16 與 DDI 自動掛載說明改成符合現況

Status: ready-for-agent
Blocked by: (none)
Type: task
相關：`.scratch/device-dead-code/issues/01-remove-pin-ip-map-and-lockdownd-scan.md`。第 1 節是 01 號票的 Standards review 發現的。01 號票寫明那段註解要留，所以另開這張。第 2、3 節是開這張票時另外發現，使用者決定併進來。

## 為什麼

`backend/core/device_manager.py` 有三處說明跟程式碼對不上，讀 code 的人會被誤導：

- 第 1、2 節：兩段註解說 iOS 17 以下的路在 v0.1.49 拿掉了，但它們就緊接在給 iOS 16 用的函式旁邊。
  - 讀的人會以為 iOS 16 不支援，或以為旁邊的函式是沒清乾淨的殘骸。
  - 這跟 01 號票裡 `DeviceStatus.tsx` 那行 iOS 16 註解是同一段歷史：v0.1.49 拿掉 iOS 16 支援，隔天的 `d512094` 又加回來。
- 第 3 節：`_create_dvt_location_service` 的 docstring、註解和一行 warning 還說 iOS 17+ 會自動掛載 personalized DDI。
  - v0.2.58（`051de0e`）起，LocWarp 不再掛載，只檢查有沒有掛好。

第 1、2 節只改註解。第 3 節除了 docstring 和註解，還改一行 log 訊息的文字。行為都不變。

下面的行號都是 `b345bc8` 時的位置，動手前先用 grep 再對一次。

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

要改：

- 刪掉 `:334` 這行，連同下面多出來的空行，方法之間留一個空行，跟檔案其他地方一樣。
- 不用補新註解：`_connect_legacy` 的 docstring 已經寫了它是給 iOS 16.x 的，`connect()` 的 docstring 也列了兩條路。

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
  - 掛載：v0.2.58（`051de0e`，drop DDI auto-mount）起，`_ensure_personalized_ddi_mounted`（`:432`）只檢查。沒掛好的話，它會廣播 `ddi_not_mounted` 給前端，然後照樣返回，見它的 docstring 和 `:504-519`。
  - 重試：現在沒有。v0.2.58 前一版（`051de0e^`）也沒有。DVT 失敗就在 `:620-640` 退回 `LegacyLocationService`，兩個都失敗就把 DVT 的例外丟出去。
- `:593`「Try to mount DDI proactively」：**錯**，同上。
- `:597` 的 warning「DDI auto-mount failed」：**錯**。
  - 會走到這裡的，是檢查本身丟了沒預期的例外。`_ensure_personalized_ddi_mounted` 自己已經接住 import 失敗和查詢失敗（`:471-493`）。
  - 出錯的是「檢查」，不是「掛載」。

要改：

- docstring：寫 DVT 失敗時退回 `LegacyLocationService`，不寫自動掛載、不寫重試。
- `:593` 的註解：寫明它只檢查、沒掛好時會通知前端，不會掛載。
  - 這行註解要留著：函式名稱是 `ensure`，看起來像會掛載，這件事不直覺。
- `:597` 的 warning：改成「檢查失敗」的意思，例如「DDI status check failed; DVT may still fail」。
  - 這是 log 訊息，改了之後 log 內容會變。查過 repo 裡沒有別的地方依賴這段文字。
- 參考寫法。實作時可以改字，但意思要對：

```python
        """Spin up a DVT provider and hand it to ``DvtLocationService``.

        If DVT fails (for example the Developer Disk Image is not mounted),
        fall back to ``LegacyLocationService`` over lockdown.
        """
        # Despite the name, this only checks whether the DDI is mounted and
        # tells the UI if it isn't; LocWarp stopped mounting it in v0.2.58.
        try:
            await self._ensure_personalized_ddi_mounted(conn)
        except Exception:
            logger.warning("DDI status check failed; DVT may still fail", exc_info=True)
```

## 要留

- 第 1 節 `connect_wifi` 拿掉的那句：它跟 `backend/api/device.py:20` 一起說明為什麼沒有 `/wifi/connect`。01 號票把這兩行都列在「要留」。
- `backend/api/device.py:20` 的「/wifi/connect (legacy direct-IP WiFi for iOS <17) removed in v0.1.49.」：是對的。
- `backend/api/device.py:67`、`:1663` 給使用者看的「偵測到 iOS …,LocWarp 自 v0.1.49 起僅支援 iOS 16.0 以上。」：
  - 會看到這句的是 iOS 16 以下的裝置。v0.1.49 以前沒有版本下限，iOS 17 以下都走 legacy。從 v0.1.49 起，iOS 16 以下就一直不支援，所以對看到它的人來說是對的。
  - 這是使用者看得到的字串，改了就是改行為。
- iOS 16 的 classic DDI 真的會自動掛載（`_ensure_classic_ddi_mounted`），所以這些都是對的：
  - `:560` 的「attempting auto-mount」。
  - `:573`、`:649` 的「Classic DDI auto-mount failed」。
- personalized DDI 那邊已經是對的：
  - `:435` 的「v0.2.58 change: LocWarp no longer auto-downloads / auto-mounts」。
  - `:505-506` 的「LocWarp will not auto-mount」。
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
- 以下名稱只能剩指定的那幾處：
  - `git grep -nw connect_wifi -- ':!.scratch'` 只剩第 1 節改寫後的那行註解。
  - `git grep -n "Classic DDI auto-mount failed" -- ':!.scratch'` 還是 2 處（`:573`、`:649`）。
- 改動範圍：`git diff -U0` 只能有三處 hunk。
  - 第 2 節的 `:334` 那行和它下面的空行。
  - 第 3 節的 `:588-597`：docstring、註解、warning。
  - 第 1 節的 `:653-658` 註解。
  - 除了 `:597` 那行 warning，改到的內容行都只能是註解或 docstring。
- `.venv/Scripts/python.exe -I -c "import sys; sys.path.insert(0, 'backend'); import core.device_manager"` 要成功。
  - 這一步要另外跑：`tests/device` 用的 `api.device` 是在函式裡才 import `core.device_manager`，跑測試不一定會載入它。
- 現有測試都要過，而且 0 skipped：
  - 前端：`tests/frontend/` 用 `node --test` 跑。
  - 後端：`tests/device/` 三支、`tests/launcher/` 一支、`tests/pipi/` 的 `test_*.py`，加上 `node tests/pipi/test_extension.js`。
  - `tests/pipi/check_live_anonymous.py` 會連到真網站，不用跑，但要寫明沒跑。
- 不加新測試：只改說明文字和一行 log 文字，沒有行為可以鎖，mutation check 也套用不上。grep 和 import 就是這張的檢查。
- Commit：
  - 開票用 `.scratch:`。
  - 實作用 `裝置連線:`，依原因分兩個 commit，每個 commit 單獨跑上面的 import 都要成功：
    - 第 1、2 節：v0.1.49 留下、`d512094` 之後不對的兩段註解。
    - 第 3 節：v0.2.58 之後不對的 DDI 自動掛載說法。這個 commit 改了 log 文字，分開才能單獨 revert。
    - 第 1 節改寫時會一起拿掉「personalized DDI mount path」那句，所以第 3 節的 commit 不會再碰 `:653-658`。
  - 結果用 `.scratch:`。

## 不做

- 把 `_ensure_personalized_ddi_mounted` 改名，例如 `_check_personalized_ddi_mounted`：
  - 名字裡的 `ensure` 看起來像會掛載，跟它現在只檢查不符。
  - 但改名是程式碼變更，要動呼叫端。這張只改說明文字，靠第 3 節 `:593` 的註解講清楚。

## Comments

- 2026-11-07：使用者決定把第 2 節（`:334`）和第 3 節（`:591`、`:593`、`:597`）併進來。開票時它們列在「不做」，因為不在原本指定的 `:653-658` 裡。
  - 範圍變大，檔名從 `02-fix-stale-v0149-removed-comment.md` 改成 `02-fix-stale-device-manager-comments.md`，標題和「為什麼」也跟著改。
  - 寫第 3 節時另外查到：v0.2.58 前一版本來就沒有 docstring 說的「retry once」。所以「自動掛載」是 v0.2.58 起才變錯，「重試」則從那時之前就不對。
