# Creates resources/python: an embeddable Python used by the DirectInput sidecar
# (python/input_server.py, standard library only). electron-builder ships this folder
# with the app (extraResources -> <app>/resources/python), so users never need Python
# installed.
#
#   npm run setup:python

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$pythonVersion = "3.12.10"
# SHA-256 of python-$pythonVersion-embed-amd64.zip, as listed in python.org's SPDX file for it.
# The archive goes into the installer, so a download that does not match is never used.
$pythonSha256 = "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3"
$pythonDir = Join-Path $PSScriptRoot "..\resources\python"
$pythonExe = Join-Path $pythonDir "python.exe"

function Test-Runtime {
    if (-not (Test-Path $pythonExe)) { return $false }
    # An older setup installed pip and pygame here; rebuild so the package stays small.
    if (Test-Path (Join-Path $pythonDir "Lib")) { return $false }
    & $pythonExe -c "import ctypes, json, uuid" 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
}

# ViGEmClient.dll, for the virtual controller helper (python/pad_server.py). Nefarius does not
# publish the client library as a DLL; the vgamepad package (MIT) ships one built from
# ViGEmClient (MIT). Only that file is taken out of the pinned source archive; nothing in it is
# run, and its ViGEmBus installer is left alone: the user installs the driver themselves.
$vgamepadVersion = "0.1.0"
$vgamepadUrl = "https://files.pythonhosted.org/packages/8a/54/0eaddc33f84247963af078f364b37153d09fcd6cdc398f243ec3e8842c56/vgamepad-0.1.0.tar.gz"
$vgamepadSha256 = "57f6bd01aec0c172947517fb782d150ef9b285f7f4d524c317374fa5c24a89de"
$clientSha256 = "2bf0cb1d809039573c922737d298a1653d4dbc61408060ff45a9bcfde82e97d2"
$vigemDir = Join-Path $PSScriptRoot "..\resources\vigem"
$clientDll = Join-Path $vigemDir "ViGEmClient.dll"

function Get-Sha256([string]$file) {
    # .NET rather than Get-FileHash: see the note on the Python download below.
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($file)
    try { return -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") }) }
    finally { $stream.Dispose(); $sha.Dispose() }
}

function Install-VigemClient {
    if ((Test-Path $clientDll) -and ((Get-Sha256 $clientDll) -eq $clientSha256)) {
        Write-Host "resources/vigem is ready."
        return
    }
    Write-Host "Downloading ViGEmClient.dll (from vgamepad $vgamepadVersion)..."
    $work = Join-Path $env:TEMP ("rigready-vgamepad-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    try {
        $archive = Join-Path $work "vgamepad.tar.gz"
        Invoke-WebRequest -Uri $vgamepadUrl -OutFile $archive -UseBasicParsing
        $actual = Get-Sha256 $archive
        if ($actual -ne $vgamepadSha256) { throw "The vgamepad download does not match its expected SHA-256 (got $actual)" }
        $inside = "vgamepad-$vgamepadVersion/vgamepad/win/vigem/client/x64/ViGEmClient.dll"
        $license = "vgamepad-$vgamepadVersion/LICENSE"
        & tar.exe -xzf $archive -C $work $inside $license
        if ($LASTEXITCODE -ne 0) { throw "ViGEmClient.dll could not be taken out of the archive" }
        $dll = Join-Path $work $inside
        $actual = Get-Sha256 $dll
        if ($actual -ne $clientSha256) { throw "ViGEmClient.dll does not match its expected SHA-256 (got $actual)" }
        New-Item -ItemType Directory -Force -Path $vigemDir | Out-Null
        Copy-Item $dll $clientDll -Force
        Copy-Item (Join-Path $work $license) (Join-Path $vigemDir "LICENSE-vgamepad.txt") -Force
        Write-Host "resources/vigem is ready."
    }
    finally { Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue }
}

Install-VigemClient

if (Test-Runtime) {
    Write-Host "resources/python is ready."
    exit 0
}

Write-Host "Downloading Python $pythonVersion (embeddable)..."
$zip = Join-Path $env:TEMP "rigready-python-embed.zip"
Invoke-WebRequest -Uri "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip" -OutFile $zip -UseBasicParsing
# .NET rather than Get-FileHash: Windows PowerShell 5.1 started from pwsh 7 (as in CI) inherits
# PS7's module path and cannot load Get-FileHash.
$sha = [System.Security.Cryptography.SHA256]::Create()
$stream = [System.IO.File]::OpenRead($zip)
try { $actual = -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") }) }
finally { $stream.Dispose(); $sha.Dispose() }
if ($actual -ne $pythonSha256) {
    Remove-Item $zip -Force
    throw "The Python download does not match its expected SHA-256 (got $actual)"
}
if (Test-Path $pythonDir) { Remove-Item -Recurse -Force $pythonDir }
New-Item -ItemType Directory -Force -Path $pythonDir | Out-Null
Expand-Archive -Path $zip -DestinationPath $pythonDir -Force
Remove-Item $zip -Force

if (-not (Test-Runtime)) { throw "The Python runtime in $pythonDir does not start" }
Write-Host "resources/python is ready."
