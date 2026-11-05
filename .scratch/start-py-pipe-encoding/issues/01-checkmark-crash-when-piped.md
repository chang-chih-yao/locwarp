# 01 start.py 的輸出接到 pipe 時，印 ✓ 會因為 cp950 當掉

Status: ready-for-agent
Blocked by: (none)
Type: bug

## 現況

- `start.py` 的狀態訊息用了 `✓`（U+2713）和 `✗`（U+2717）。
- 在 console 執行不會出事，例如雙擊 `LocWarp-dev.bat`。Python 對 Windows console 一律用 Unicode API 輸出（PEP 528），跟 code page 無關。
- 輸出接到 pipe 或導向檔案時，Python 改用系統的 code page，繁中 Windows 是 cp950。例如 agent session 在背景執行 `uv run start.py`。
  - cp950 沒有 `✓`，`print` 丟出 `UnicodeEncodeError`。
  - 啟動器在第一個 `check_tool` 就以 exit 1 結束，前後端都還沒啟動。
- 重現（不會啟動服務）：`PYTHONIOENCODING=cp950 .venv/Scripts/python.exe -c "import start; start.check_tool('python', 'x')" | cat`
- 目前的繞法是設 `PYTHONUTF8=1`。

## 決定

- 在 `start.py` 的 import 之後，把 `sys.stdout` 的 errors 改成 `replace`。編碼不變，編不出來的字元印成 `?`，不再當掉。
- console 不受影響：console 的編碼本來就是 UTF-8，每個字元都編得出來，`replace` 不會用到。
- 不把整條輸出改成 UTF-8：
  - `replace` 只改到原本會當掉的那幾個字元，其他輸出的位元組完全不變。
  - 改成 UTF-8 的話，pipe 上每個中文字的位元組都會變。用 cp950 解碼的讀取端反而會看到亂碼，例如 PowerShell 用預設的 `[Console]::OutputEncoding` 讀原生程式的輸出時。
- stderr 不用改：Python 的 stderr 預設就是 `backslashreplace`，不會因為編碼當掉。
- `✓`、`✗` 不換成 ASCII，console 上的顯示維持原樣。

## 驗收

- 新增 `tests/launcher/test_start_piped_output.py`：
  - 在子行程呼叫 `start.check_tool`，stdout 接 pipe、編碼固定為 cp950，並拿掉 `PYTHONUTF8`，換到別的語系的機器也一樣。
  - 要 exit 0。`✓`、`✗` 印成 `?`，中文照原樣用 cp950 輸出。
  - 拿掉修正、改用 `backslashreplace`、或改成 UTF-8，測試都要變紅。
- 人工驗證：
  - 不設 `PYTHONUTF8`、輸出接 pipe，在背景執行 `uv run start.py`，前後端都要起來。
  - 確認 console 的 stdout 編碼是 UTF-8，因為 `replace` 只有在編不出來的時候才會用到。
- README 中英文的專案結構都補上 `tests/launcher/`。
- Commit：
  - 開票用 `.scratch:`。
  - 實作和 README 用 `開發環境:`，照 `9233927` 的前例。
  - 結果用 `.scratch:`。

## 不做

- 子行程的輸出編碼：後端 uvicorn 和 Vite 共用同一條 pipe。後端照系統 code page 寫，Vite 一律寫 UTF-8。
- 讓讀 pipe 的 agent 看得懂中文：輸出仍是 cp950，需要的話自己設 `PYTHONUTF8=1`。
- `LocWarp.bat`：寫死了作者的 Python 路徑，這台機器不用它。
