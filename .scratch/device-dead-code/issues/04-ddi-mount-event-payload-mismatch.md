# 04 裝置連線：DDI 掛載事件前後端對不上（`ddi_mounting` 的 `stage`/`elapsed` 後端已不送、`ddi_mount_failed` 的 `error` 前端不讀）

Status: ready-for-agent
Blocked by: (none)
Type: task
相關：`.scratch/device-dead-code/issues/03-dvt-location-service-leftovers.md` 的「不做」最後一項。03 號票 triage 時順便發現，跟 03 號票第 3 節的 `hint` 是同一類，但在 iOS 16 classic DDI 和前端進度 UI 那邊，所以另開這張。`.scratch/device-dead-code/issues/05-readme-ddi-not-mounted-prompt.md` 跟這張一起 triage，第 2 節的提示原則是兩張一起定的。

## 為什麼

兩處都是 DDI 掛載事件的前後端對不上，留著會誤導讀 code 的人：

- 第 1 節：前端會讀 `ddi_mounting` 的 `stage`、`elapsed`，畫一整段階段進度 UI。但後端從 v0.2.58 起就沒有任何地方送這兩個欄位，這段 UI 永遠不會出現。
- 第 2 節：後端在 `ddi_mount_failed` 附了 `error`，但前端從來沒讀過。結果是 iOS 16 的 classic DDI 掛載失敗時，遮罩直接消失，使用者看不到任何提示。

triage 時決定第 2 節讓前端提示使用者，連帶要處理兩件事：

- 第 3 節：DDI 已經掛好，也可能被當成掛載失敗。不修的話，新的提示會誤報。
- 第 4 節：遮罩說明文字寫「約 20MB」，但 classic DDI 只有 7–8 MB；標題寫「首次設定裝置中」，但遮罩不只第一次連線會出現。

下面的行號都是 `1393369` 時的位置，triage 時逐一對過。開票時（`933d910`）的後端行號，在 03 號票之後都往上移了 6 行。動手前和驗收時都以內容為準，先用 grep 再對一次。

（已解除：03 號票 2026-11-07 resolved。）`Blocked by: 03`：03 號票的驗收要求 `git diff 9cd9b56 --stat -- ':!.scratch'` 只能有 `device_manager.py` 和它新增的測試。這張要是先做，03 號票的範圍檢查就過不了。

順序：`.scratch/wifi-keepalive-restore/issues/01-keepalive-overrides-restore.md`、`02-disconnect-clear-traceback.md` 都標了 `Blocked by` 這張（2026-11-07）。它們會改到 `strings.ts`、`device_manager.py`，先做的話，這張驗收的範圍檢查就過不了。動手前先跑 `git log --oneline 1393369..HEAD -- ':!.scratch'`，要是空的。不是空的就停下來回報，不要自己改範圍檢查。

## 1. 拿掉走不到的階段進度 UI（`ddiStage`）

現況：

- 前端：
  - `frontend/src/hooks/useSimulation.ts:265` 有 `ddiStage` 這個 state，`:261-264` 是它的註解。
    - `:564-571` 收到 `ddi_mounting` 時，payload 有 `stage` 才 `setDdiStage`。
    - `:575`、`:587` 在 `ddi_mounted`、`ddi_mount_failed`、`ddi_not_mounted` 時清掉它。
    - `:1179` 把它傳出去。
  - `frontend/src/App.tsx:2238-2277` 在 `ddiStage` 有值時，在進度遮罩裡畫進度條、階段名稱和經過秒數。
    - `:2239-2241` 的註解說，階段名稱對應後端 `_staged_personalized_mount` 裡的 `emit()`。這個函式現在已經不存在，repo 裡（不含 `.scratch`）只剩這行註解提到它。
  - `frontend/src/i18n/strings.ts:825-834` 是這段 UI 用的 10 個字串：`ddi.stage_*` 6 個、`ddi.eta_*` 4 個。
- 後端：現在唯一送 `ddi_mounting` 的是 `backend/core/device_manager.py:556`，在 iOS 16 的 `_ensure_classic_ddi_mounted` 裡，只帶 `udid`。
- 歷史：
  - v0.2.56（`f878de3`）加了 `_staged_personalized_mount`。iOS 17+ 自動掛載 personalized DDI 時，它會用 `ddi_mounting` 送 `stage` 和 `elapsed`，前端的階段 UI 和字串也是這個 commit 加的。
  - 隔一版 v0.2.58（`051de0e`）拿掉 personalized DDI 自動掛載，`_staged_personalized_mount` 和送 `stage` 的地方跟著拿掉，前端沒動。
  - 所以從 v0.2.58 起，`ddiStage` 永遠是 `null`，`App.tsx:2238-2277` 永遠不會畫出來。
- `git grep -n -e ddiStage -e setDdiStage -e "ddi\.stage_" -e "ddi\.eta_" -- ':!.scratch'` 只有上面這些地方，沒有別的消費端。`tests/frontend/` 也沒有測試用到。

要改：

