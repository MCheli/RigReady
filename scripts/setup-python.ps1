# Setup Python for pygame DirectInput access
# Downloads Python embeddable package and installs pygame

$ErrorActionPreference = "Stop"

$pythonVersion = "3.12.4"
$pythonDir = Join-Path $PSScriptRoot "..\resources\python"
$pythonZip = Join-Path $env:TEMP "python-embed.zip"
$pythonUrl = "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip"
$getPipUrl = "https://bootstrap.pypa.io/get-pip.py"

Write-Host "=== Python + pygame Setup ===" -ForegroundColor Cyan
Write-Host ""

# Create resources directory
$resourcesDir = Join-Path $PSScriptRoot "..\resources"
if (-not (Test-Path $resourcesDir)) {
    New-Item -ItemType Directory -Path $resourcesDir -Force | Out-Null
}

# Check if Python is already set up
$pythonExe = Join-Path $pythonDir "python.exe"
if (Test-Path $pythonExe) {
    Write-Host "Python already installed at: $pythonDir" -ForegroundColor Green

    # Check if pygame is installed
    $pygameCheck = & $pythonExe -c "import pygame; print(pygame.version.ver)" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "pygame version: $pygameCheck" -ForegroundColor Green
        Write-Host ""
        Write-Host "Setup complete! Python + pygame already configured." -ForegroundColor Green
        exit 0
    } else {
        Write-Host "pygame not installed, will install..." -ForegroundColor Yellow
    }
} else {
    Write-Host "Downloading Python $pythonVersion embeddable..." -ForegroundColor Yellow

    # Download Python
    try {
        Invoke-WebRequest -Uri $pythonUrl -OutFile $pythonZip -UseBasicParsing
    } catch {
        Write-Error "Failed to download Python: $_"
        exit 1
    }

    Write-Host "Extracting Python..." -ForegroundColor Yellow

    # Extract
    if (Test-Path $pythonDir) {
        Remove-Item -Recurse -Force $pythonDir
    }
    Expand-Archive -Path $pythonZip -DestinationPath $pythonDir -Force
    Remove-Item $pythonZip -Force

    # Enable pip by modifying python312._pth
    $pthFile = Join-Path $pythonDir "python312._pth"
    if (Test-Path $pthFile) {
        $content = Get-Content $pthFile
        # Uncomment import site
        $content = $content -replace "^#import site", "import site"
        # Add Lib\site-packages
        $content += "`nLib\site-packages"
        Set-Content $pthFile $content
    }

    Write-Host "Installing pip..." -ForegroundColor Yellow

    # Download and run get-pip.py
    $getPipPath = Join-Path $env:TEMP "get-pip.py"
    try {
        Invoke-WebRequest -Uri $getPipUrl -OutFile $getPipPath -UseBasicParsing
    } catch {
        Write-Error "Failed to download get-pip.py: $_"
        exit 1
    }

    & $pythonExe $getPipPath --no-warn-script-location 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install pip"
        exit 1
    }
    Remove-Item $getPipPath -Force

    Write-Host "Python installed successfully!" -ForegroundColor Green
}

# Install pygame
Write-Host "Installing pygame..." -ForegroundColor Yellow

$pipExe = Join-Path $pythonDir "Scripts\pip.exe"
if (-not (Test-Path $pipExe)) {
    $pipExe = Join-Path $pythonDir "python.exe"
    $pipArgs = @("-m", "pip", "install", "pygame", "--no-warn-script-location")
} else {
    $pipArgs = @("install", "pygame", "--no-warn-script-location")
}

& $pythonExe -m pip install pygame --no-warn-script-location 2>&1 | ForEach-Object {
    if ($_ -notmatch "WARNING") {
        Write-Host $_
    }
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to install pygame"
    exit 1
}

# Verify installation
Write-Host ""
Write-Host "Verifying installation..." -ForegroundColor Yellow

$verifyScript = @"
import pygame
import sys

pygame.init()
pygame.joystick.init()

print(f"Python: {sys.version}")
print(f"pygame: {pygame.version.ver}")
print(f"Joysticks detected: {pygame.joystick.get_count()}")

for i in range(pygame.joystick.get_count()):
    js = pygame.joystick.Joystick(i)
    js.init()
    print(f"  [{i}] {js.get_name()}: {js.get_numaxes()} axes, {js.get_numbuttons()} buttons, {js.get_numhats()} hats")

pygame.quit()
"@

$verifyPath = Join-Path $env:TEMP "verify_pygame.py"
Set-Content $verifyPath $verifyScript

& $pythonExe $verifyPath
$result = $LASTEXITCODE

Remove-Item $verifyPath -Force

if ($result -eq 0) {
    Write-Host ""
    Write-Host "=== Setup Complete! ===" -ForegroundColor Green
    Write-Host "Python location: $pythonDir" -ForegroundColor Cyan
} else {
    Write-Error "Verification failed"
    exit 1
}
