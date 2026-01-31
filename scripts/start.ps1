# Simple start script
Set-Location "C:\Users\Owner\repos\sim-manager"

# Kill existing
Get-Process -Name "electron" -ErrorAction SilentlyContinue | Stop-Process -Force 2>$null
Start-Sleep -Seconds 1

# Start electron
Start-Process "cmd.exe" -ArgumentList "/c", "npx electron ." -WindowStyle Normal

Start-Sleep -Seconds 3

# Report status
$procs = Get-Process -Name "electron" -ErrorAction SilentlyContinue
if ($procs) {
    Write-Host "Electron running: $($procs.Count) process(es)"
    Write-Host "Log file: $env:USERPROFILE\.sim-manager\app.log"
} else {
    Write-Host "Electron not running"
}
