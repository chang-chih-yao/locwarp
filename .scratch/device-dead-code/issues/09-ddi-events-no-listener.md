# 09 裝置連線：後端照樣送 `ddi_mounted`、`ddi_not_mounted`，前端從 `c20a1b6` 起沒人收

Status: ready-for-agent
Blocked by: (none)
Type: task
相關：`.scratch/device-dead-code/issues/05-readme-ddi-not-mounted-prompt.md` 2026-11-07 拿掉 iOS 16 那筆 Comment。這件事原本寫在那裡，說要等 05 號票重新 triage 時一起決定。2026-11-08 照使用者的決定拆成這張。

## 為什麼

`_check_personalized_ddi_mounted` 每次建立定位服務都會廣播 `ddi_mounted` 或 `ddi_not_mounted`，但 repo 裡已經沒有消費端。讀 code 的人會以為前端會依這兩個事件做事，例如提示使用者沒掛 DDI。

- 對 iOS 17+ 來說，這兩個事件在前端拿掉處理之前就已經沒有作用。前端收到時只會關掉進度遮罩，但 v0.2.58（`051de0e`）起，只有 iOS 16 的 classic 掛載會送 `ddi_mounting` 打開遮罩，iOS 17+ 不會打開它。
- `ddi_not_mounted` 只在 v0.2.58 到 v0.2.96 之間顯示過 `hint`。v0.2.96（`3fe4d69`）起也只剩關遮罩。
- 現在不會造成錯誤，只是每次建立定位服務時，多送一則沒人讀的 WebSocket 訊息。

下面的行號都是 `ae81c34` 時的位置，開票時逐一對過。動手前以內容為準，先用 grep 再對一次。

## 現況

- 送出的地方，都在 `backend/core/device_manager.py` 的 `_check_personalized_ddi_mounted`（`:410`）：
  - `:443`：RSD 有廣播 DVT 的服務（`com.apple.instruments.dtservicehub`）時，送 `ddi_mounted`。
  - `:476`：`mobile_image_mounter` 回報已經掛好時，送 `ddi_mounted`。
  - `:488`：沒掛時送 `ddi_not_mounted`，前面是 `:481-485` 的 warning。
  - 三處的 payload 都只有 `udid`，也都包在 `try:` / `from api.websocket import broadcast` / `except Exception: pass` 裡（`:441-445`、`:474-478`、`:486-490`）。
  - docstring（`:420-424`）寫了沒掛時會廣播 `ddi_not_mounted`，沒提到 `ddi_mounted`。
  - `mobile_image_mounter` import 失敗（`:448-455`）或查詢失敗（`:468-470`）時，只記 warning，兩個事件都不送。
- 消費端：沒有。
  - `git grep -n -w -e ddi_mounted -e ddi_not_mounted -- ':!.scratch'` 只找到上面的 `device_manager.py` 四處（三處 broadcast 加 docstring），和下面的測試。`-w` 是為了避開 `_check_personalized_ddi_mounted` 這類函式名。
  - `frontend`、`backend/static/phone.html` 都沒有。`frontend/src/services/api.ts:46` 的 `device_lost_ddi_missing` 是另一件事，見 07 號票。
  - `broadcast`（`backend/api/websocket.py:16`）只是把同一則訊息送給所有連線。
- 測試：`tests/device/test_dvt_location_fallback.py`
  - (b)（`:92-95`）斷言 `ddi_not_mounted` 照樣會廣播，payload 帶這台的 `udid`。這是 03 號票第 5 節加的，鎖的是「前端靠它關掉進度遮罩」，這個理由在 `c20a1b6` 之後已經不成立。
  - docstring（`:6-9`）寫了前端已經不收這個事件，要不要留交給 05 號票決定。這張定案後要改成指向這張。
  - `ddi_mounted` 沒有測試。`FakeLockdown` 沒有 `peer_info`，`:443` 那條路也沒跑到。
