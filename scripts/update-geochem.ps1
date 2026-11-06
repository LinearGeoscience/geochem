# GeoChem updater. Double-click update-geochem.bat, or press "Update now" in
# the app (Settings > Updates or the "Update available" button).
#
#   1. Stops GeoChem (servers + app window) if it is running
#   2. Gets the latest version from GitHub:
#        - git copy:  git fetch + reset to origin/main. Any files you edited
#          yourself are saved first with `git stash`.
#        - zip copy (or no git): downloads the zip and copies it over this
#          folder. Files that are not part of GeoChem are left alone.
#   3. Installs Python/Node dependencies again if their lists changed
#   4. Shows what's new, then restarts GeoChem (-Restart)
#
# Your data files and .chem projects are never touched: they are not part of
# the GeoChem folder's tracked files. App settings live in the app window's
# browser profile and are kept too.
#
# Run from a temp copy (the .bat and the app do this) because the update
# replaces this file.

param(
    [string]$RepoRoot = '',
    [switch]$Restart,
    [switch]$FromApp,
    [switch]$Force
)

# Continue: native commands (git, taskkill) may write to stderr; exit codes are checked instead.
$ErrorActionPreference = 'Continue'
$Repo = 'LinearGeoscience/geochem'
if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent $PSScriptRoot }
$RepoRoot = (Resolve-Path $RepoRoot -ErrorAction Stop).Path

function Done($code) {
    Write-Host ""
    if ($code -ne 0 -or -not $Restart) { Read-Host "Press Enter to close" | Out-Null }
    exit $code
}
function Fail($message) {
    Write-Host ""
    Write-Host "UPDATE FAILED: $message" -ForegroundColor Red
    Write-Host "GeoChem was not changed unless noted above. You can download it again from https://github.com/$Repo"
    Done 1
}
function Read-Version {
    $f = Join-Path $RepoRoot 'VERSION'
    if (Test-Path $f) { return (Get-Content $f -Raw).Trim() }
    return '0.0.0'
}
function Get-DepHashes {
    $h = @{}
    foreach ($rel in @('backend\requirements.txt', 'package-lock.json', 'frontend\package-lock.json')) {
        $p = Join-Path $RepoRoot $rel
        $h[$rel] = if (Test-Path $p) { (Get-FileHash $p -Algorithm SHA256).Hash } else { '' }
    }
    return $h
}

Write-Host "=== GeoChem Update ===" -ForegroundColor Cyan
Write-Host "Folder: $RepoRoot"

if (Test-Path (Join-Path $RepoRoot 'scripts\publish_public.py')) {
    Fail "This is a development copy of GeoChem. Update it with git, not this updater."
}
$before = Read-Version
Write-Host "Installed version: $before"

# --- 1. Stop GeoChem ------------------------------------------------------
Write-Host ""
Write-Host "Closing GeoChem..." -ForegroundColor Cyan
if ($FromApp) { Start-Sleep -Seconds 1 }   # let the app's request finish
$profileDir = Join-Path $env:LOCALAPPDATA 'GeoChem\app-window'
Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileDir) } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -Confirm:$false -ErrorAction Stop } catch {} }
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains('title GeoChem servers') } |
    ForEach-Object { & taskkill /PID $_.ProcessId /T /F 2>$null | Out-Null }
foreach ($port in @(8000, 5173, 5174, 5175, 5176)) {
    try {
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | ForEach-Object {
            if ($_.OwningProcess -and $_.OwningProcess -ne $PID) {
                try { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false -ErrorAction Stop } catch {}
            }
        }
    } catch {}
}
Start-Sleep -Seconds 2

# --- 2. Get the new version ----------------------------------------------
$depsBefore = Get-DepHashes
$haveGit = [bool](Get-Command git -ErrorAction SilentlyContinue)
$isGitCopy = $haveGit -and (Test-Path (Join-Path $RepoRoot '.git'))

