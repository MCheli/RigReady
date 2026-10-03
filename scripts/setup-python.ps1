# Creates resources/python: an embeddable Python used by the DirectInput sidecar
# (python/input_server.py, standard library only). electron-builder ships this folder
# with the app (extraResources -> <app>/resources/python), so users never need Python
# installed.
#
#   npm run setup:python

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$pythonVersion = "3.12.10"
$pythonDir = Join-Path $PSScriptRoot "..\resources\python"
$pythonExe = Join-Path $pythonDir "python.exe"

function Test-Runtime {
    if (-not (Test-Path $pythonExe)) { return $false }
    # An older setup installed pip and pygame here; rebuild so the package stays small.
    if (Test-Path (Join-Path $pythonDir "Lib")) { return $false }
    & $pythonExe -c "import ctypes, json, uuid" 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
}

if (Test-Runtime) {
    Write-Host "resources/python is ready."
    exit 0
}

Write-Host "Downloading Python $pythonVersion (embeddable)..."
$zip = Join-Path $env:TEMP "rigready-python-embed.zip"
Invoke-WebRequest -Uri "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip" -OutFile $zip -UseBasicParsing
if (Test-Path $pythonDir) { Remove-Item -Recurse -Force $pythonDir }
New-Item -ItemType Directory -Force -Path $pythonDir | Out-Null
Expand-Archive -Path $zip -DestinationPath $pythonDir -Force
Remove-Item $zip -Force

if (-not (Test-Runtime)) { throw "The Python runtime in $pythonDir does not start" }
Write-Host "resources/python is ready."
