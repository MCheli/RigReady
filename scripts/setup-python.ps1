# Creates resources/python: an embeddable Python with pygame, used by the DirectInput
# sidecar (python/input_server.py). electron-builder ships this folder with the app
# (extraResources -> <app>/resources/python), so users never need Python installed.
#
#   npm run setup:python

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$pythonVersion = "3.12.10"
$pygameVersion = "2.6.1"
$pythonDir = Join-Path $PSScriptRoot "..\resources\python"
$pythonExe = Join-Path $pythonDir "python.exe"

function Test-Pygame {
    if (-not (Test-Path $pythonExe)) { return $false }
    & $pythonExe -c "import pygame" 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
}

if (Test-Pygame) {
    Write-Host "resources/python is ready (pygame imports)."
    exit 0
}

Write-Host "Downloading Python $pythonVersion (embeddable)..."
$zip = Join-Path $env:TEMP "rigready-python-embed.zip"
Invoke-WebRequest -Uri "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip" -OutFile $zip -UseBasicParsing
if (Test-Path $pythonDir) { Remove-Item -Recurse -Force $pythonDir }
New-Item -ItemType Directory -Force -Path $pythonDir | Out-Null
Expand-Archive -Path $zip -DestinationPath $pythonDir -Force
Remove-Item $zip -Force

# The embeddable build ignores site-packages until its ._pth file says otherwise.
$pth = Get-ChildItem -Path $pythonDir -Filter "python*._pth" | Select-Object -First 1
$lines = (Get-Content $pth.FullName) -replace "^#\s*import site", "import site"
$lines += "Lib\site-packages"
Set-Content -Path $pth.FullName -Value $lines -Encoding ascii

Write-Host "Installing pip and pygame $pygameVersion..."
$getPip = Join-Path $env:TEMP "rigready-get-pip.py"
Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip -UseBasicParsing
& $pythonExe $getPip --no-warn-script-location | Out-Null
if ($LASTEXITCODE -ne 0) { throw "pip installation failed" }
Remove-Item $getPip -Force
& $pythonExe -m pip install "pygame==$pygameVersion" --no-warn-script-location --disable-pip-version-check | Out-Null
if ($LASTEXITCODE -ne 0) { throw "pygame installation failed" }

if (-not (Test-Pygame)) { throw "pygame does not import from $pythonDir" }
Write-Host "resources/python is ready."
