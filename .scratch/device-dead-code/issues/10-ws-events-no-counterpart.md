# 10 裝置連線：`device_error`、`tunnel_degraded` 後端送了沒人收，`device_reconnected` 前端收了沒人送

Status: ready-for-agent
Blocked by: (none)
Type: task
相關：`.scratch/device-dead-code/issues/09-ddi-events-no-listener.md`。09 號票處理的是 `ddi_mounted`、`ddi_not_mounted` 沒人收。2026-11-11 另一個 session 審 device-dead-code 全部的票時，發現同一類還有這三個，照使用者的決定開成這張。

## 為什麼

三個 WebSocket 事件只有一邊在用：

- `device_error`、`tunnel_degraded`：後端會送，前端沒有任何地方處理。讀後端的人會以為前端會顯示錯誤或通道不穩的狀態。
- `device_reconnected`：前端有兩處處理，後端從 v0.2.0 起就不送。讀前端的人會以為後端還有一條「重新連上」的路。`backend/main.py:364` 的 docstring 也還寫著會廣播它。

現在都不會造成錯誤。其中 `device_error` 有一點不只是 dead code：它送出的時候，使用者實際上看不到任何提示，見「現況」。

下面的行號都是 `9753c48` 時的位置，開票時逐一對過。動手前以內容為準，先用 grep 再對一次。

## 現況

### `device_error`

- 送出：`backend/api/device.py:1377`，在 `wifi_tunnel_stop`（`:1294`）的 USB fallback 裡。
  - 停掉 WiFi 通道後，如果那台手機同時也用 USB 接著，後端會改用 USB 連回去、重建 simulation engine。
  - 重建 engine 失敗時（`:1362-1384`）：中斷連線、拿掉 engine，然後廣播 `device_error`，帶 `udid`、`stage: "usb_fallback"`、`error`。
- 接收：沒有。`git grep -n -w device_error -- ':!.scratch'` 只找到送出的那一行。
- 這條路上使用者看到什麼，沒有查證。照程式碼，這段沒有另外廣播 `device_disconnected`，所以可能是什麼提示都沒有。
- 歷史：`6f1c797`（v0.1.39）加了兩處（`device.py`、`main.py`），`7df3e95`（v0.2.26）拿掉 `main.py` 那處。前端從來沒有處理過：`git log -S device_error -- frontend` 是空的。

### `tunnel_degraded`

- 送出：`backend/api/device.py:810`，在 `_per_tunnel_watchdog`（`:778`）裡。通道的 task 意外結束、開始重試之前送，帶 `udid` 和 `reason: "task_exited"`。
- 接收：沒有。`git grep -n -w tunnel_degraded -- ':!.scratch'` 只找到 `:810` 和 `:812` 的 log。
- 重試的結果前端有收：成功送 `tunnel_recovered`（`:742`），失敗送 `tunnel_lost`（`:906`）。沒人收的只有中間這個狀態。
- 歷史：`6f1c797`（v0.1.39）加的。前端從來沒有處理過：`git log -S tunnel_degraded -- frontend` 是空的。

### `device_reconnected`

- 接收：
  - `frontend/src/hooks/useDevice.ts:135-141`：重新抓裝置清單，把那台設成目前的裝置。
  - `frontend/src/hooks/useSimulation.ts:587-592`：清掉連線中斷的錯誤訊息。
- 送出：沒有。`git grep -n -w device_reconnected -- backend` 只找到 `backend/main.py:364` 的 docstring。
- 說明跟程式對不上的地方：
  - `backend/main.py:362-365`（usbmux watchdog 的 docstring）寫「broadcasting device_reconnected when it succeeds」。實際送的是 `device_connected`（`backend/main.py:595`）。
  - `frontend/src/hooks/useSimulation.ts:444-447` 的註解已經寫了 watchdog 現在送 `device_connected`，並把 `device_reconnected` 那個 case 叫做「legacy case」。
- 歷史：
  - `95f4de7`（v0.1.42）加了後端的廣播和前端兩處處理。
  - `7a4592d`（v0.2.0）後端改送 `device_connected`，前端兩處沒拿掉。
  - `c1138af`（v0.2.2）加了 `useSimulation.ts` 那段註解。

### 共通

- 前端訂閱 WebSocket 的地方有五處：`useDevice.ts:88`、`:310`、`:327`，`useSimulation.ts:416`，`App.tsx:641`。都只處理指定的事件類型。`backend/static/phone.html` 沒有 WebSocket 處理。
- `tests` 沒有用到這三個名字。
- 上游 `upstream/main` 三個都一樣：`backend/api/device.py:932`、`:1388`，`backend/main.py:330`，`frontend/src/hooks/useDevice.ts:94`，`frontend/src/hooks/useSimulation.ts:459`、`:626`。這裡改了，之後合併上游碰到這幾行會衝突。

