# Launch script - starts app in background, returns immediately
# Usage: .\scripts\launch.ps1

$projectRoot = Split-Path -Parent $PSScriptRoot
$logFile = "$env:USERPROFILE\.sim-manager\app.log"

# Kill existing electron processes
$killed = Get-Process -Name "electron" -ErrorAction SilentlyContinue
if ($killed) {
    $killed | Stop-Process -Force
    Write-Host "Killed $($killed.Count) existing electron process(es)" -ForegroundColor Yellow
    Start-Sleep -Seconds 1
}

# Change to project directory
Push-Location $projectRoot

# Clean dist and rebuild
Write-Host "Cleaning and building..." -ForegroundColor Cyan
if (Test-Path "dist") {
    Remove-Item -Recurse -Force "dist"
}

npm run build 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed! Check for TypeScript errors." -ForegroundColor Red
    Pop-Location
    exit 1
}

# Start electron in background
Write-Host "Starting Sim Manager..." -ForegroundColor Cyan
Start-Process -FilePath "npx" -ArgumentList "electron", "." -WindowStyle Normal -WorkingDirectory $projectRoot

Start-Sleep -Seconds 2

# Check if it started
$running = Get-Process -Name "electron" -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "App started successfully (PID: $($running[0].Id))" -ForegroundColor Green
    Write-Host "Log file: $logFile" -ForegroundColor Gray
} else {
    Write-Host "App may have failed to start. Check logs." -ForegroundColor Red
}

Pop-Location
