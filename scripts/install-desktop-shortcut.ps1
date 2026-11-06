# Creates (or refreshes) the GeoChem shortcut on the Desktop and in the Start
# menu. Both run start-geochem.bat with a minimised launcher console; the app
# then opens in its own window (see start-geochem.ps1).
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-desktop-shortcut.ps1
#   ... -NoStartMenu      Desktop only
#   ... -Uninstall        remove both shortcuts

param(
    [switch]$NoStartMenu,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $repoRoot 'start-geochem.bat'
$icon = Join-Path $PSScriptRoot 'geochem.ico'

# GetFolderPath follows OneDrive Desktop redirection
$folders = @([Environment]::GetFolderPath('Desktop'))
if (-not $NoStartMenu) { $folders += [Environment]::GetFolderPath('Programs') }

$shell = New-Object -ComObject WScript.Shell
foreach ($folder in $folders) {
    $path = Join-Path $folder 'GeoChem.lnk'
    if ($Uninstall) {
        if (Test-Path $path) { Remove-Item $path -Confirm:$false; Write-Host "Removed $path" }
        continue
    }
    $link = $shell.CreateShortcut($path)
    $link.TargetPath = $target
    $link.WorkingDirectory = $repoRoot
    $link.WindowStyle = 7   # minimised launcher console
    $link.Description = 'GeoChem - exploration geochemistry'
    $link.IconLocation = if (Test-Path $icon) { "$icon,0" } else { "$env:SystemRoot\System32\imageres.dll,186" }
    $link.Save()
    Write-Host "Created $path"
}