- 歷史（用 `git log -S` 查的）：
  - `1581890`（v0.1.33）前端加上進度遮罩，收到 `ddi_mounted` 時關掉。
  - `051de0e`（v0.2.58）拿掉 DDI 自動掛載，後端開始送 `ddi_not_mounted`，前端用 `setError` 顯示 `hint`。personalized 那條路從這版起不再送 `ddi_mounting`。
  - `3fe4d69`（v0.2.96）前端不再顯示，收到 `ddi_not_mounted` 時只關遮罩。
  - `b847d3d`（v0.2.206，還沒打 tag）預檢改成先看 RSD 的服務清單，多了 `:443` 那處 `ddi_mounted`。
  - `c20a1b6`（還沒打 tag）拿掉 iOS 16，前端的 `ddi_*` 處理一起刪了。commit 訊息寫了「後端照樣送 ddi_mounted、ddi_not_mounted，但前端已經沒人收，留給 device-dead-code 05 號票決定」。
- 上游 `upstream/main` 的 `frontend/src/hooks/useSimulation.ts:579`、`:585` 還收這兩個事件，用途是關掉 `ddi_mounting` 打開的進度遮罩。照 `AGENTS.md`，合併上游時要丟掉 iOS 16 的進度遮罩，這兩處也跟著丟。

## 可能的做法

- A. 拿掉兩個事件：
  - 拿掉三處 `try` / `broadcast`，docstring 改成沒掛時只記 warning。
  - 測試 (b) 要改成斷言不再送這兩個事件，或是拿掉 (b)、只留 (a)。docstring 也要跟著改。
  - 之後真的要提示時再加回來，例如 07 號票的做法 C，或 05 號票查證後決定要提示。
- B. 保留事件，前端收到 `ddi_not_mounted` 時提示使用者：
  - 跟 05 號票已經定的原則衝突：只在 LocWarp 確定失敗時提示，不對連線時的預檢結果提示。DVT 失敗後還會退回 `LegacyLocationService`，沒掛不一定等於定位會失敗。
  - v0.2.96 拿掉提示，是因為每次重連都會誤報。`b847d3d` 可能已經修好誤報，但只在 iOS 26.6.2、27.2 上看過。
  - 提示文字要放在 `frontend/src/i18n/strings.ts`，理由見 03 號票第 3 節。
  - `ddi_mounted` 還是沒人收，要另外決定。
- C. 不動，改成 `wontfix`：
  - 送事件不會出錯，代價只是幾行程式和一則沒人讀的訊息。之後有消費端時可以直接用。
  - 但 (b) 會繼續鎖住一個沒人用的行為。測試 docstring 也要改成指向這張，這是測試檔的變更。

## 待 triage 決定

- 選 A、B、C 哪個做法。**2026-11-08 已定：選 A，拿掉兩個事件**，理由見 Comments。
- 跟 05 號票的關係：
  - 05 號票選定的做法是改 README，不動 `device_manager.py`，兩張改的檔案沒有重疊。
  - 選 B 的話，README 要照新的提示寫，要跟 05 號票一起做。**選了 A，不適用，兩張各做各的。**
- 測試：
  - 選 A 的話要做 mutation check：把其中一處 `broadcast` 加回去，改過的 (b) 要失敗。**2026-11-08 已定：(b) 改成斷言沒送任何 `ddi_*` 事件，不刪**，見「要改」第 2 節、「驗收」。
  - 三個做法都要跑 `tests/device` 的測試。
- `AGENTS.md` 要不要補合併上游時丟掉這兩個廣播的規則。**2026-11-08 已定：不補**，理由見 Comments。
- 定案後補「要改」、「驗收」、「不做」，再改成 `ready-for-agent`。**已補，已改。**

## 定案

2026-11-08 triage 時由使用者決定：

- 選 A，拿掉 `ddi_mounted`、`ddi_not_mounted` 兩個事件。
- 測試 (b) 改成斷言沒送任何 `ddi_*` 事件，不刪。
- `AGENTS.md` 不補合併上游的規則。
- 標題和檔名不改：05 號票的 Comment 指向這個檔名。

## 要改

行號是 `ae81c34` 時的位置，動手前以內容為準。

### 1. `backend/core/device_manager.py` 的 `_check_personalized_ddi_mounted`

