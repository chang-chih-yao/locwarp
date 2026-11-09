@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  LocWarp 開發版啟動器
rem  雙擊 .bat 一定是由 cmd 執行，這裡只負責交給 PowerShell 跑 LocWarp-dev.ps1，
rem  提權、環境檢查、啟動 start.py 都在 LocWarp-dev.ps1 裡
rem  優先用 PowerShell 7 (pwsh)，沒裝時改用 Windows 內建的 PowerShell 5.1
rem ============================================================

set "LW_PS=pwsh.exe"
where pwsh.exe >nul 2>&1 || set "LW_PS=powershell.exe"
"%LW_PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0LocWarp-dev.ps1"
