# 01 LocWarp 存的 cookie 失效時，擴充功能可能不會自己補推

Status: needs-triage
Blocked by: (none)
Type: bug

## 現況

- 2026-11-10 凌晨驗 `pipi-flower-essence` 02 號票時，LocWarp 存的 cookie 已經失效。那份是前一天 22:37 由擴充功能推的；`/api/pipi/items` 和 `/api/pipi/essence` 都回 401（`pipi_login_required`）。
- 使用者在 Chrome 登入 pipimushroom.com 之後，`/api/pipi/status` 的 `updated_at` 沒變，backend log 也沒有 `PUT /api/pipi/cookie`。
- 請使用者點擴充功能的圖示之後，00:10:33 才推進來。

## 推測原因

讀程式碼的判斷，沒有確認擴充功能當時的狀態。

- `extensions/pipi-cookie-sync/background.js` 的 `doSync`：每分鐘的 alarm 在沒有 `dirty`、狀態是 `synced`、而且 `GET /api/pipi/status` 回 `configured: true` 時直接 return。
- `configured` 只表示 LocWarp 存了 cookie，不表示那份還能用。status 也沒有別的欄位說它失效了。
- 所以 LocWarp 那份失效、擴充功能又自認已同步時，只有 cookie 變動（`change`）或點圖示（`force`）才會再推。

## 沒確認的部分

- 當時擴充功能存的 `state`、有沒有 `dirty`、badge 顯示什麼。
- 使用者登入時 Chrome 的 cookie 有沒有變。有變卻沒推的話，問題在 `change` 那條路，不是上面的推測。

## 修的時候要守的限制

- `.claude/rules/pipi-mushroom.md`：擴充功能在已同步時不能連原站，所以不能改成每分鐘去探原站。可能的方向是讓 LocWarp 的 status 說出它存的那份已經失效，擴充功能看到再推；要不要這樣做待決定。
- 改了擴充功能要 bump `manifest.json` 的 `version`。
