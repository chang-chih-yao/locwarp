# 05 裝置連線：README 說 LocWarp 會提示「未偵測到 DDI」，但前端從 v0.2.96 起就不顯示

Status: needs-triage
Blocked by: 03
Type: task
相關：`.scratch/device-dead-code/issues/03-dvt-location-service-leftovers.md` 第 3 節現況和「不做」。另一個 session 審 03 號票時發現：03 號票驗收要求找不到 `iPhone 上未偵測到 DDI`，但 README 也有這段字。04 號票第 2 節是同一類問題（DDI 出問題時要不要提示使用者），但在 iOS 16 的 classic DDI。

## 為什麼

README 教使用者：看到「未偵測到 DDI」的提示，就去幫 iPhone 掛 DDI。但 LocWarp 從 v0.2.96 起就不會顯示這個提示。iOS 17+ 沒掛 DDI 的使用者照 README 等這個提示，會等不到。

下面的行號都是 `b21190c` 時的位置，開票時逐一對過。動手前以內容為準，先用 grep 再對一次。

`Blocked by: 03`：03 號票的驗收要求 `git diff 9cd9b56 --stat -- ':!.scratch'` 只能有 `device_manager.py` 和它新增的測試。這張要是先做，03 號票的範圍檢查就過不了。

## 現況

- README 的四處：
  - `README.md:233`（步驟 4「掛載 Developer Disk Image(iOS 17+)」）：「如果提示「iPhone 上未偵測到 DDI」,請用下列任一工具幫 iPhone 掛一次」。
  - `README.md:260`（疑難排解表）：第一欄是「`No such service: com.apple.instruments.dtservicehub`,或提示「未偵測到 DDI」」。
  - `README.en.md:233`、`:260`：意思一樣，英文寫成「No DDI detected on the iPhone」、「No DDI detected」。
- 程式實際的行為（iOS 17+，DDI 沒掛）：
  - 建立 simulation engine 時（`backend/main.py:213`）會呼叫 `get_location_service`。`_ensure_personalized_ddi_mounted` 檢查到沒掛，就廣播 `ddi_not_mounted`（`backend/core/device_manager.py:510`），附一段中文 `hint`。
  - 前端 `frontend/src/hooks/useSimulation.ts:578-589` 收到後只關掉進度遮罩，不顯示任何東西。
  - `:579-585` 的註解寫了原因：多數 iOS 17+ 使用者的 DDI 已經由別的工具掛好，這個警告每次重連都會誤報。真的沒掛的人，要到瞬移、導航失敗時才會看到錯誤。
  - 03 號票第 3 節會拿掉 `hint`。做完之後，除了 README 和 `.scratch`，repo 裡就沒有任何地方有這段字。
- 歷史（用 `git log -S` 和 `git tag --contains` 查的）：
  - v0.2.58（`051de0e`）拿掉 DDI 自動掛載。前端收到 `ddi_not_mounted` 時，改成用 `setError` 顯示 `hint`。
  - `dd684ee` 在 README 疑難排解表寫了「LocWarp 跳「iPhone 上未偵測到 DDI」」，那時是對的。它跟 v0.2.58 同一天，第一個包含它的 tag 是 v0.2.64。
  - v0.2.96（`3fe4d69`）前端拿掉顯示，README 從那時起就不對了。
  - v0.2.198（`73e3b42`）中英文 README 重寫，沿用這個說法，寫成現在的 `:233`、`:260`。英文版是這次才有這段，所以從寫下來那天就不對。
- `git grep -n -e '未偵測到 DDI' -e 'No DDI detected' -- ':!.scratch'` 只找到 README 這四處，和 `device_manager.py:513` 的 `hint`。

## 待決定

- 做法：
  - 改 README，照現在的行為寫：連線時不會有提示，DDI 沒掛要到瞬移或導航失敗時才看得出來。
    - 要先查清楚使用者實際看到什麼錯誤，才寫得出讓使用者對照的字，見「沒查證的」。
    - 步驟 4 前面那句「LocWarp 只會檢查,不會自動下載或掛載」還是對的，留著。
  - 或是讓前端重新提示，README 就又對了。這是改行為：
    - v0.2.96 拿掉提示，就是因為每次重連都會誤報（`useSimulation.ts:579-585`）。要重新提示，得先處理誤報。
    - 提示文字要放在 `frontend/src/i18n/strings.ts`，不是顯示後端寫死的中文 `hint`，理由見 03 號票第 3 節。
- 不論選哪個，中英文兩份 README 都要一起改。

## 沒查證的

- 使用者實際看到的錯誤：
  - DVT 失敗時，`_create_dvt_location_service` 會退回 `LegacyLocationService`，DVT 的錯誤只記 log。`LegacyLocationService` 要到第一次 `set()` 才開 `DtSimulateLocation`。所以 iOS 17+ 沒掛 DDI 時，如果有錯誤，是在第一次瞬移時才出現，而且不是 DVT 的錯誤。
  - 這時畫面上會出現什麼字，沒有查證。要接一支沒掛 DDI 的 iOS 17+ 手機，或是追 `LegacyLocationService.set()` 失敗時 API 回什麼。
  - 前端 `frontend/src/services/api.ts:82-90` 的 `maybeAttachDevModeHint`：錯誤訊息裡有 `InvalidService` 時，會在後面加上「請檢查 iPhone 開發者模式是否已啟用」。如果 DDI 沒掛時的錯誤也有 `InvalidService`，使用者會被指去查開發者模式，不是去掛 DDI。這點也沒有查證。
- `README.md:260`、`README.en.md:260` 第一欄的 `No such service: com.apple.instruments.dtservicehub`，以及 `docs/locwarpsetup.html:222` 寫同一件事的那列：DVT 的錯誤在 `get_location_service` 這條路上只記 log，使用者在畫面上還會不會看到這段字，沒有查證。

## 待 triage 決定

- 選哪個做法。
- 要不要先查證「沒查證的」那幾項。改 README 的做法需要先查清楚；如果得接實機，就是 `ready-for-human`。
- 疑難排解表第一欄的 `dtservicehub`，和 `docs/locwarpsetup.html:222`，要不要一起處理。
- 測試：只改 README 不用測試；選重新提示的話，定案時再看。
- 定案後補「要改」、「驗收」、「不做」，再改成 `ready-for-agent` 或 `ready-for-human`。

## Comments

- 2026-11-07：從另一個 session 對 03 號票的第二次 review 開出來的。開票時重新對過：
  - README 四處的文字和行號。
  - 前端 `ddi_not_mounted` 的處理，和 `useSimulation.ts:579-585` 的註解。
  - 歷史：`051de0e` 加上顯示、`dd684ee` 寫進 README、`3fe4d69` 拿掉顯示、`73e3b42` 重寫 README。
  - `git grep` 只找到 README 四處和 `device_manager.py:513`。