## 同一次清點另外發現的（模擬那邊）

**2026-11-11 已拆成 `.scratch/sim-ws-events/issues/01-sim-ws-events-no-counterpart.md`，以那張為準。這張不處理。** 下面是開票時的紀錄。

開票時把後端送的事件名稱（`broadcast(...)` 和 `engine._emit(...)`）跟前端處理的事件名稱全部對了一次。除了上面三個和 09 號票的兩個，還有下面這些對不上。它們是模擬（simulation engine）的事件，不是裝置連線。只用名稱查過，沒有逐一追歷史，也沒有查是不是有別的管道在用。

- 後端送、前端沒有處理：
  - `connection_lost`：`backend/core/flower.py:232`、`backend/core/random_walk.py:206`
  - `flower_progress`：`backend/core/flower.py:249`
  - `goldditto_cycle`：`backend/core/goldditto.py:32`、`:38`
  - `random_walk_arrived`：`backend/core/random_walk.py:242`
  - `random_walk_complete`：`backend/core/random_walk.py:282`
  - `restored`：`backend/core/restore.py:47`
  - `stop_reached`：`backend/core/multi_stop.py:243`、`:441`
  - `teleport`：`backend/core/teleport.py:37`
  - `user_waypoint_advance`：`backend/core/multi_stop.py:437`、`backend/core/route_loop.py:357`
- 前端有處理、後端沒有送（`git grep -n -w` 在 `backend` 找不到）：
  - `random_walk_pause`、`random_walk_pause_end`：`frontend/src/hooks/useSimulation.ts:594`、`:602`。跟 `pause_countdown`、`pause_countdown_end` 共用同一段處理，後端送的是後面這兩個。
  - `simulation_complete`：`useSimulation.ts:453`、`:518`
  - `simulation_error`：`useSimulation.ts:646`
  - `simulation_state`：`useSimulation.ts:501`

## 可能的做法

三個事件可以各自決定。

- A. 拿掉：
  - 拿掉 `device_error`、`tunnel_degraded` 兩處廣播。
  - 拿掉前端兩處 `device_reconnected` 的處理。
  - `backend/main.py:364` 的 docstring 和 `useSimulation.ts:444-447` 的註解改成符合現況。
- B. 把 `device_error` 接上：前端收到時提示使用者 USB fallback 失敗。
  - 這是改行為。要先查清楚現在這條路上使用者看到什麼。
  - 提示文字放在 `frontend/src/i18n/strings.ts`，理由見 03 號票第 3 節。
- C. 只改寫錯的說明（`backend/main.py:364` 的 docstring），程式不動。
- D. 都不動，改成 `wontfix`。上游三個都一樣，動了會增加合併上游的衝突。

## 待 triage 決定

- 三個事件各選哪個做法。**2026-11-11 已定：三個都選 A，拿掉**，理由見 Comments。
- 模擬那邊對不上的事件要不要處理。要的話，併進這張還是另開票。它們不是裝置連線，也不在 `device-dead-code` 原本的範圍裡。**2026-11-11 已定：另開票**，見上面那一節。
- 選 B 的話，要先查證 USB fallback 失敗時使用者實際看到什麼。**沒選 B。從程式碼追過，見 Comments。**
- 測試：
  - 選 A 的話，要先查這幾段有沒有測試涵蓋。開票時只確認 `tests` 沒有用到這三個名字。**查過，都沒有涵蓋**，見 Comments。
  - 驗收至少要有 `git grep` 確認名字找不到，加上 `tsc` 和現有測試。
- `AGENTS.md` 要不要補合併上游的規則。09 號票遇到同樣的問題，決定不補。**這張照 09 號票，不補。這點沒有另外問使用者。**
- 定案後補「要改」、「驗收」、「不做」，再改成 `ready-for-agent`。**已補，已改。**

## 定案

2026-11-11 triage 時由使用者決定：

- 三個事件都選 A：拿掉 `device_error`、`tunnel_degraded` 兩處廣播，拿掉前端兩處 `device_reconnected` 的處理，兩段說明改成符合現況。
- 模擬那邊對不上的事件另開票：`.scratch/sim-ws-events/issues/01-sim-ws-events-no-counterpart.md`。
- triage 時順帶看到的另一件事也另開票：`.scratch/device-dead-code/issues/13-usb-fallback-no-device-connected.md`。

## 要改

行號是 `23dd3bb` 時的位置，動手前以內容為準。

### 1. `backend/api/device.py` 的 `_per_tunnel_watchdog`

- 拿掉 `:808-812` 這段，五行：