- 拿掉三段 `try:` / `from api.websocket import broadcast` / `await broadcast(...)` / `except Exception: pass`：`:441-445`、`:474-478`、`:486-490`。
- 兩個 `return`（`:446`、`:479`）留著：前一個是為了跳過 `mobile_image_mounter` 的查詢，後一個是為了跳過沒掛時的 warning。
- docstring `:421-422` 改寫：「broadcast ``ddi_not_mounted``」換成「log a warning」，其他字不動。改完是：

```text
        This method is therefore a pure status check. If the iPhone
        has DDI mounted we log it and return happily. If not, we log
        a warning and return anyway; the caller
        (``_create_dvt_location_service``) still tries DVT and falls back
        to ``LegacyLocationService`` if DVT fails.
```

- log 都不動：
  - `:437-440` 的 info：`DVT service ... advertised`。
  - `:473` 的 info：`Personalized DDI already mounted`。
  - `:481-485` 的 warning：`Personalized DDI is NOT mounted`。
  - import 失敗、查詢失敗時的兩個 warning。
  - 05 號票實機查證的第 2 步要看這幾行 log。

### 2. `tests/device/test_dvt_location_fallback.py`

- (b)（`:92-95`）改成兩個斷言：
  - `FakeMounter.is_image_mounted` 剛好被問一次，問的是 `"Personalized"`。
    - 照 `FakeDvtProvider` 記 `DVT_OPENS` 的做法，在 `FakeMounter` 記下每次查詢。
    - 沒有這筆記錄的話，檢查在走到沒掛那段之前就提早返回（例如 fake 出錯被接住），(b) 也照樣會過。
  - `BROADCASTS` 裡沒有任何 `ddi_` 開頭的事件。
    - 用前綴比對，不要寫死兩個事件名：前端已經不收任何 `ddi_*` 事件。
  - `:92` 的註解和 `:95` 印的訊息改成講「不送事件」，例如 `ok  DDI not mounted: the check broadcasts no ddi_* event`。
- `FakeMounter` docstring 的最後一句「returns without broadcasting, so check the fake first if (b) fails」，改成說明為什麼要記錄查詢。
- `:70-71` 的註解說 mounter 和 broadcast 是在使用它們的函式裡 import 的。改完之後，`device_manager.py` 已經沒有函式用 broadcast，所以要改寫：
  - mounter 照舊是在函式裡 import。
  - broadcast 一樣要換成 fake，這樣有人在函式裡把廣播加回來時，(b) 才看得到。上游就是在函式裡 import 的。
- module docstring `:3-9` 改寫：
  - (b) 的描述改成：走到沒掛那段，而且沒送任何 `ddi_*` 事件。
  - 「Both had to hold through the cleanup in 03 號票」改成只講 fallback。03 號票那時鎖的 (b) 已經改了。
  - 「交給 05 號票決定」改成指向這張，寫明兩個理由：前端從拿掉 iOS 16 起就不收這些事件；上游還在送，合併上游時可能被加回來。
  - 可以照試改時的寫法：

```text
"""DeviceManager.get_location_service on an iOS 17+ phone whose DVT provider
fails to open, e.g. because the Developer Disk Image is not mounted: it must
fall back to LegacyLocationService instead of raising, and the DDI status
check before it must reach its not-mounted branch without broadcasting any
ddi_* event. The fallback had to hold through the cleanup in
.scratch/device-dead-code/issues/03-dvt-location-service-leftovers.md. No
frontend has listened for ddi_* events since iOS 16 support was dropped, so
.scratch/device-dead-code/issues/09-ddi-events-no-listener.md removed them;
upstream still sends them, and a merge could bring them back.
```

- `fake_broadcast`、`BROADCASTS` 和 `websocket.broadcast = fake_broadcast` 留著，(b) 要靠它們看有沒有送出事件。
- (a) 不動。

## 驗收

triage 時在工作目錄照「要改」試改過一次（`:70-71` 的註解那時沒改，它不影響結果），下面每一項都照預期，之後已經用 `git checkout` 還原。

