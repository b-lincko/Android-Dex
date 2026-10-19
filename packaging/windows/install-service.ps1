<#
  Register Android DEX to start at logon for the current user, or as a Windows
  service when NSSM is installed.

  Usage (no admin needed):
    powershell -ExecutionPolicy Bypass -File install-service.ps1
  Usage (service, admin):
    powershell -ExecutionPolicy Bypass -File install-service.ps1 -Service -NssmPath C:\tools\nssm.exe
#>
param(
  [switch]$Service,
  [string]$InstallDir = "$env:LOCALAPPDATA\Android DEX",
  [int]$Port = 8787,
  [string]$NssmPath = ""
)

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js 20+ is required (https://nodejs.org)." }
$cli = Join-Path $InstallDir "server\src\cli.js"
if (-not (Test-Path $cli)) { throw "Android DEX is not installed in $InstallDir." }

$env:DEX_DATA_DIR = Join-Path $InstallDir "data"
$env:DEX_SHARE_DIR = Join-Path $env:USERPROFILE "Android-DEX-share"

if ($Service) {
  if (-not $NssmPath -or -not (Test-Path $NssmPath)) { throw "Pass -NssmPath pointing at nssm.exe for service mode." }
  & $NssmPath install AndroidDEX $node "`"$cli`" serve --host 0.0.0.0 --port $Port --data-dir `"$env:DEX_DATA_DIR`" --share-dir `"$env:DEX_SHARE_DIR`""
  & $NssmPath set AndroidDEX AppDirectory $InstallDir
  & $NssmPath set AndroidDEX Start SERVICE_AUTO_START
  & $NssmPath set AndroidDEX AppStdout "$env:DEX_DATA_DIR\bridge.log"
  & $NssmPath set AndroidDEX AppStderr "$env:DEX_DATA_DIR\bridge.err.log"
  & $NssmPath start AndroidDEX
  Write-Host "Service AndroidDEX started on port $Port." -ForegroundColor Green
  return
}

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$cli`" serve --host 127.0.0.1 --port $Port --data-dir `"$env:DEX_DATA_DIR`" --share-dir `"$env:DEX_SHARE_DIR`"" -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "Android DEX bridge" -Action $action -Trigger $trigger -Settings $settings -Description "Android DEX bridge (REST/WebSocket, clipboard, files, telephony)" -Force | Out-Null
Write-Host "Scheduled task 'Android DEX bridge' registered (starts at logon, port $Port)." -ForegroundColor Green
Write-Host "Remote access: start with --host 0.0.0.0 and set DEX_TOKEN." -ForegroundColor Yellow
