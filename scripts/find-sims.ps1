# Search all drives for DCS
Write-Host "=== Searching for DCS on all drives ===" -ForegroundColor Cyan
Get-PSDrive -PSProvider FileSystem | ForEach-Object {
    $drive = $_.Root
    Write-Host "Checking $drive..." -ForegroundColor Yellow
    Get-ChildItem -Path $drive -Filter "DCS.exe" -Recurse -ErrorAction SilentlyContinue -Depth 5 |
        Select-Object FullName, LastWriteTime | Format-Table -AutoSize
}

# Search for WinWing SimApp
Write-Host "`n=== Searching for WinWing SimAppPro ===" -ForegroundColor Cyan
Get-ChildItem -Path "C:\Program Files","C:\Program Files (x86)","$env:LOCALAPPDATA" -Filter "SimAppPro*" -Recurse -ErrorAction SilentlyContinue -Depth 4 |
    Select-Object FullName | Format-Table -AutoSize

# Check installed programs
Write-Host "`n=== Relevant Installed Programs ===" -ForegroundColor Cyan
Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*,
                 HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match 'DCS|WinWing|TrackIR|NaturalPoint|StreamDeck|Elgato|Thrustmaster|vJoy|OpenTrack' } |
    Select-Object DisplayName, InstallLocation, Publisher | Format-Table -AutoSize

# Check Steam library folders
Write-Host "`n=== Steam Library Folders ===" -ForegroundColor Cyan
$steamPath = "C:\Program Files (x86)\Steam\steamapps\libraryfolders.vdf"
if (Test-Path $steamPath) {
    Get-Content $steamPath
}

# Search Saved Games for DCS config
Write-Host "`n=== DCS Saved Games ===" -ForegroundColor Cyan
Get-ChildItem "$env:USERPROFILE\Saved Games" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'DCS' } |
    Select-Object FullName | Format-Table -AutoSize