Push-Location $RepoRoot
try {
    if ($isGitCopy) {
        Write-Host ""
        Write-Host "Downloading the latest version (git)..." -ForegroundColor Cyan
        $parents = (& git rev-list --parents -n 1 HEAD 2>$null) -split ' '
        if ($parents.Count -gt 1 -and -not $Force) {
            Fail "This copy has its own git commits. Update it with git yourself, or run with -Force to replace them."
        }
        & git config core.longpaths true   # some diagram thumbnails have long names
        $remoteUrl = & git remote get-url origin 2>$null
        if (-not $remoteUrl) { & git remote add origin "https://github.com/$Repo.git" }
        & git fetch origin main
        if ($LASTEXITCODE -ne 0) { Fail "Could not download from GitHub (no internet, or GitHub is unreachable)." }

        $changed = & git status --porcelain --untracked-files=no
        if ($changed) {
            $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
            & git stash push -m "GeoChem: my changes before the update ($stamp)" | Out-Null
            Write-Host "You had edited some GeoChem files. They are saved in git stash" -ForegroundColor Yellow
            Write-Host "('git stash list' shows them, 'git stash pop' brings them back)." -ForegroundColor Yellow
        }
        & git checkout -q -B main origin/main
        if ($LASTEXITCODE -ne 0) { Fail "git could not switch to the new version." }
        & git reset -q --hard origin/main
        if ($LASTEXITCODE -ne 0) { Fail "git could not switch to the new version." }
    } else {
        Write-Host ""
        Write-Host "Downloading the latest version (zip)..." -ForegroundColor Cyan
        # Short folder name: some diagram thumbnails have long names (Windows' 260-character path limit)
        $work = Join-Path $env:TEMP ("gcu" + [guid]::NewGuid().ToString('N').Substring(0, 6))
        New-Item -ItemType Directory -Path $work -ErrorAction Stop | Out-Null
        $zip = Join-Path $work 'geochem.zip'
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri "https://github.com/$Repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing -ErrorAction Stop
        } catch {
            Fail "Could not download from GitHub (no internet, or GitHub is unreachable)."
        }
        try { Expand-Archive -Path $zip -DestinationPath $work -Force -ErrorAction Stop } catch { Fail "Could not unpack the download: $_" }
        $src = Get-ChildItem $work -Directory | Select-Object -First 1
        if (-not $src -or -not (Test-Path (Join-Path $src.FullName 'VERSION'))) {
            Fail "The download did not look like GeoChem."
        }
        # /E copies the new files over the old ones; nothing outside GeoChem's own files is deleted.
        & robocopy $src.FullName $RepoRoot /E /NFL /NDL /NJH /NJS /NP /R:2 /W:2 /XD venv node_modules .git | Out-Null
        if ($LASTEXITCODE -ge 8) { Fail "Copying the new files failed (robocopy code $LASTEXITCODE). Is a GeoChem file open in another program?" }
        Remove-Item $work -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue
    }
} finally {
    Pop-Location
}

$after = Read-Version

# --- 3. Dependencies ------------------------------------------------------
$depsAfter = Get-DepHashes
$venvPython = Join-Path $RepoRoot 'backend\venv\Scripts\python.exe'
if ($depsAfter['backend\requirements.txt'] -ne $depsBefore['backend\requirements.txt'] -and (Test-Path $venvPython)) {
    Write-Host ""
    Write-Host "Updating Python packages..." -ForegroundColor Cyan
    & $venvPython -m pip install -q -r (Join-Path $RepoRoot 'backend\requirements.txt')
    if ($LASTEXITCODE -ne 0) { Fail "Installing Python packages failed (see above). The new GeoChem files are in place." }
}
foreach ($pair in @(@('package-lock.json', $RepoRoot), @('frontend\package-lock.json', (Join-Path $RepoRoot 'frontend')))) {
    if ($depsAfter[$pair[0]] -ne $depsBefore[$pair[0]] -and (Test-Path (Join-Path $pair[1] 'node_modules'))) {
        Write-Host ""
        Write-Host "Updating Node packages in $($pair[0])..." -ForegroundColor Cyan
        Push-Location $pair[1]
        try { & npm install --no-audit --no-fund } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { Fail "Installing Node packages failed (see above). The new GeoChem files are in place." }
    }
}

# --- 4. What's new --------------------------------------------------------
Write-Host ""
if ($after -eq $before) {
    Write-Host "GeoChem $after is already the latest version." -ForegroundColor Green
} else {
    Write-Host "Updated GeoChem $before -> $after" -ForegroundColor Green
    $log = Join-Path $RepoRoot 'CHANGELOG.md'
    if (Test-Path $log) {
        Write-Host ""
        Write-Host "What's new:" -ForegroundColor Cyan
        $show = $false
        foreach ($line in Get-Content $log) {
            if ($line -match '^##\s+\[?v?(\d+\.\d+\.\d+)') {
                $show = ([version]$Matches[1] -gt [version]$before)
                if ($show) { Write-Host ""; Write-Host $line.TrimStart('#', ' ') -ForegroundColor White }
            } elseif ($show) { Write-Host $line }
        }
    }
}

if ($Restart) {
    Write-Host ""
    Write-Host "Starting GeoChem..." -ForegroundColor Cyan
    Start-Process -FilePath (Join-Path $RepoRoot 'start-geochem.bat') -WorkingDirectory $RepoRoot -WindowStyle Minimized
    Start-Sleep -Seconds 8   # leave the notes on screen for a moment
}
Done 0