- `useSimulation.ts`：
  - 拿掉 `ddiStage` 這個 state 和它的註解（`:261-265`）。
  - `ddi_mounting` 只留 `setDdiMounting(true)`，拿掉讀 `stage` 的那段（`:566-569`）。
  - 拿掉 `:575`、`:587` 的 `setDdiStage(null)`。
  - 回傳值拿掉 `ddiStage`（`:1179`）。
- `App.tsx`：整段拿掉 `:2238-2277`，包括 `:2239-2241` 的註解。遮罩本身、標題（`ddi.mounting_title`）和說明文字（`ddi.mounting_hint`）都留著，標題和說明文字的改法見第 4 節。
- `strings.ts`：拿掉 `:825-834` 這 10 個字串。
- 以後要分階段顯示進度，`f878de3` 有完整的版本可以拿回來。

## 2. `ddi_mount_failed`：拿掉 `error`，前端改成跳 toast

現況：

- 後端：`device_manager.py:567-574` 是 `_ensure_classic_ddi_mounted` 的 `finally`。
  - 掛載失敗時送 `ddi_mount_failed`，payload 是 `udid` 加上 `error: "Classic DDI mount failed"`（`:573`）。
  - `:571` 建 `payload`、`:574` 送出，`payload` 只用在這裡。
- 前端：`useSimulation.ts:572-577` 收到 `ddi_mount_failed` 時，跟 `ddi_mounted` 走同一段：只關掉進度遮罩、清掉 `ddiStage`，payload 完全不讀。
- 歷史：
  - 前端這段從 v0.1.33（`1581890`）加上進度遮罩起，收到 `ddi_mount_failed` 就只關遮罩，從來沒讀過 payload。
  - classic 這條路和 `error` 是 v0.2.5 那次 iOS 16 支援（`d512094`）加的。所以 `error` 從寫下來那天起就沒人讀。
- `git grep -n ddi_mount_failed -- ':!.scratch'` 只有 `device_manager.py:570` 和 `useSimulation.ts:573`，沒有別的消費端。
- 結果：iOS 16 的 classic DDI 掛載失敗時，遮罩直接消失，使用者看不到任何提示。錯誤要到真的送位置時才會出現。同一件事在 `:566` 有英文 warning log。
- 開發者模式沒開時也會走到這裡：
  - README 第 3 步（`README.md:222`）要使用者先用 LocWarp 連上手機，再到「設定」頁按「開啟開發者模式」。所以照 README 設定的 iOS 16 使用者，第一次連線時開發者模式一定還沒開。
  - `auto_mount_developer` 在本機沒有映像檔時先下載（pymobiledevice3 11.49.5 `mobile_image_mounter.py:600-601`），再呼叫 `mount()`。`mount()` 一開始就檢查開發者模式（`:391` 呼叫 `:64-75` 的 `raise_if_cannot_mount`），沒開就丟 `DeveloperModeIsNotEnabledError`。
  - `:565` 的 `except Exception` 把它當一般的掛載失敗，送出 `ddi_mount_failed`。
  - 這是讀程式碼和 README 推的，triage 時沒有 iOS 16 手機實測。
- 為什麼不能用 `setError` 的錯誤橫幅：
  - iOS 16 用 USB 連線時走 `backend/api/device.py` 的 `connect_device`：`:1643` 先建 engine，iOS 16 會在這裡掛 classic DDI、送出 `ddi_mount_failed`。
  - `:1648` 接著送 `device_connected`，前端收到後就 `setError(null)`（`useSimulation.ts:454`）。
  - usbmux 自動重連（`backend/main.py:590`→`:595`）也是同樣順序。用 `setError` 的話，提示會閃一下就被清掉。
- `App.tsx:193-207` 有現成的 `showToast(msg, ms)`。目前只有使用者自己的操作會跳 toast，連線時不會有別的 toast 蓋掉它。

要改：

- 後端：`finally` 不論成功或失敗，都只送 `udid`，寫成 `await broadcast(event, {"udid": conn.udid})`。拿掉 `payload` 變數和 `:572-573`。`ddi_mount_failed` 事件本身要留。
- 前端：
  - `useSimulation` 多一個 state：收到 `ddi_mount_failed` 的次數，從 0 開始，並且回傳出去。建議命名為 `ddiMountFailures`。
    - 用次數，不用布林：連續失敗兩次，就要跳兩次 toast。
  - `:572-577` 把 `ddi_mounted` 和 `ddi_mount_failed` 拆開：兩個都關遮罩，`ddi_mount_failed` 另外把次數加 1。
    - 加 1 要寫成函式型更新 `setDdiMountFailures((n) => n + 1)`。事件處理寫在 `useEffect(..., [subscribe, updateRuntime])` 裡（`useSimulation.ts:684`），裡面讀到的次數是舊的。寫成 `setDdiMountFailures(ddiMountFailures + 1)` 的話會一直是 1，第二次失敗就不會跳 toast。
  - `App.tsx`：緊接在 `showToast` 的 `useCallback`（`:193-207`）後面加一個 effect。次數大於 0 而且有變時，執行 `showToast(t('ddi.mount_failed'), 10000)`。
    - 10 秒跟現有最長的 toast（`:213`）一樣。
    - effect 的依賴只放次數。切換語言時，不能再跳一次 toast。
  - `strings.ts`：在 `ddi.mounting_hint` 後面加 `ddi.mount_failed`：
    - zh：`Developer Disk Image 掛載失敗,模擬定位可能無法使用。請確認 iPhone 已開啟開發者模式、電腦可以連上網路,再重新連線。`
    - en：`Couldn't mount the Developer Disk Image, so location simulation may not work. Make sure Developer Mode is on and this computer is online, then reconnect.`
    - 照 `strings.ts` 現有寫法，中文用半形逗號。
    - 寫「可能」是因為失敗不一定代表定位不能用，例如 120 秒逾時。
    - 開發者模式和網路都寫，因為這是兩個已知的原因，見現況。照 README 設定的人，下一步本來就是開開發者模式；開了以後手機會重新啟動，「再重新連線」也接得上。
