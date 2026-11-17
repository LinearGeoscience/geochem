# GeoChem one-click launcher (desktop shortcut target; see install-desktop-shortcut.ps1).
#
# Double-click start-geochem.bat (which runs this script) to:
#   1. Check prerequisites (Node, Python) and run first-time setup if needed
#   2. Reuse servers that are already running; otherwise clear stuck listeners
#      on ports 8000 and 5173-5176 and start backend + frontend (minimised
#      "GeoChem servers" console with the logs)
#   3. Wait for the backend /health endpoint and the frontend
#   4. Open GeoChem in its own app window (Chrome or Edge --app, separate
#      profile); closing that window stops the servers it started.
#      No Chrome/Edge, or -Browser: open a normal browser tab instead and
#      close the "GeoChem servers" window to stop.

param(
    [switch]$Browser
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Fail($message) {
    Write-Host ""
    Write-Host "ERROR: $message" -ForegroundColor Red
    exit 1
}

Write-Host "=== GeoChem Launcher ===" -ForegroundColor Cyan
Write-Host "Repo: $repoRoot"

# --- 1. Prerequisites -------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js not found. Install Node 18+ from https://nodejs.org and run this again."
}
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Fail "Python not found. Install Python 3.8+ from https://python.org and run this again."
}

$venvPython = Join-Path $repoRoot 'backend\venv\Scripts\python.exe'
$frontendModules = Join-Path $repoRoot 'frontend\node_modules'
$rootModules = Join-Path $repoRoot 'node_modules'

if (-not (Test-Path $venvPython) -or -not (Test-Path $frontendModules) -or -not (Test-Path $rootModules)) {
    Write-Host ""
    Write-Host "First-time setup needed (installing Python + Node dependencies)..." -ForegroundColor Yellow
    Write-Host "This runs once and can take a few minutes."
    Push-Location $repoRoot
    try {
        & npm run setup
        if ($LASTEXITCODE -ne 0) { Fail "Setup failed (see output above). Fix the error and run this again." }
    } finally {
        Pop-Location
    }
    Write-Host "Setup complete." -ForegroundColor Green
}

# --- 2. Reuse running servers, or clear stuck ports and start them --------
# Probe 127.0.0.1 (not 'localhost'): uvicorn binds IPv4 only, and Windows can
# stall each 'localhost' request on an IPv6 (::1) attempt first.
function Test-Url($url) {
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        return $resp.StatusCode -eq 200
    } catch { return $false }
}

$frontendUrl = 'http://localhost:5173'
$serverWindow = $null

if ((Test-Url 'http://127.0.0.1:8000/health') -and (Test-Url 'http://127.0.0.1:5173')) {
    Write-Host "GeoChem is already running - opening a window." -ForegroundColor Green
} else {
    $ports = @(8000, 5173, 5174, 5175, 5176)
    foreach ($port in $ports) {
        try {
            $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
            foreach ($conn in $conns) {
                $owner = $conn.OwningProcess
                if ($owner -and $owner -ne $PID) {
                    Write-Host "Clearing port $port (killing PID $owner)..." -ForegroundColor Yellow
                    try { Stop-Process -Id $owner -Force -Confirm:$false -ErrorAction Stop } catch {}
                }
            }
        } catch {
            # No listener on this port - nothing to do
        }
    }

    Write-Host ""
    Write-Host "Starting backend + frontend..." -ForegroundColor Cyan
    $serverWindow = Start-Process cmd -ArgumentList '/c', 'title GeoChem servers && npm run dev' `
        -WorkingDirectory $repoRoot -WindowStyle Minimized -PassThru

    # --- 3. Wait for health ---------------------------------------------------
    Write-Host "Waiting for the backend to come up (first start can take a few minutes)..."
    $healthy = $false
    for ($i = 0; $i -lt 150; $i++) {
        Start-Sleep -Seconds 2
        if ($serverWindow.HasExited) {
            Fail "The server window closed unexpectedly. Re-run and check its output for errors."
        }
        if (Test-Url 'http://127.0.0.1:8000/health') { $healthy = $true; break }
        if ($i % 10 -eq 9) { Write-Host "  still waiting... ($((($i + 1) * 2))s)" }
    }
    if (-not $healthy) {
        Fail "Backend did not respond on http://127.0.0.1:8000/health within 5 minutes. Check the 'GeoChem servers' window for errors."
    }

    # Frontend: vite grabs 5173 (we cleared it above); give it a moment if needed
    for ($i = 0; $i -lt 15; $i++) {
        if (Test-Url 'http://127.0.0.1:5173') { break }
        Start-Sleep -Seconds 2
    }
}

# --- 4. Open the app window -------------------------------------------------
function Find-AppBrowser {
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    return $null
}

function Stop-Servers {
    if ($serverWindow -and -not $serverWindow.HasExited) {
        Write-Host "Stopping GeoChem servers..."
        # /T: the cmd window's whole tree (concurrently, uvicorn, vite)
        & taskkill /PID $serverWindow.Id /T /F | Out-Null
    }
}

$appBrowser = if ($Browser) { $null } else { Find-AppBrowser }
if (-not $appBrowser) {
    Write-Host ""
    Write-Host "GeoChem is running - opening $frontendUrl" -ForegroundColor Green
    if ($serverWindow) { Write-Host "Close the 'GeoChem servers' console window to stop the app." }
    Start-Process $frontendUrl
    exit 0
}

# A dedicated profile makes the app window its own browser process, so this
# script can wait for it to close. Settings saved in the app (theme, custom
# diagrams, templates) live in this profile.
$profileDir = Join-Path $env:LOCALAPPDATA 'GeoChem\app-window'
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
$browserArgs = @(
    "--app=$frontendUrl",
    "--user-data-dir=`"$profileDir`"",
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1600,1000'
)

Write-Host ""
Write-Host "GeoChem is running - opening the app window." -ForegroundColor Green
if (-not $serverWindow) {
    # Servers belong to another launcher run; just add a window
    Start-Process -FilePath $appBrowser -ArgumentList $browserArgs
    exit 0
}

Write-Host "Close the GeoChem window to stop the app."
try {
    $app = Start-Process -FilePath $appBrowser -ArgumentList $browserArgs -PassThru
    $app.WaitForExit()
    # Chrome can hand the window to a child and exit; keep waiting while any
    # process still uses the app profile.
    while ($true) {
        $alive = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" |
            Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileDir) }
        if (-not $alive -or $serverWindow.HasExited) { break }
        Start-Sleep -Seconds 2
    }
} finally {
    Stop-Servers
}