- 先紅：先改測試、還沒改 `device_manager.py` 時跑測試，(b) 要失敗，結束碼 1。
  - 試改時是 `AssertionError: [('ddi_not_mounted', {'udid': '00008110-PHONE'})]`。
- 再綠：兩邊都改完後跑 `.venv/Scripts/python.exe tests/device/test_dvt_location_fallback.py`，印出兩行 `ok` 和 `all ok`，結束碼 0。
- Mutation check：每次跑之前先刪掉 `backend`、`tests` 底下的 `__pycache__`。`c20a1b6` 遇過大小相同的改動沿用舊 bytecode。跑完要還原。
  - M1：在沒掛時的 warning 後面，把 `from api.websocket import broadcast` 和 `await broadcast("ddi_not_mounted", {"udid": conn.udid})` 加回去。(b) 的事件斷言要失敗。
  - M2：在 `_check_personalized_ddi_mounted` 函式本體的第一行加上 `return`。(b) 的查詢記錄斷言要失敗，試改時是 `AssertionError: []`。
- `tests/device` 底下 5 支測試都要印 `all ok`、結束碼 0。
- `git grep -n -w -e ddi_mounted -e ddi_not_mounted -- backend frontend`：找不到，結束碼 1。`-w` 是為了避開 `_check_personalized_ddi_mounted` 這類函式名。
- `git grep -n -e 'api.websocket' -e 'broadcast(' -- backend/core/device_manager.py`：找不到。
- log 還在，`git grep -c -F` 下面三段字，在 `backend/core/device_manager.py` 都剛好 1 處：
  - `developer services available`
  - `Personalized DDI already mounted`
  - `Personalized DDI is NOT mounted`
- `git diff ae81c34 --numstat -- ':!.scratch'`：只有 `backend/core/device_manager.py` 和 `tests/device/test_dvt_location_fallback.py`。
  - `device_manager.py` 照「要改」第 1 節的寫法會是 `2	17`，試改時就是這樣。數字對不上的話，就是改到別行，或整個檔案的換行字元被換掉了。
  - `ae81c34` 之後到實作前只會改 `.scratch`，所以用它當基準。
- 不用跑前端測試和 `tsc`，結果要寫明沒跑和原因：沒有改前端。前端本來就沒有 `ddi_*` 的處理，見「現況」。
- Commit：
  - 實作用一個 commit，前綴 `裝置連線:`，照 `fff1286`、`c20a1b6` 的慣例。測試和程式放在同一個 commit：如果把測試先拆成一個 commit，那個 commit 上的測試會是紅的。
  - commit 訊息要寫到：
    - 前端從 `c20a1b6` 起就不收這兩個事件。對 iOS 17+ 來說，從 v0.2.58 起它們就沒有作用了。
    - 上游的 `_ensure_personalized_ddi_mounted` 還在送。合併上游時丟掉上游那邊的廣播，(b) 會擋住沒掛時的 `ddi_not_mounted`。
    - log 留著，05 號票實機查證要看。
    - 先紅、再綠、M1、M2 的結果，和沒跑前端測試的原因。
  - 結果用 `.scratch:` 記到 Comments，`Status` 改成 `resolved`。

## 不做

- 前端：本來就沒有要拿掉的處理，也不加任何 `ddi_*` 的處理或提示（沒選 B）。
- `_check_personalized_ddi_mounted` 本身、它的名字、log 的文字：
  - 05 號票實機查證要看這些 log。
  - 名字是 03 號票定的。
  - 03 號票 Comments 和 06 號票「看過、沒列入」記過，「不回傳結果卻會廣播事件」跟「check」的預期不同。改完之後它不再廣播，這點就不成立了，不用另外處理。
- RSD 有廣播 DVT 服務、mounter 回報已掛這兩條路的測試：跟現在一樣沒測。
  - 合併上游時，如果上游在已掛那條路送的 `ddi_mounted` 被加回來，(b) 抓不到。
  - 上游在沒掛那條路送的 `ddi_not_mounted`，(b) 抓得到。
