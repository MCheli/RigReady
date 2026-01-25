# Refresh PATH to pick up Node.js
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

Set-Location 'C:\Users\Owner\repos\sim-manager'

Write-Host "Creating output directories..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "dist/main" | Out-Null
New-Item -ItemType Directory -Force -Path "dist/main/devices" | Out-Null
New-Item -ItemType Directory -Force -Path "dist/renderer" | Out-Null

Write-Host "Compiling TypeScript..." -ForegroundColor Cyan
npx tsc

if ($LASTEXITCODE -ne 0) {
    Write-Host "TypeScript compilation failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Copying assets..." -ForegroundColor Cyan
Copy-Item -Path "src/renderer/*.html" -Destination "dist/renderer/" -Force
Copy-Item -Path "src/renderer/*.css" -Destination "dist/renderer/" -Force
Copy-Item -Path "src/renderer/*.js" -Destination "dist/renderer/" -Force
Copy-Item -Path "src/main/devices/*.ps1" -Destination "dist/main/devices/" -Force

Write-Host "Build complete!" -ForegroundColor Green
Write-Host "Starting Electron..." -ForegroundColor Cyan

npx electron .
