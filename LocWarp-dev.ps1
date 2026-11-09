# ============================================================
#  LocWarp 開發版啟動器
#  由 LocWarp-dev.bat 呼叫，也可以在 PowerShell 裡直接執行 .\LocWarp-dev.ps1
#  自動要求系統管理員權限，用 repo 根目錄的 .venv 執行 start.py
#  環境要先照 docs\setup-windows.md 裝好
#
#  這個檔案要存成 UTF-8 with BOM，而且只能用 Windows PowerShell 5.1 也有的語法：
#  沒裝 PowerShell 7 時 .bat 會改用 5.1 執行，5.1 讀沒有 BOM 的檔案會把中文讀成亂碼
# ============================================================

param([switch]$Elevated)

$ErrorActionPreference = 'Stop'

function Exit-WithPause([string]$Message, [int]$Code = 1) {
    Write-Host $Message
    Read-Host '按 Enter 離開' | Out-Null
    exit $Code
}

# 沒預料到的錯誤也停下來讓人看到訊息，不要讓視窗直接關掉
trap { Exit-WithPause "[錯誤] $_" }

# --- 1. 確認系統管理員權限，沒有就自我提權 ---
$principal = New-Object Security.Principal.WindowsPrincipal ([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    if ($Elevated) { Exit-WithPause '[錯誤] 無法取得系統管理員權限。' }

    # 用名稱啟動，不用 (Get-Process -Id $PID).Path：Store 版 pwsh 的實際路徑在 WindowsApps 裡，要透過 PATH 上的別名啟動
    $shell = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh.exe' } else { 'powershell.exe' }
    $shellArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Elevated')

    # 實測提權後的新 console 不會交給 Windows Terminal，會開成傳統主控台；
    # 而且 start.py 的 cmd.exe /c npx vite 會把標題改成 C:\WINDOWS\system32\cmd.exe，整個看起來就像 cmd。
    # 所以有 wt 時，改用系統管理員身分開 wt，在裡面跑同一個 shell，並用 --suppressApplicationTitle 固定分頁標題
    if (Get-Command wt.exe -ErrorAction SilentlyContinue) {
        $launcher = 'wt.exe'
        $launchArgs = @('new-tab', '--title', '"LocWarp (dev)"', '--suppressApplicationTitle', '--', $shell) + $shellArgs
    } else {
        $launcher = $shell
        $launchArgs = $shellArgs
    }
    try {
        Start-Process -FilePath $launcher -Verb RunAs -ArgumentList $launchArgs
    } catch {
        Exit-WithPause "已取消：iOS 17+ 建立通道需要系統管理員權限。`n($($_.Exception.Message))"
    }
    exit 0
}

Set-Location -LiteralPath $PSScriptRoot

# --- 2. 所有快取留在專案資料夾內，刪資料夾即可清乾淨 ---
$env:UV_CACHE_DIR = Join-Path $PSScriptRoot '.cache\uv'
$env:npm_config_cache = Join-Path $PSScriptRoot '.cache\npm'
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'

# 等同原本 .bat 的 chcp 65001：把 console code page 設成 UTF-8，子程式也吃這個設定
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

# --- 3. 環境檢查 ---
$uv = Get-Command uv.exe -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty Source
if (-not $uv) { $uv = Join-Path $env:USERPROFILE '.local\bin\uv.exe' }
if (-not (Test-Path -LiteralPath $uv)) {
    Exit-WithPause '[錯誤] 找不到 uv，請照 docs\setup-windows.md 完成安裝後再試。'
}
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    Exit-WithPause '[錯誤] 找不到 .venv，請照 docs\setup-windows.md 完成安裝後再試。'
}
if (-not (Test-Path -LiteralPath 'frontend\node_modules' -PathType Container)) {
    Exit-WithPause '[錯誤] 找不到 frontend\node_modules，請照 docs\setup-windows.md 完成安裝後再試。'
}

# --- 4. 已安裝版 LocWarp 會搶 port 8777 ---
if (Get-Process -Name locwarp-backend -ErrorAction SilentlyContinue) {
    Write-Host ''
    Write-Host '[注意] 偵測到已安裝版 LocWarp 正在執行，兩者共用 port 8777。'
    Write-Host '       請先關閉安裝版再按 Enter 繼續；'
    Write-Host '       若直接繼續，start.py 會強制結束它的後端。'
    Read-Host | Out-Null
}

# --- 5. 啟動 ---
$Host.UI.RawUI.WindowTitle = 'LocWarp (dev)'
& $uv run start.py
$rc = $LASTEXITCODE
if ($rc -eq 0) { exit 0 }
Write-Host ''
Exit-WithPause "[錯誤] 啟動器結束代碼 $rc" $rc
