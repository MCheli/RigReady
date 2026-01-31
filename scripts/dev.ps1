# Development script - kills existing instances and starts fresh
param(
    [switch]$Background
)

$projectRoot = Split-Path -Parent $PSScriptRoot

# Kill existing electron processes
Get-Process -Name "electron" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# Change to project directory
Push-Location $projectRoot

# Clean and rebuild
Write-Host "Building..." -ForegroundColor Cyan
npm run rebuild

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    Pop-Location
    exit 1
}

Write-Host "Starting app..." -ForegroundColor Cyan

if ($Background) {
    # Start in background and return immediately
    Start-Process -FilePath "npx" -ArgumentList "electron", "." -WindowStyle Hidden
    Write-Host "App started in background" -ForegroundColor Green
} else {
    # Start and wait (blocks)
    & npx electron .
}

Pop-Location