```python
        try:
            from api.websocket import broadcast
            await broadcast("tunnel_degraded", {"udid": udid, "reason": "task_exited"})
        except Exception:
            _tunnel_logger.exception("Failed to emit tunnel_degraded event")
```

- 前面 `:804-807` 的 warning（`Tunnel for %s exited unexpectedly`）留著。它跟後面的 `if ip is None or port is None:` 之間留一個空行。
- 同一個函式後面的 `tunnel_lost`（`:906`），和 `_attempt_tunnel_restart` 的 `tunnel_recovered`（`:742`）不動，前端有收。

### 2. `backend/api/device.py` 的 `wifi_tunnel_stop`

- 拿掉 `:1375-1383` 這段，九行：

```python
                try:
                    from api.websocket import broadcast
                    await broadcast("device_error", {
                        "udid": usb_dev.udid,
                        "stage": "usb_fallback",
                        "error": "USB fallback engine creation failed",
                    })
                except Exception:
                    pass
```

- 前面的 log（`:1363-1366`，`USB fallback: engine creation failed`）和 rollback（`:1367-1374`）留著。

### 3. `backend/main.py` 的 `_usbmux_presence_watchdog`

- docstring `:364` 的 `device_reconnected` 改成 `device_connected`，其他字不動。實際送的是 `:595` 的 `device_connected`。

### 4. `frontend/src/hooks/useDevice.ts`

- 拿掉 `:135-141` 的 `else if (msg.type === 'device_reconnected')` 分支，七行。前一個分支結尾的 `}` 留著。

### 5. `frontend/src/hooks/useSimulation.ts`

- `:444-447` 的註解改寫，不要再提 `device_reconnected`。可以照試改時的寫法：

```ts
          // A device connecting resolves any prior connection-loss banner.
          // The usbmux watchdog's auto-connect broadcasts `device_connected`
          // too.
```

- 拿掉 `:587-592` 的 `case 'device_reconnected'`，六行。

## 驗收

triage 時在暫存區的 detached worktree 照「要改」試改過一次，下面每一項都照預期。那次是跟 07、11 號票的改動一起試的，三張改的檔案沒有重疊。

- `git grep -n -w -e device_error -e tunnel_degraded -e device_reconnected -- ':!.scratch'`：找不到，結束碼 1。
- log 還在，下面兩段字在 `backend/api/device.py` 用 `git grep -c -F` 都剛好 1 處：
  - `exited unexpectedly`
  - `USB fallback: engine creation failed`
- 前端有收的事件沒被動到：`git grep -c -e '"tunnel_recovered"' -e '"tunnel_lost"' -- backend/api/device.py` 是 2。
- import：
  - `.venv/Scripts/python.exe -I -c "import sys; sys.path.insert(0, 'backend'); import api.device"` 要成功。
  - `.venv/Scripts/python.exe -I -m py_compile backend/main.py` 結束碼 0。`main.py` 只改 docstring，不用 import 它。
- 型別檢查：在 `frontend` 底下跑 `./node_modules/.bin/tsc --noEmit -p .`，結束碼 0。
- 現有測試：
  - 前端：在 repo 根目錄跑 `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"`，試改時是 179 個全過、0 skipped。
  - `tests/device` 底下 5 支都要印 `all ok`、結束碼 0。
- `git diff <基準> --numstat -- ':!.scratch'`：只有四個檔。
  - `<基準>` 是動手前的 HEAD，動手前先用 `git rev-parse --short HEAD` 記下來。
  - 試改時是 `backend/api/device.py` `0	14`、`backend/main.py` `1	1`、`frontend/src/hooks/useDevice.ts` `0	7`、`frontend/src/hooks/useSimulation.ts` `3	10`。數字對不上的話，就是改到別行，或整個檔案的換行字元被換掉了。
- 不加新測試，結果要寫明：
  - 這三段現在都沒有測試涵蓋，見 Comments。
  - 拿掉的廣播沒有接收端，拿掉的處理沒有送出端，沒有行為可以鎖。
- 沒有在瀏覽器或實機驗證。要不要做，實作時跟使用者確認；做的話，連線的請求要在瀏覽器攔截。
- Commit：
  - 實作用一個 commit，前綴 `裝置連線:`。
  - commit 訊息要寫到：
    - `device_error`、`tunnel_degraded` 從 v0.1.39（`6f1c797`）起前端就沒有收過。
    - `device_reconnected` 從 v0.2.0（`7a4592d`）起後端就不送，改送 `device_connected`。
    - 上游三個都還在。合併上游之後要跑一次上面那條 `git grep`。
    - 沒加測試、沒做瀏覽器驗證的原因。
  - 結果用 `.scratch:` 記到 Comments，`Status` 改成 `resolved`。