- `ddi_not_mounted`（iOS 17+ 連線時的預檢）不跳 toast。原則是 triage 時定的：只在 LocWarp 確定失敗時提示，不對連線時的預檢結果提示。理由見 05 號票的 Comments。

## 3. `AlreadyMountedError` 當成已掛好

現況：

- `_ensure_classic_ddi_mounted` 先查一次有沒有掛（`:526-541`）。查詢丟例外時，`:540-541` 只記 warning，就繼續往下掛載。
- 掛載呼叫的是 pymobiledevice3 的 `auto_mount_developer`（`:543-548` 用 `getattr` 找到它，`:562` 呼叫）。它自己會再查一次，有掛就丟 `AlreadyMountedError`（pymobiledevice3 11.49.5 `mobile_image_mounter.py:598-599`）。
- `:565` 的 `except Exception` 會把它當成失敗，`finally` 送出 `ddi_mount_failed`。
- triage 時在暫存區用 `1393369` 試跑過：假的查詢丟例外、假的 `auto_mount_developer` 丟 `AlreadyMountedError` 時，送出的是 `ddi_mounting`，接著 `ddi_mount_failed`。
- 現在這個情況使用者看不出來，因為遮罩只會關掉。第 2 節加上提示後，就會變成誤報。

要改：

- 在 `:565` 的 `except Exception` 前面加 `except AlreadyMountedError:`，當成已掛好：`mounted = True`，記一行 info log。log 文字可以用 `:533` 那句 `Classic DDI already mounted on %s`。
- `AlreadyMountedError` 從 `pymobiledevice3.exceptions` import，放在檔案開頭其他 `pymobiledevice3` 的 import 旁邊，照字母順序會在 `:24` 前面。`device_manager.py` 現在沒有從 `pymobiledevice3.exceptions` import 任何東西。
- 這要在第 2 節的前端提示之前 commit，這樣不會有任何一個 commit 會誤報。見驗收的 commit 切法。

## 4. 遮罩文字：說明拿掉「約 20MB」，標題拿掉「首次」

現況：

- `ddi.mounting_title`（`strings.ts:823`）：中文是「首次設定裝置中」，英文是「Preparing device」。
  - 遮罩不只第一次連線會出現。照 README 設定的 iOS 16 使用者就會看到兩次：第一次連線時（開發者模式還沒開，見第 2 節），和開了開發者模式、手機重新啟動後再連線時。
  - classic DDI 在 iPhone 重新開機後要重新掛，所以之後每次重開機都會再出現。這點沒有實機測過。
- `ddi.mounting_hint`（`strings.ts:824`）：中文是「正在準備 Developer Disk Image(約 20MB),請保持網路連線」，英文是「Preparing the Developer Disk Image (~20MB). Please keep your internet connected.」。
- 這段是 v0.1.33（`1581890`）為 iOS 17+ 的 personalized DDI 寫的。從 v0.2.58 起，會打開遮罩的只剩 iOS 16 的 classic DDI 掛載（`device_manager.py:556`）。
- classic DDI 的大小：pymobiledevice3 從 `doronz88/DeveloperDiskImage` 下載（`developer_disk_image/repo.py:14`）。2026-11-07 用 `curl -I` 查 raw.githubusercontent.com 的 `Content-Length`：
  - 16.0：8,464,365 bytes。
  - 16.4、16.7：7,432,520 bytes。
- 「請保持網路連線」還是對的：本機沒有映像檔時會下載（`mobile_image_mounter.py:600-601`）。

要改：

- `ddi.mounting_hint` 改成：
  - zh：`正在準備 Developer Disk Image,請保持網路連線`
  - en：`Preparing the Developer Disk Image. Please keep your internet connected.`
- 拿掉數字，不改成「約 8MB」：不同版本的大小不一樣，而且只有第一次會下載，數字對使用者沒有用。
- `ddi.mounting_title` 的中文改成 `準備裝置中`，跟英文 `Preparing device` 一致。英文不改。

## 5. 新增 `tests/device/test_classic_ddi_mount_events.py`

現況：

