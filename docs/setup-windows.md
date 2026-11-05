# LocWarp 開發版安裝步驟（Windows 11，給 AI 執行）

目標：在一台什麼都沒裝的 Windows 11 x64 電腦上裝好 LocWarp 開發版，工具與套件版本跟原開發機**完全一樣**。
使用方式：在專案資料夾開 AI，對它說「請照 `docs/setup-windows.md` 完成安裝」。人只需要按 UAC 確認、回答 AI 的提問。

## 目標版本

| 項目 | 版本 | 版本來源 |
|---|---|---|
| uv | 0.12.10 | 本表 |
| Python | CPython 3.14.7（uv 管理的版本） | 本表 |
| Node.js | 24.20.0（內附 npm 11.19.0） | 本表 |
| Python 套件 | 97 個，全部固定版本 | `backend/requirements.lock.txt` |
| npm 套件 | 全部固定版本 | `frontend/package-lock.json` |
| Apple USB driver | Microsoft Store 的 Apple Devices，不固定版本 | 由 Store 自動更新 |

## 執行規則

- **依序執行**每一步：先跑「檢查」。檢查通過就進下一步；沒通過才跑「安裝」，裝完重跑同一個檢查，直到通過。
- 同一步裝了兩次還是沒通過，就**停下來**，把指令和完整輸出回報給人。不要自己換另一種安裝方式，換了版本就對不上。
- 每一步做完回報一行：步驟名稱、檢查輸出的關鍵行、通過或失敗。
- 指令都是 Windows PowerShell 5.1 語法，在**專案根目錄**（有 `start.py` 的資料夾）執行。用 Bash 的 agent 請改用 PowerShell 工具執行。
- 每個指令區塊的開頭都要先貼下面這**前置兩行**。剛裝好的工具不會出現在 agent 舊 shell 的 PATH 裡，而且變數不會留到下一次呼叫：

  ```powershell
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  $uv = "$env:USERPROFILE\.local\bin\uv.exe"; $node = 'C:\Program Files\nodejs\node.exe'; $npm = 'C:\Program Files\nodejs\npm.cmd'
  ```

