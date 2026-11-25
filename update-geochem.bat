@echo off
:: GeoChem updater - double-click me to get the latest version.
:: Closes GeoChem if it is open, updates it, then starts it again.
:: Runs a temp copy of the script because the update replaces the original.
copy /y "%~dp0scripts\update-geochem.ps1" "%TEMP%\geochem-update.ps1" >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\geochem-update.ps1" -RepoRoot "%~dp0." -Restart %*