- 沒有測試涵蓋 `_ensure_classic_ddi_mounted`。
- `tests/device` 現有四支。`test_dvt_location_fallback.py`（03 號票）從 `DeviceManager.get_location_service` 進去，換掉函式裡才 import 的模組屬性。新測試照它的做法。
- `useSimulation.ts`、`App.tsx` 沒有測試。`tests/frontend/` 是用 `node --test` 跑純函式，repo 裡沒有 React 的測試工具，要加就得安裝新套件。所以前端改在瀏覽器裡驗，見驗收。

要改：

- 寫法照 `tests/device` 現有的測試：
  - 一般的 Python 程式，不用 pytest。跑法：`.venv/Scripts/python.exe tests/device/test_classic_ddi_mount_events.py`。
  - 每項檢查用 `assert`，過了印 `ok  ...`，最後印 `all ok`。
  - 檔案開頭的 docstring 寫：鎖住什麼、為什麼；這張票的路徑；跑法；哪些是假的，不連網、不接手機。
- 從 `DeviceManager.get_location_service(udid)` 進去，不要直接呼叫 `_ensure_classic_ddi_mounted`。建一個 `DeviceManager()`，把 `ios_version="16.7"` 的 `_ActiveConnection` 放進 `_connections`，lockdown 用假物件。
- 換成假的。triage 時在暫存區用 `1393369` 試跑過，不接手機就能跑到：
  - `pymobiledevice3.services.mobile_image_mounter` 模組上的 `MobileImageMounterService`：
    - `__init__` 收 `lockdown=` 關鍵字參數。
    - async 的 `connect()`、`close()`、`is_image_mounted(...)`，`is_image_mounted` 回傳 `False`。
    - (b) 要讓 `connect()` 丟例外，模擬第一次查詢失敗。
  - 同一個模組上的 `auto_mount_developer`：
    - async，收一個位置參數（lockdown），每次被呼叫都記下來。
    - (a) 丟一般的例外；(b) 丟 `AlreadyMountedError()`，從 `pymobiledevice3.exceptions` import。
    - 一定要記呼叫：真的 `auto_mount_developer` 在假 lockdown 上也會失敗。沒有記錄的話，就算假的沒換到，(a) 照樣會過。
    - `_ensure_classic_ddi_mounted` 是在函式裡 import 這個模組，再用 `getattr` 找 `auto_mount_developer`，所以換模組上的屬性就有效。
  - `api.websocket` 模組上的 `broadcast`：記下送出的事件。
- 兩項檢查，每項用自己的 `DeviceManager`，中間清掉紀錄，分開 `assert` 和印 `ok`：
  - (a) 掛載失敗：這台的 `ddi_*` 事件依序是 `ddi_mounting`、`ddi_mount_failed`。鎖的是前端靠 `ddi_mount_failed` 關掉遮罩、跳出 toast。
  - (b) 第一次查詢失敗，`auto_mount_developer` 丟 `AlreadyMountedError`：有 `ddi_mounted`，沒有 `ddi_mount_failed`。鎖的是第 3 節。
  - 兩項都要斷言假的 `auto_mount_developer` 被呼叫過。
  - 只看事件名稱和 `udid`，不要檢查 payload 剛好等於 `{"udid": ...}`，理由跟 03 號票第 5 節一樣。`error` 有沒有拿掉，由驗收的 grep 檢查。
- 在 `1393369` 上，(a) 現在就會過，(b) 現在會失敗（送出的是 `ddi_mount_failed`），要第 3 節改完才會過。

## 要留

- 四個事件本身，和它們開關遮罩的行為：`ddi_mounting` 打開；`ddi_mounted`、`ddi_mount_failed`、`ddi_not_mounted` 關掉。
- 遮罩本身、spinner，和標題、說明文字的 key（文字照第 4 節改）。
- `ddi_not_mounted` 的處理，只拿掉 `:587` 的 `setDdiStage(null)`。
- `useSimulation.ts:579-585` 的註解：雖然過時了，這張不改，交給 05 號票，見「看過、沒列入」。
- 後端 log 文字：`:553` 的 info、`:566` 的 warning `Classic DDI auto-mount failed for %s`、`:533` 的 debug。
- `useSimulation.ts:469-476` 的主裝置過濾。
- `tunnel_lost`、`device_disconnected` 的提示寫法，和 `:591` 的註解，見「看過、沒列入」。

## 驗收

- 搜尋用 `git grep -n -e <詞> -- ':!.scratch'`，要分大小寫。以下都要找不到：
  - `ddiStage`、`setDdiStage`、`ddi\.stage_`、`ddi\.eta_`、`_staged_personalized_mount`。
  - `git grep -n -F 'Classic DDI mount failed' -- backend`。不要跟 `:566` 的 `Classic DDI auto-mount failed for %s` 搞混，那句要留。
  - `git grep -n -w payload -- backend/core/device_manager.py`：`1393369` 時只有 `:571`、`:573`、`:574` 三處，都在第 2 節要拿掉的範圍裡。
  - `git grep -n 20MB -- frontend/src`。`backend` 裡 `_check_personalized_ddi_mounted` docstring 的「the 20MB image upload」講的是 personalized DDI，不在範圍內。
  - `git grep -n -F '首次設定裝置中' -- frontend/src`。`1393369` 時只有 `strings.ts:823` 一處。