## 不做

- 做法 B（前端收到 `device_error` 時提示）。理由見 Comments。
- 模擬那邊對不上的事件：歸 `.scratch/sim-ws-events/issues/01-sim-ws-events-no-counterpart.md`。
  - `useSimulation.ts:453` 群組模式那段的 `case 'simulation_complete'` 也歸那張，這張不動。
- USB fallback 成功時沒有廣播 `device_connected`：歸 13 號票。這張不在 `wifi_tunnel_stop` 加任何廣播。
- `device_connected`、`device_disconnected`、`tunnel_recovered`、`tunnel_lost` 的送出和處理。
- `ddi_mounted`、`ddi_not_mounted`：歸 09 號票。兩張改的檔案沒有重疊，誰先做都可以。
- `AGENTS.md`：不補合併上游的規則。
- 新測試。

## Comments

- 2026-11-11：開票。

  > *This was generated by AI during triage.*

  - 另一個 session 審 device-dead-code 全部的票（HEAD `db493d7`）時發現的，使用者決定開成這張。
  - 開票時對過（HEAD `9753c48`，`db493d7` 之後只改過 `.scratch`）：
    - 三個事件送出和接收的位置。
    - `git grep -n -w` 三個名字的結果。
    - 歷史：`git log -S` 加 `git describe --tags --contains`。`6f1c797` 是 v0.1.39，`7df3e95` 是 v0.2.26，`95f4de7` 是 v0.1.42，`7a4592d` 是 v0.2.0，`c1138af` 是 v0.2.2。
    - 上游的行號。
  - 沒查證的：
    - `device_error` 送出時，使用者實際看到什麼。
    - 「模擬那邊」那一節只用名稱比對。比對的寫法是 `broadcast("…"` 和 `_emit("…"`，以及前端的 `type === '…'` 和 `case '…'`。用變數組出事件名稱的寫法查不到。
- 2026-11-11 triage：照使用者的決定，三個事件都選 A，模擬那邊的事件和 USB fallback 成功的那條路各另開一張票，改成 `ready-for-agent`。

  > *This was generated by AI during triage.*

  **查證（HEAD `23dd3bb`）：**

  - `git grep -n -w` 三個名字的結果跟開票時一樣。上游 `upstream/main` 三個都還在。
  - 沒有 `.out-of-scope/` 和 `docs/adr/`，`GLOSSARY.md` 沒有這三個事件的詞條。

  **`device_error` 不選 B 的理由。** USB fallback 重建 engine 失敗時，使用者看到什麼，從程式碼追過，沒有實際跑：

  - 停通道時，`_cleanup_wifi_connection_for` 已經先廣播 `device_disconnected`（`backend/api/device.py:582`，原因是 `wifi_tunnel_stopped`）。前端收到後把那台標成已中斷；它是最後一台時，會顯示連線中斷的訊息。
  - 失敗後的 rollback 把 USB 連線中斷，裝置回到沒連線，跟畫面上一致。
  - 接著 usbmux watchdog（`backend/main.py:549-605`）每 2 秒看一次，發現這台插著 USB 但沒連線，就會自動重連，成功時送 `device_connected`，失敗的話照它自己的間隔重試。
  - 所以失敗時畫面上的狀態是對的，也有重試。`device_error` 沒有多帶使用者需要的資訊。

  **測試涵蓋：**

  - `tests/device/test_wifi_tunnel_parallel_start.py` 第 13 項有呼叫 `wifi_tunnel_stop`，但它的 `FakeDM.discover_devices` 回空清單，走不到 USB fallback。
  - `_per_tunnel_watchdog`、`_usbmux_presence_watchdog` 沒有測試。
  - `tests/frontend` 只測純函式，沒有測 `useDevice`、`useSimulation`。

  **順帶看到、另開 13 號票：** USB fallback 成功的那條路（`backend/api/device.py:1353-1361`）沒有廣播 `device_connected`。

  **試改：**

  - 在暫存區的 detached worktree（`23dd3bb`）照「要改」改了一次，跟 07、11 號票的改動一起試，結果記在「驗收」。試完已經移除 worktree，工作目錄沒有動過。
  - worktree 裡沒有 `.venv` 和 `frontend/node_modules`，是用 junction 連到 repo 的那兩個目錄跑的。少了 `.venv` 時，`tests/frontend/test_defaults.ts` 有兩項會失敗，那是找不到 Python，跟改動無關。

  **brief 的格式：** 照 09 號票的做法寫路徑和行號，加上「以內容為準」。

  **不建 `.out-of-scope/`：** 這是清 dead code，不是被否決的功能需求。
