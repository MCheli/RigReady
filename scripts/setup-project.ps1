# Refresh PATH to pick up newly installed Node.js
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

# Navigate to project directory
Set-Location 'C:\Users\Owner\repos\sim-manager'

# Check node/npm
Write-Host "Node version:" -ForegroundColor Cyan
node --version
Write-Host "NPM version:" -ForegroundColor Cyan
npm --version

# Initialize npm project
Write-Host "`nInitializing npm project..." -ForegroundColor Cyan
npm init -y

# Install dependencies
Write-Host "`nInstalling Electron and TypeScript..." -ForegroundColor Cyan
npm install --save-dev electron typescript @types/node electron-builder
npm install --save-dev ts-node

Write-Host "`nProject initialized!" -ForegroundColor Green