- 以下要剛好找到指定的處數：
  - `git grep -n -F 'await broadcast(event, {"udid": conn.udid})' -- backend`：1 處。
  - `git grep -n AlreadyMountedError -- backend`：2 處，在 `backend/core/device_manager.py`，一處是 import，一處是 `except`。
  - `git grep -n ddi_mount_failed -- backend`：1 處，就是 `event = "ddi_mounted" if mounted else "ddi_mount_failed"` 那行。
  - `git grep -n -F 'Classic DDI auto-mount failed for %s' -- backend`：1 處。
  - `git grep -n -F 'ddi.mount_failed' -- frontend/src`：2 處，`strings.ts` 的定義和 `App.tsx` 的 `t(...)`。
  - `git grep -n -F 'ddi.mounting_hint' -- frontend/src`：2 處，跟 `1393369` 一樣。
- 改動範圍：
  - `git diff 1393369 --stat -- ':!.scratch'` 只能有這五個檔：`backend/core/device_manager.py`、`frontend/src/App.tsx`、`frontend/src/hooks/useSimulation.ts`、`frontend/src/i18n/strings.ts`、新的 `tests/device/test_classic_ddi_mount_events.py`。
  - `git diff 1393369 -U0 -- <檔案>` 的每個 hunk，舊行範圍（`@@ -a,b` 的第 a 行到第 a+b-1 行）都要落在下面的範圍裡：
    - `device_manager.py`：`561-574`（第 2、3 節）；`23` 之後的純新增（第 3 節的 import）。
    - `useSimulation.ts`：`260-265`、`564-577`、`587`、`1178-1179`。
    - `App.tsx`：`207` 或 `208` 之後的純新增（第 2 節的 effect）；`2238-2277`（第 1 節）。
    - `strings.ts`：`823-834`。
    - b 是 0 的純新增，新內容接在第 a 行後面，第 a 行要在上面的範圍裡，或是某個範圍的前一行。
  - 不要用 hunk 數來驗，hunk 數會跟著改寫的行數變。
- 型別檢查：每個改到前端的 commit，在 repo 根目錄單獨跑 `frontend/node_modules/.bin/tsc --noEmit -p frontend`，結束碼都要是 0。`1393369` 時是 0 個錯誤（triage 時跑過）。
- import：每個改到後端的 commit，單獨跑 `.venv/Scripts/python.exe -I -c "import sys; sys.path.insert(0, 'backend'); import core.device_manager"`，要成功。
- 新測試：
  - 從加入新測試的 commit 起，每個 commit 單獨跑 `.venv/Scripts/python.exe tests/device/test_classic_ddi_mount_events.py`，都要印 `all ok`、結束碼 0。
  - red before green：把新測試放到 `1393369` 的程式碼上跑（例如在暫存的 worktree），(a) 要印 `ok`，(b) 要失敗。結果記到 Comments。
- mutation check：在最後的程式碼上做，一次改一處，做完還原，`git diff` 要回到乾淨：
  - M1：把 `event = "ddi_mounted" if mounted else "ddi_mount_failed"` 改成永遠是 `"ddi_mounted"`。新測試要失敗，(a) 不能印 `ok`。
  - M2：拿掉 `except AlreadyMountedError:` 那段。新測試要失敗，(b) 不能印 `ok`。
  - M3：在測試裡拿掉換掉 `auto_mount_developer` 的那行。新測試要失敗，證明「有呼叫到假的」這個斷言有作用。
  - 三項的結果都記到 Comments。
- 現有測試都要過，而且 0 skipped：
  - 前端：在 repo 根目錄跑 `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"`。
  - 後端：`tests/device/` 五支（含新的一支）、`tests/launcher/` 一支、`tests/pipi/` 的 `test_*.py`，加上 `node tests/pipi/test_extension.js`。
  - `tests/pipi/check_live_anonymous.py` 會連到真網站，不用跑，但要寫明沒跑。
- 瀏覽器驗證，不用接手機：
  - 對前端送假的 WebSocket 訊息，例如在 app 程式碼載入前先包一層 `window.WebSocket`。
  - 訊息不帶 `udid`，或帶主裝置的 `udid`：hook 會丟掉不是主裝置的事件（`useSimulation.ts:469-476`）。
  - 依序確認：
    1. 送 `ddi_mounting`：遮罩出現，有第 4 節的新標題和新說明文字，沒有進度條、階段名稱和秒數。
    2. 接著送 `ddi_mount_failed`：遮罩關掉，跳出第 2 節的中文 toast，大約 10 秒後消失。
    3. 送 `ddi_mount_failed` 後馬上送 `device_connected`：toast 還在。
    4. 切成英文：不會跳新的 toast。再送一次 `ddi_mount_failed`，跳出英文 toast。這一步也驗到次數用的是函式型更新：第二次失敗要再跳一次。
    5. 送 `ddi_mounting` 再送 `ddi_mounted`：遮罩關掉，沒有 toast。
    6. 送 `ddi_not_mounted`：沒有 toast。
  - toast 只顯示 10 秒，截圖不一定來得及，可以用 MutationObserver 記錄畫面變化。每一步的結果記到 Comments。
