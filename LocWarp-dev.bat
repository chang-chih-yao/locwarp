@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  LocWarp 開發版啟動器
rem  雙擊後自動要求系統管理員權限，用 repo 根目錄的 .venv 執行 start.py
rem  環境要先照 docs\setup-windows.md 裝好
rem ============================================================

rem --- 1. 確認系統管理員權限，沒有就自我提權 ---
fltmc >nul 2>&1
if not errorlevel 1 goto :ADMIN
if /i "%~1"=="--elevated" goto :ELEVATE_FAILED

set "LW_SELF=%~f0"
powershell -NoProfile -Command "try { Start-Process -FilePath $env:LW_SELF -ArgumentList '--elevated' -Verb RunAs -ErrorAction Stop } catch { exit 1 }"
if errorlevel 1 goto :ELEVATE_CANCELLED
exit /b 0

:ELEVATE_CANCELLED
echo 已取消：iOS 17+ 建立通道需要系統管理員權限。
pause
exit /b 1

:ELEVATE_FAILED
echo [錯誤] 無法取得系統管理員權限。
pause
exit /b 1

:ADMIN
cd /d "%~dp0"

rem --- 2. 所有快取留在專案資料夾內，刪資料夾即可清乾淨 ---
set "UV_CACHE_DIR=%~dp0.cache\uv"
set "npm_config_cache=%~dp0.cache\npm"
set "ELECTRON_SKIP_BINARY_DOWNLOAD=1"

rem --- 3. 環境檢查 ---
set "UV_EXE=uv"
where uv >nul 2>&1
if errorlevel 1 set "UV_EXE=%USERPROFILE%\.local\bin\uv.exe"
if /i not "%UV_EXE%"=="uv" if not exist "%UV_EXE%" goto :NO_UV
if not exist ".venv\Scripts\python.exe" goto :NO_VENV
if not exist "frontend\node_modules\" goto :NO_NODE_MODULES

rem --- 4. 已安裝版 LocWarp 會搶 port 8777 ---
tasklist /FI "IMAGENAME eq locwarp-backend.exe" 2>nul | find /i "locwarp-backend.exe" >nul
if errorlevel 1 goto :RUN
echo.
echo [注意] 偵測到已安裝版 LocWarp 正在執行，兩者共用 port 8777。
echo        請先關閉安裝版再按任意鍵繼續；
echo        若直接繼續，start.py 會強制結束它的後端。
pause

:RUN
title LocWarp (dev)
"%UV_EXE%" run start.py
set "RC=%errorlevel%"
if "%RC%"=="0" exit /b 0
echo.
echo [錯誤] 啟動器結束代碼 %RC%
pause
exit /b %RC%

:NO_UV
echo [錯誤] 找不到 uv，請照 docs\setup-windows.md 完成安裝後再試。
pause
exit /b 1

:NO_VENV
echo [錯誤] 找不到 .venv，請照 docs\setup-windows.md 完成安裝後再試。
pause
exit /b 1

:NO_NODE_MODULES
echo [錯誤] 找不到 frontend\node_modules，請照 docs\setup-windows.md 完成安裝後再試。
pause
exit /b 1
