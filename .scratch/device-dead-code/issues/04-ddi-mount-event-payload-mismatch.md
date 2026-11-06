# 04 裝置連線：DDI 掛載事件前後端對不上（`ddi_mounting` 的 `stage`/`elapsed` 後端已不送、`ddi_mount_failed` 的 `error` 前端不讀）

Status: needs-triage
Blocked by: 03
Type: task
相關：`.scratch/device-dead-code/issues/03-dvt-location-service-leftovers.md` 的「不做」最後一項。03 號票 triage 時順便發現，跟 03 號票第 3 節的 `hint` 是同一類，但在 iOS 16 classic DDI 和前端進度 UI 那邊，所以另開這張。

## 為什麼

兩處都是 DDI 掛載事件的前後端對不上，留著會誤導讀 code 的人：

- 第 1 節：前端會讀 `ddi_mounting` 的 `stage`、`elapsed`，畫一整段階段進度 UI。但後端從 v0.2.58 起就沒有任何地方送這兩個欄位，這段 UI 永遠不會出現。
- 第 2 節：後端在 `ddi_mount_failed` 附了 `error`，但前端從來沒讀過。

現在都不會造成錯誤。

下面的行號都是 `933d910` 時的位置，開票時逐一對過。03 號票會改 `device_manager.py`，`:562`、`:579` 會往上移。動手前和驗收時都以內容為準，先用 grep 再對一次。

`Blocked by: 03`：03 號票的驗收要求 `git diff 9cd9b56 --stat -- ':!.scratch'` 只能有 `device_manager.py` 和它新增的測試。這張要是先做，03 號票的範圍檢查就過不了。

## 1. `ddi_mounting` 的 `stage`、`elapsed`：前端還在讀，後端已經不送

現況：

- 前端：
  - `frontend/src/hooks/useSimulation.ts:265` 有 `ddiStage` 這個 state。
    - `:564-571` 收到 `ddi_mounting` 時，payload 有 `stage` 才 `setDdiStage`。
    - `:575`、`:587` 在 `ddi_mounted`、`ddi_mount_failed`、`ddi_not_mounted` 時清掉它。
    - `:1179` 把它傳出去。
  - `frontend/src/App.tsx:2238-2277` 在 `ddiStage` 有值時，在進度遮罩裡畫進度條、階段名稱和經過秒數。
    - `:2239-2241` 的註解說，階段名稱對應後端 `_staged_personalized_mount` 裡的 `emit()`。這個函式現在已經不存在，repo 裡（不含 `.scratch`）只剩這行註解提到它。
  - `frontend/src/i18n/strings.ts:825-834` 是這段 UI 用的 10 個字串：`ddi.stage_*` 6 個、`ddi.eta_*` 4 個。
- 後端：現在唯一送 `ddi_mounting` 的是 `backend/core/device_manager.py:562`，在 iOS 16 的 `_ensure_classic_ddi_mounted` 裡，只帶 `udid`。
- 歷史：
  - v0.2.56（`f878de3`）加了 `_staged_personalized_mount`。iOS 17+ 自動掛載 personalized DDI 時，它會用 `ddi_mounting` 送 `stage` 和 `elapsed`，前端的階段 UI 和字串也是這個 commit 加的。
  - 隔一版 v0.2.58（`051de0e`）拿掉 personalized DDI 自動掛載，`_staged_personalized_mount` 和送 `stage` 的地方跟著拿掉，前端沒動。
  - 所以從 v0.2.58 起，`ddiStage` 永遠是 `null`，`App.tsx:2238-2277` 永遠不會畫出來。
- `git grep -n -e ddiStage -e setDdiStage -e "ddi\.stage_" -e "ddi\.eta_" -- ':!.scratch'` 只有上面這些地方，沒有別的消費端。`tests/frontend/` 也沒有測試用到。

待決定：

- 拿掉前端的階段 UI：
  - `ddiStage` 這個 state 和三處 `setDdiStage`。
  - `useSimulation` 回傳的 `ddiStage`。
  - `App.tsx:2238-2277`。
  - `strings.ts` 的 10 個字串。
- 或是留著，給以後可能的分階段進度用。要用的話，後端得重新送 `stage`。