- 沒查證，要寫明：iOS 16 實機真的掛載失敗的完整流程。triage 時沒有 iOS 16 手機。
- 人工核對 grep 驗不到的：
  - 第 2 節：前端沒有用 `setError`；次數用函式型更新；`App.tsx` 那個 effect 的依賴只有次數；toast 文字跟第 2 節一字不差。
  - 第 3 節：`except AlreadyMountedError:` 在 `except Exception` 前面；`mounted = True` 之後 `finally` 送的是 `ddi_mounted`。
  - 第 1 節：遮罩的標題和說明文字還在。
  - 新測試：從 `get_location_service` 進去；沒有檢查 payload 剛好等於某個 dict；docstring 照現有測試的格式。
- Commit：
  - 開票和 triage 用 `.scratch:`。
  - 實作用 `裝置連線:`，依原因分四個 commit，照下面的順序：
    1. 第 1 節：拿掉 `ddiStage` 階段進度 UI。commit 訊息寫明：v0.2.58（`051de0e`）拿掉 personalized DDI 自動掛載後就走不到；原版在 `f878de3`。
    2. 第 2 節後端、第 3 節和新測試：commit 訊息寫到兩件事：
       - `error` 從 v0.2.5（`d512094`）加上起就沒人讀。
       - `AlreadyMountedError` 被當成掛載失敗。先修這個，下一個 commit 加的提示才不會誤報。
    3. 第 2 節前端：`ddi_mount_failed` 時跳 toast。commit 訊息寫明為什麼不用 `setError`（會被 `device_connected` 清掉）、只在確定失敗時提示的原則，以及 toast 為什麼也寫開發者模式。
    4. 第 4 節：遮罩標題拿掉「首次」、說明文字拿掉「約 20MB」。commit 訊息寫上 classic DDI 實際的大小，和遮罩不只第一次連線會出現。
  - 結果用 `.scratch:`。

## 不做

- 雙機模式下副裝置的 DDI 事件：hook 的主裝置過濾（`useSimulation.ts:469-476`）會把它丟掉，所以副裝置（iOS 16）掛載失敗時不會跳 toast。
  - 這跟遮罩現在的行為一樣：副裝置掛載時也不會打開遮罩。
  - 要改就得動主裝置過濾，影響其他所有事件。
- 把遮罩狀態改成每台裝置各一份，見「看過、沒列入」。
- `tunnel_lost`、`device_disconnected` 改用 `strings.ts`，和 `:591` 那句不正確的註解，見「看過、沒列入」。
- 用 `setError` 提示，或讓 `device_connected` 不清錯誤橫幅：理由見第 2 節現況。後者會動到現有斷線橫幅的邏輯。
- 顯示後端的錯誤文字，或在 toast 裡帶裝置名稱。
- 依失敗原因給不同的提示，例如 `DeveloperDiskImageNotFoundError`（repo 裡沒有這個 iOS 版本的映像檔）。
  - 開發者模式沒開（`DeveloperModeIsNotEnabledError`）也不另外接：第 2 節的文字已經寫了開發者模式。另外接就要在事件裡加原因欄位，跟第 2 節只送 `udid` 相反。
  - 也不改成後端先查開發者模式、沒開就不掛：那樣沒看 README 的人什麼提示都看不到。
- 改 120 秒的逾時或加重試。
- 前端單元測試，和為此安裝的測試工具。
- 05 號票的範圍：README、`ddi_not_mounted` 的提示、`useSimulation.ts:579-585` 的註解、`frontend/src/services/api.ts` 的開發者模式提示。

## 看過、沒列入

- iOS 17+ 不會打開進度遮罩。只有 `ddi_mounting` 會打開它（`useSimulation.ts:565`），而後端只在 iOS 16 的 classic 掛載送這個事件（`device_manager.py:556`）。所以 `ddi_not_mounted` 的處理（`useSimulation.ts:578-589`）關遮罩，實際上沒有作用。
  - 遮罩狀態 `ddiMounting` 是所有裝置共用一個。但 hook 會丟掉不是主裝置的事件（`:469-476`），所以只有在還沒有主裝置時，兩台的事件才都會進來。例如兩台在選出主裝置前同時連線：iOS 17+ 那台送出 `ddi_not_mounted`，可能把 iOS 16 那台還在掛載的遮罩提早關掉。
  - 2026-11-07 triage 決定：記在這裡，這次不修。要同時接 iOS 16 和 iOS 17+，還得剛好碰上 iOS 16 正在掛載才會發生，沒人回報過。要修得把遮罩狀態改成每台裝置各一份，是另一件事。