- 一律用上面的絕對路徑呼叫 uv、node、npm。就算 PATH 上還有其他版本，也不會被選到。
- 下載快取都放在專案的 `.cache\`，刪掉專案資料夾就清乾淨了。
- 網路需要連得到：astral.sh、github.com、pypi.org、files.pythonhosted.org、nodejs.org、registry.npmjs.org、Microsoft Store。

## 步驟 0：確認環境

檢查：

```powershell
[Environment]::OSVersion.Version.Build
[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
Test-Path start.py, LocWarp-dev.bat, backend\requirements.lock.txt, frontend\package-lock.json
```

通過條件：Build ≥ 22000、架構是 `X64`、四個 `True`。

沒通過：沒有安裝可做，**停下來**回報。ARM64 電腦裝到的 Python wheel 和 Node 執行檔都跟原開發機不同，這份文件不適用。四個檔案缺任何一個，代表不在專案根目錄，或者拿到的專案不完整。

## 步驟 1：uv

檢查：

```powershell
& $uv --version
```

通過條件：輸出開頭是 `uv 0.12.10`。

安裝：

- 找不到 `uv.exe`：
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/0.12.10/install.ps1 | iex"
  ```
- 有 `uv.exe` 但版本不同：
  ```powershell
  & $uv self update 0.12.10
  ```

## 步驟 2：Python 3.14.7

檢查：

```powershell
& $uv python list 3.14.7 --only-installed --managed-python
```

通過條件：輸出有一行以 `cpython-3.14.7-windows-x86_64-none` 開頭。

安裝：

```powershell
& $uv python install 3.14.7 --cache-dir .cache\uv
```

## 步驟 3：專案的 `.venv`

檢查：

```powershell
& .\.venv\Scripts\python.exe --version
```

通過條件：輸出 `Python 3.14.7`。從別台電腦複製來的 `.venv` 會報錯（例如 `No Python at ...`），算沒通過。

安裝：先確認 `.\.venv` 是專案根目錄下的資料夾。存在的話先刪掉，再重建：

```powershell
if (Test-Path .\.venv) { Remove-Item -Recurse -Force .\.venv }
& $uv venv .venv --python 3.14.7 --managed-python --no-python-downloads --cache-dir .cache\uv
```

`.venv` 刻意不裝 pip。`start.py` 啟動時的套件檢查會因此直接跳過，不會用 `requirements.txt` 去改動已經固定的版本。

## 步驟 4：Python 套件

檢查：

```powershell
$want = @(Get-Content backend\requirements.lock.txt | Where-Object { $_ -and -not $_.StartsWith('#') })
$have = @(& $uv pip freeze --python .venv)
if ($have.Count -eq 0) { 'FAIL: .venv has no packages' }
elseif ($diff = Compare-Object $want $have) { $diff; 'FAIL' }
else { "MATCH: $($want.Count) packages" }
& $uv pip check --python .venv
```

通過條件：輸出 `MATCH: 97 packages`，而且 `uv pip check` 輸出 `All installed packages are compatible`。

安裝：

```powershell
& $uv pip sync --python .venv --cache-dir .cache\uv backend\requirements.lock.txt
```

套件一律從 `requirements.lock.txt` 安裝。`requirements.txt` 只寫版本下限，用它裝會拿到當天的最新版。`pip sync` 也會移除 lock 檔沒列的套件。

## 步驟 5：Node.js 與 npm

檢查：

```powershell
& $node --version
& $npm --version
```

通過條件：依序輸出 `v24.20.0`、`11.19.0`。

安裝：

- `node.exe` 存在但版本不同：**停下來**問人。改 Node 版本會影響這台電腦上的其他程式，而且 MSI 不能降版。
- 找不到 `node.exe`：先下載安裝檔並核對 SHA256：
  ```powershell
  $ProgressPreference = 'SilentlyContinue'
  New-Item -ItemType Directory -Force .cache\downloads | Out-Null
  $msi = "$PWD\.cache\downloads\node-v24.20.0-x64.msi"
  Invoke-WebRequest -UseBasicParsing -Uri https://nodejs.org/dist/v24.20.0/node-v24.20.0-x64.msi -OutFile $msi
  (Get-FileHash $msi -Algorithm SHA256).Hash -eq '28b69132c35ccc033bf8f2a67cd10c9d75ef5822593363309da448f2afff2d8a'
  ```
  輸出 `True` 才往下做。輸出 `False` 就刪掉這個檔案，**停下來**回報。

  接著先告訴人「接下來會跳出 UAC 視窗，請按『是』」，再執行：
  ```powershell
  $msi = "$PWD\.cache\downloads\node-v24.20.0-x64.msi"
  $p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /passive /norestart" -Verb RunAs -Wait -PassThru
  $p.ExitCode
  ```
  `0` 或 `3010` 代表安裝成功。`1223` 代表人在 UAC 視窗按了取消。

## 步驟 6：前端套件

檢查（拿 npm 實際裝好的版本逐一比對 `package-lock.json`）：

```powershell
Push-Location frontend
$js = @'
const lock = require('./package-lock.json').packages;
let inst;
try { inst = require('./node_modules/.package-lock.json').packages; } catch { console.log('FAIL: node_modules not installed'); process.exit(1); }
let bad = 0;
for (const [k, v] of Object.entries(inst)) {
  if (!lock[k] || lock[k].version !== v.version) { console.log('MISMATCH', k, v.version, lock[k] && lock[k].version); bad++; }
}
for (const [k, v] of Object.entries(lock)) {
  if (k && !v.optional && !v.devOptional && !inst[k]) { console.log('MISSING', k, v.version); bad++; }
}
console.log(bad ? 'FAIL: ' + bad : 'MATCH: ' + Object.keys(inst).length + ' packages');
process.exit(bad ? 1 : 0);
'@
$js | & $node -
Pop-Location
```

通過條件：最後一行是 `MATCH: 372 packages`。lock 檔裡其他平台專用的套件（例如 `@rolldown/binding-darwin-*`）不會安裝，這是正常的。

安裝：

```powershell
$env:npm_config_cache = "$PWD\.cache\npm"
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
Push-Location frontend
& $npm ci
Pop-Location
```

`npm ci` 會先清掉舊的 `node_modules`，再完全照 `package-lock.json` 安裝，不會改動 lock 檔。Electron 執行檔是刻意不下載的，跟原開發機一樣只用瀏覽器模式，所以 `npm run start` 開不出 Electron 視窗。

## 步驟 7：Apple USB driver

檢查：

```powershell
[bool](Get-AppxPackage AppleInc.AppleDevices) -or [bool](Get-AppxPackage AppleInc.iTunes) -or [bool](Get-Service 'Apple Mobile Device Service' -ErrorAction SilentlyContinue)
```

通過條件：輸出 `True`。

安裝（裝原開發機用的 Microsoft Store 版 Apple Devices）：

```powershell
winget install --id 9NP83LWLPZ9K --source msstore --accept-package-agreements --accept-source-agreements
```

找不到 `winget`，或安裝失敗：請人從 README「安裝與前置設定 → 1. 安裝 Apple USB driver」的 Store 連結手動安裝，裝好再重跑檢查。

## 步驟 8：`.cache` 不進 git

只有專案根目錄有 `.git` 資料夾時才做這步，沒有就回報「略過：不是 git repo」。

檢查：

```powershell
[bool](Select-String -Path .git\info\exclude -Pattern '^\.cache/$' -Quiet)
```

通過條件：輸出 `True`。

安裝：

```powershell
Add-Content .git\info\exclude '.cache/'
```

## 步驟 9：試跑

先確認兩個 port 都沒被占用：

```powershell
Get-NetTCPConnection -LocalPort 8777, 5173 -State Listen -ErrorAction SilentlyContinue
```

有任何輸出就**停下來**回報。安裝版的 LocWarp 也用 8777，要請人先關掉。

port 都空著的話，啟動 backend 與前端，確認回應後再關掉：

```powershell
$be = Start-Process -FilePath "$PWD\.venv\Scripts\python.exe" -ArgumentList 'main.py' -WorkingDirectory "$PWD\backend" -PassThru -WindowStyle Hidden
$fe = Start-Process -FilePath "$PWD\frontend\node_modules\.bin\vite.cmd" -ArgumentList '--port 5173 --strictPort' -WorkingDirectory "$PWD\frontend" -PassThru -WindowStyle Hidden
$result = [ordered]@{}
foreach ($u in 'http://127.0.0.1:8777/', 'http://localhost:5173/') {
  $result[$u] = 'FAIL'
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $r = Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $result[$u] = 'OK'; break }
    } catch { Start-Sleep -Seconds 2 }
  }
}
$result
taskkill /PID $be.Id /T /F
taskkill /PID $fe.Id /T /F
```

通過條件：兩個網址都是 `OK`。

backend 監聽 `0.0.0.0`，第一次啟動時 Windows 防火牆可能會跳出詢問視窗。請告訴人：要用「手機網頁操控」就按允許，不用的話按取消也不影響本機使用。

## 完成回報

全部通過後給人一張表：項目、目標版本、檢查輸出、結果。步驟 8 如果略過，要寫「略過」，不能寫通過。接著把下一段轉告給人。

## 啟動方式（給人）

1. 雙擊專案根目錄的 `LocWarp-dev.bat`，跳出 UAC 視窗時按「是」。iOS 17 以上的裝置要用系統管理員權限才能建立通道。
2. 程式會自動開啟瀏覽器到 `http://localhost:5173`。要停止時，在 LocWarp 的視窗按 Enter。
3. 專案根目錄的 `LocWarp.bat` 是原作者的啟動檔，裡面寫死了作者電腦上的 Python 路徑。請用 `LocWarp-dev.bat` 啟動。
4. iPhone 端的設定（信任電腦、開發者模式、DDI）請照 README「安裝與前置設定」第 2 到 5 步。

會寫到專案資料夾外面的東西：uv 本體（`%USERPROFILE%\.local\bin`）、uv 管理的 Python（`%APPDATA%\uv\python`）、Node.js（`C:\Program Files\nodejs`，並加入 PATH）、Apple Devices（Store App）、LocWarp 執行時的資料（`%USERPROFILE%\.locwarp`）、防火牆規則（如果有按允許）。

## 維護（在原開發機上）

原開發機的套件或工具版本有變動時，要同步更新這份文件，對方才裝得到同樣的版本：

- Python 套件變動：保留檔頭註解，重新產生 lock 檔，再改「目標版本」表和步驟 4 的套件數：
  ```powershell
  $uv = "$env:USERPROFILE\.local\bin\uv.exe"
  $h = @(Get-Content backend\requirements.lock.txt | Where-Object { $_.StartsWith('#') })
  $f = @(& $uv pip freeze --python .venv)
  [IO.File]::WriteAllLines("$PWD\backend\requirements.lock.txt", [string[]]($h + $f), (New-Object Text.UTF8Encoding $false))
  ```
- npm 套件變動：`package-lock.json` 由 npm 自己維護。在原開發機跑步驟 6 的檢查，確認是 `MATCH`，再把步驟 6 的套件數改成新的數字。
- uv、Python、Node 版本變動：改「目標版本」表和用到版本號的指令。Node 的 SHA256 從 `https://nodejs.org/dist/v<版本>/SHASUMS256.txt` 裡 `x64.msi` 那一行取得。
