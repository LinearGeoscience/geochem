@echo off
echo Cleaning up ports...

:: Kill processes on port 8000 (Backend)
for /f "tokens=5" %%a in ('netstat -aon ^| find ":8000" ^| find "LISTENING"') do taskkill /f /pid %%a

:: Kill processes on ports 5173-5176 (Frontend)
for /f "tokens=5" %%a in ('netstat -aon ^| find ":5173" ^| find "LISTENING"') do taskkill /f /pid %%a
for /f "tokens=5" %%a in ('netstat -aon ^| find ":5174" ^| find "LISTENING"') do taskkill /f /pid %%a
for /f "tokens=5" %%a in ('netstat -aon ^| find ":5175" ^| find "LISTENING"') do taskkill /f /pid %%a
for /f "tokens=5" %%a in ('netstat -aon ^| find ":5176" ^| find "LISTENING"') do taskkill /f /pid %%a

echo.
echo All ports cleared!
echo.
echo Now you can run: npm run dev
pause