- hook 裡的提示字有兩種寫法，這張的新提示用 `strings.ts`，另一種留著待清：
  - `useSimulation.ts:592-594`（`tunnel_lost`）和 `:607-609`（`device_disconnected`）把中英文直接寫在 hook 裡，靠 `localStorage` 判斷語言。
  - `:591` 的註解說 hook 拿不到 i18n context。但 `useSimulation` 是在 `App.tsx:96` 呼叫的，`App` 在 `I18nProvider` 裡面（`frontend/src/main.tsx:10`），其實拿得到。
  - 這張的 toast 由 `App` 用 `t()` 顯示，用不到 hook 裡的 i18n，所以不碰這兩處。
- `useSimulation.ts:579-585` 的註解，三個說法都過時了：
  - 說不把 hint 顯示成橫幅：`hint` 在 03 號票已經拿掉。
  - 說這個警告每次重連都誤報：`b847d3d` 可能已經修好，見 05 號票的 Comments。
  - 說要關掉進度遮罩：iOS 17+ 根本不會打開遮罩，見上面第一項。
  - 現在不提示的真正理由，是 triage 定的原則，見「定案」。
  - 2026-11-07 決定交給 05 號票：註解最後一句「真的沒掛的人，要到瞬移、導航失敗時才會看到錯誤」，就是 05 號票實機要查的事。在這張改寫，等於寫下一句還沒查證的註解。

## 定案

2026-11-07 triage 時由使用者決定，跟 05 號票一起：

- 提示原則：只在 LocWarp 確定失敗時提示，不對連線時的預檢結果提示。這張第 2 節要提示，05 號票不恢復提示。
- 第 1 節：拿掉階段進度 UI 和 10 個字串。
- 第 2 節：`error` 拿掉，只送 `udid`；前端在 `ddi_mount_failed` 時用 `App` 現成的 `showToast` 顯示 10 秒，文字見第 2 節。
- 第 3 節：`AlreadyMountedError` 當成已掛好，併進來。
- 第 4 節：「約 20MB」拿掉數字，併進來。
- 一張票做完，分四個 commit。
- 測試：後端新增 `test_classic_ddi_mount_events.py`，兩項檢查；前端不寫單元測試，改用型別檢查和瀏覽器驗證。
- 順序：這張不等 05、06。06 號票 triage 時如果決定改名，標 `Blocked by: 04`，因為兩張都改 `device_manager.py`。（06 號票 2026-11-07 改成 `wontfix`，這條用不到。）
- 遮罩那個發現記在「看過」，不修。

2026-11-07 看過另一個 session 對六張票的 review 後，使用者決定：

- 第 2 節：toast 文字加上開發者模式。不依原因分提示，後端也不先查開發者模式。次數用函式型更新。
- 第 4 節：標題「首次設定裝置中」改成「準備裝置中」，併進來。
- `useSimulation.ts:579-585` 的註解交給 05 號票，這張不改。
- 順序：這張先做，wifi-keepalive-restore 01、02 號票標 `Blocked by` 這張。

## Comments

- 2026-11-07：從 03 號票 triage 時的發現開出來的。開票時重新對過：
  - 前端 `ddiStage`、`ddi.stage_*`、`ddi.eta_*` 的所有使用處。
  - 後端唯一送 `ddi_mounting` 的地方（`:562`），只帶 `udid`。
  - `f878de3` 加了送 `stage` 和 `elapsed` 的地方，`051de0e` 又拿掉。
  - `ddi_mount_failed` 的所有消費端，以及前端從 `1581890` 起就不讀它的 payload。
  - `error` 是 `d512094` 加的。
- 2026-11-07 triage 第一回合（跟 05 號票一起）：Status 維持 `needs-triage`，還在 triage。03 號票已 resolved，`Blocked by` 改成 (none)。

  > *This was generated by AI during triage.*

  - 已定：
    - 第 2 節選「前端提示」。原則跟 05 號票一起定：只在 LocWarp 確定失敗時提示，不對連線時的預檢結果提示。classic DDI 是 LocWarp 自己去掛、真的失敗了，所以要提示；05 號票的 `ddi_not_mounted` 是預檢結果，不提示。
    - 不論前端怎麼提示，`error` 都拿掉，只送 `udid`：提示用 `strings.ts` 的字，不讀 `error`。`ddi_mount_failed` 事件本身要留。
    - 「iOS 17+ 不會打開進度遮罩」記在「看過」，這次不修。
  - 開票後重新對過（`1393369`），後端行號跟著 03 號票移動：`ddi_mounting` 在 `device_manager.py:556`，失敗的 warning 在 `:566`，`error` 在 `:573`。前端行號沒變。
  - 新發現，下一回合決定：
    - 用 `setError` 提示會馬上被清掉。`api/device.py:43` 先建 engine，iOS 16 會在這裡掛 classic DDI、送出 `ddi_mount_failed`；`:46` 接著送 `device_connected`，前端收到它就 `setError(null)`（`useSimulation.ts:454`）。`:1643`→`:1648`、`main.py:590`→`:595` 也是同樣順序。
    - 已經掛好也可能被當成失敗。`_ensure_classic_ddi_mounted` 第一次查詢丟例外時（`:540-541`），只記 warning 就繼續呼叫 `auto_mount_developer`。後者自己再查一次，有掛就丟 `AlreadyMountedError`（pymobiledevice3 11.49.5 `mobile_image_mounter.py:598-599`），會被 `:565` 的 `except Exception` 當成失敗，送出 `ddi_mount_failed`。加上提示後，這就是誤報。
    - classic DDI 不是 20MB。pymobiledevice3 從 `doronz88/DeveloperDiskImage` 下載（`developer_disk_image/repo.py:14`）。2026-11-07 用 `curl -I` 查 raw.githubusercontent.com 的 `Content-Length`：16.0 是 8,464,365 bytes，16.4 和 16.7 是 7,432,520 bytes。本機已經有映像檔時不下載（`mobile_image_mounter.py:600-601`）。
    - hook 裡的提示字有兩種寫法。`useSimulation.ts:592-594`（`tunnel_lost`）和 `:607-609`（`device_disconnected`）把中英文直接寫在 hook 裡，`:591` 的註解說 hook 拿不到 i18n context。但 `useSimulation` 是在 `App.tsx:96` 呼叫的，`App` 在 `I18nProvider` 裡面（`main.tsx:10`），其實拿得到。
