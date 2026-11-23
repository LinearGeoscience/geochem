@echo off
:: GeoChem one-click launcher - double-click me.
:: Starts backend + frontend (or reuses running ones) and opens the app window.
:: Pass -Browser to open a normal browser tab instead.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-geochem.ps1" %*
if errorlevel 1 (
    echo.
    pause
)