- `AGENTS.md`：不補合併上游的規則，理由見 Comments。
- `backend/api/websocket.py` 的 `broadcast`，和其他事件。
- 05 號票的 README，07 號票的 `REASON_DDI_MISSING` 和 `frontend/src/services/api.ts:46`。
- `backend/locwarp-backend.spec:23` 的註解：講的是 import 失敗時會跳過查詢，沒提到事件，改完還是對的。

## Comments

- 2026-11-08：開票。

  > *This was generated by AI during triage.*

  - 從 05 號票 2026-11-07 拿掉 iOS 16 那筆 Comment 拆出來，是使用者的決定。那筆 Comment 是當時的紀錄，沒有改，05 號票另外加了一筆 Comment 指向這張。
  - 開票時對過（HEAD `ae81c34`）：
    - 三處 broadcast、docstring、測試的行號。
    - `git grep -n -w` 的結果：`device_manager.py` 以外只有測試。
    - `c20a1b6^` 的前端只有 `useSimulation.ts` 收這兩個事件，兩個都只關遮罩。
    - `051de0e^` 和 `051de0e` 的 `device_manager.py`：拿掉自動掛載之後，只剩 classic 那條路會送 `ddi_mounting`。
    - `b847d3d` 加了 `:443` 那處 `ddi_mounted`。
    - 上游的 `useSimulation.ts:579`、`:585`。
- 2026-11-08 triage：照使用者的決定選 A，(b) 改成斷言沒送任何 `ddi_*` 事件，`AGENTS.md` 不補，改成 `ready-for-agent`。

  > *This was generated by AI during triage.*

  **查證（HEAD `ae81c34`）：**

  - 前端的 WebSocket 訂閱有四處：`useDevice.ts:88`、`:310`、`:327` 和 `useSimulation.ts:416`。四處都只處理指定的事件類型，沒有一處統一處理所有事件。`phone.html` 沒有 WebSocket 處理。
  - `frontend/src`、`backend/api` 沒有別的管道拿 DDI 狀態。前端跟 DDI 有關的只有 07 號票的 `device_lost_ddi_missing`。
  - 沒有 `.out-of-scope/` 和 `docs/adr/`，`GLOSSARY.md` 也沒有 DDI 的詞條。
  - `tests/device/test_dvt_location_fallback.py` 印 `all ok`，結束碼 0。
  - 上游 `upstream/main` 的 `_ensure_personalized_ddi_mounted`：已掛時送 `ddi_mounted`，沒掛時送 `ddi_not_mounted`，後者還附著 `hint`。

  **選 A 的理由：**

  - B 跟 05 號票已經定的原則衝突：只在 LocWarp 確定失敗時提示，不對連線時的預檢結果提示。
  - C 會讓 (b) 繼續鎖住一個理由已經不成立的行為，違反 `AGENTS.md` 的「Tests verify intent」。
  - A 只動一個函式和一支測試，不接手機也能驗。

  **(b) 改寫、不刪的理由：**

  - 上游還在送這兩個事件，合併上游時可能不知不覺加回來，(b) 會擋住沒掛時的那個。
  - 加上查詢記錄，是為了不讓 (b) 空過：只斷言「沒送事件」的話，檢查提早返回也會過。M2 驗的就是這點。

  **`AGENTS.md` 不補的理由：**

  - 有 (b) 擋著就夠了。
  - `AGENTS.md:16` 那條規則講的是 iOS 16 的程式，這兩個事件不是。

  **試改：**

  - 照「要改」在工作目錄試改過一次，結果記在「驗收」，之後已經用 `git checkout` 還原兩個檔案。
  - 先紅、再綠、M1、M2 都照預期。`tests/device` 5 支都印 `all ok`，`device_manager.py` 的 numstat 是 `2	17`。
  - `:70-71` 的註解試改時沒改，它是註解，不影響上面的結果。

  **brief 的格式：** triage skill 的 AGENT-BRIEF 要求不寫路徑和行號。這張照 repo 慣例（02、03、08 號票）寫路徑和行號，加上「以內容為準」，因為這幾張都是這樣實作、驗收的。

  **不建 `.out-of-scope/`：** 這是清 dead code，不是被否決的功能需求。
