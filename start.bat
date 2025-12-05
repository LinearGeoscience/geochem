@echo off
echo Starting Geochemistry Dashboard...

:: Start backend in new window
start "Backend" cmd /k "cd backend && if not exist venv (python -m venv venv) && venv\Scripts\activate && pip install -r requirements.txt -q && uvicorn app.main:app --reload"

:: Wait a moment for backend to initialize
timeout /t 3 /nobreak >nul

:: Start frontend in new window
start "Frontend" cmd /k "cd frontend && npm install && npm run dev"

echo.
echo Application starting...
echo Backend: http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Close the terminal windows to stop the servers.