- 2026-11-07 triage 第二回合：照使用者的決定定案，改成 `ready-for-agent`。

  > *This was generated by AI during triage.*

  - 決定見「定案」。第 1-5 節的「要改」、「要留」、「驗收」、「不做」是這次補的。行號全部換成 `1393369` 時的位置。
  - 更正第一回合的一點：第一回合「看過」寫「雙機模式下，iOS 17+ 那台的 `ddi_not_mounted` 可能把 iOS 16 那台的遮罩提早關掉」，少考慮了主裝置過濾。hook 會丟掉不是主裝置的事件（`useSimulation.ts:469-476`），所以只有在還沒有主裝置時才可能發生，「看過」已改。同一個過濾也讓副裝置的掛載失敗不會跳 toast，記在「不做」。
  - 試跑和檢查（`1393369`）：
    - 第 5 節的假物件在暫存區試跑過：
      - 掛載丟例外：`ddi_mounting` → `ddi_mount_failed`（帶 `error`）。
      - 查詢失敗加 `AlreadyMountedError`：同樣是 `ddi_mounting` → `ddi_mount_failed`，證實第 3 節。
      - 掛載成功：`ddi_mounting` → `ddi_mounted`。
      - 三種情況假的 `auto_mount_developer` 都被呼叫 1 次，`get_location_service` 都回傳 `LegacyLocationService`。
    - `frontend/node_modules/.bin/tsc --noEmit -p frontend` 結束碼 0，涵蓋 `frontend/src` 47 個檔。
    - 驗收裡的 grep，在 `1393369` 上對過現在的處數：`payload` 3 處、`ddi.mounting_hint` 2 處、`ddi_mount_failed` 在 `backend` 1 處、`20MB` 在 `frontend/src` 1 處（`strings.ts:824`）。
- 2026-11-07：另一個 session 看完 device-dead-code 六張票（HEAD `eebf97e`）後給了建議。逐條對過程式碼，照使用者的決定改了這張票，Status 維持 `ready-for-agent`。

  > *This was generated by AI during triage.*

  - 採納：
    - 開發者模式沒開也會送 `ddi_mount_failed`，原本的 toast 只叫人檢查網路，方向不對。讀程式碼確認過（`README.md:222`；pymobiledevice3 `mobile_image_mounter.py:600-602`、`:391`、`:74-75`），沒有 iOS 16 實機。改了第 2 節的文字和「不做」。
    - 跟 wifi-keepalive-restore 的票會互相打壞範圍檢查：keepalive 02 號票會改 `device_manager.py:352` 的 `disconnect`，01 號票會改 `strings.ts:326-330`。定成這張先做，兩張標 `Blocked by` 這張；動手前先確認 `1393369` 之後沒有別的程式碼改動。
    - 次數要用函式型更新：事件處理在 `useSimulation.ts:684` 的 `useEffect` 裡，讀到的 state 是舊的。寫進第 2 節「要改」和人工核對。
    - 遮罩標題的「首次」：併進第 4 節。`strings.ts:823` 本來就在範圍檢查允許的 `823-834` 裡，範圍檢查不用改。
  - 更正：第一回合的 Comments 和第 2 節現況原本寫「`api/device.py:43` 先建 engine，iOS 16 會在這裡掛 classic DDI」。`:43` 在 `/wifi/tunnel` 路由裡，只有 iOS 17+ 會走到；iOS 16 用 USB 連線走 `connect_device`（`:1643`→`:1648`）。第 2 節現況已改，第一回合的 Comments 是當時的紀錄，沒改。「用 `setError` 會被清掉」的結論不變。
  - 部分採納：`useSimulation.ts:579-585` 的註解確實過時，但交給 05 號票，不併進這張，理由見「看過、沒列入」。
  - 另開：`DeviceLostError.REASON_DDI_MISSING` 從來沒被丟過，開成 07 號票。它改的檔案跟這張的五個檔沒有重疊。
  - 行號：`git log 1393369..HEAD -- ':!.scratch'` 是空的，`1393369` 的行號都還對。