## 2. `ddi_mount_failed` 的 `error`：後端有送，前端不讀

現況：

- 後端：`device_manager.py:573-582` 是 `_ensure_classic_ddi_mounted` 的 `finally`。掛載失敗時，送 `ddi_mount_failed`，payload 是 `udid` 加上 `error: "Classic DDI mount failed"`（`:579`）。
- 前端：`useSimulation.ts:572-577` 收到 `ddi_mount_failed` 時，跟 `ddi_mounted` 走同一段：只關掉進度遮罩、清掉 `ddiStage`，payload 完全不讀。
- 歷史：
  - 前端這段從 v0.1.33（`1581890`）加上進度遮罩起，收到 `ddi_mount_failed` 就只關遮罩，從來沒讀過 payload。
  - classic 這條路和 `error` 是 v0.2.5 那次 iOS 16 支援（`d512094`）加的。所以 `error` 從寫下來那天起就沒人讀。
- `git grep -n ddi_mount_failed -- ':!.scratch'` 只有 `device_manager.py:576` 和 `useSimulation.ts:573`，沒有別的消費端。
- 結果：iOS 16 的 classic DDI 掛載失敗時，遮罩直接消失，使用者看不到任何提示。錯誤要到真的送位置時才會出現。同一件事在 `:572` 有英文 warning log。

待決定：

- 拿掉 `error`，只送 `udid`。比照 03 號票第 3 節的 `hint`。
- 或是讓前端在 `ddi_mount_failed` 時提示使用者。
  - 這是改行為，不是清理。
  - 提示文字應該放在 `strings.ts`，不是直接顯示後端的英文 `error`。
  - 跟 `ddi_not_mounted` 不一樣：那個事件在 iOS 17+ 每次重連都會誤報，所以 v0.2.96 拿掉了提示；這個是真的掛載失敗。
- 不論選哪個，事件本身都要留，前端靠它關掉進度遮罩。

## 看過、待 triage 決定要不要併入

- 進度遮罩的說明文字 `ddi.mounting_hint`（`strings.ts:824`）：「正在準備 Developer Disk Image(約 20MB),請保持網路連線」。
  - 這段是 v0.1.33（`1581890`）為 iOS 17+ 的 personalized DDI 寫的。從 v0.2.58 起，會打開遮罩的只剩 iOS 16 的 classic DDI 掛載（`device_manager.py:562`）。
  - 「請保持網路連線」還是對的：classic 掛載用的是 `pymobiledevice3` 的 `auto_mount_developer`（11.49.5），本機沒有映像檔時會下載。
  - 「約 20MB」是 personalized DDI 的大小：`_ensure_personalized_ddi_mounted` 的 docstring 寫「the 20MB image upload」。03 號票會把它改名成 `_check_personalized_ddi_mounted`。classic DDI 實際多大，**沒有查證**。
  - 這是使用者看得到的字串，改了就是改行為。

## 待 triage 決定

- 第 1、2 節要做哪幾項。可以一張票做完，或拆開。
- 第 1、2 節各選哪個做法。
- 「看過」那段的 `約 20MB` 要不要查證、併進來。
- 測試：
  - 第 1 節拿掉的是走不到的前端 UI，不改行為。
  - 第 2 節選「拿掉」會改後端送出的內容；選「提示」是新行為。
  - `useSimulation.ts`、`App.tsx` 現在都沒有測試。要不要、能不能寫出 mutation check 抓得到的測試，定案時再看。
- 定案後補「要改」、「驗收」、「不做」，再改成 `ready-for-agent`。

## Comments

- 2026-11-07：從 03 號票 triage 時的發現開出來的。開票時重新對過：
  - 前端 `ddiStage`、`ddi.stage_*`、`ddi.eta_*` 的所有使用處。
  - 後端唯一送 `ddi_mounting` 的地方（`:562`），只帶 `udid`。
  - `f878de3` 加了送 `stage` 和 `elapsed` 的地方，`051de0e` 又拿掉。
  - `ddi_mount_failed` 的所有消費端，以及前端從 `1581890` 起就不讀它的 payload。
  - `error` 是 `d512094` 加的。
