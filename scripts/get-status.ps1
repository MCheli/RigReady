# Check running sim-related processes
Write-Host "=== Sim-Related Processes ===" -ForegroundColor Cyan
$simProcesses = @('TrackIR', 'SimAppPro', 'StreamDeck', 'DCS', 'openbeta', 'Tacview', 'SRS', 'vJoy', 'Joystick')
Get-Process | Where-Object {
    $proc = $_.ProcessName
    $simProcesses | Where-Object { $proc -match $_ }
} | Select-Object ProcessName, Id, @{N='Path';E={$_.Path}} | Format-Table -AutoSize

Write-Host "`n=== All Running Processes (filtered) ===" -ForegroundColor Cyan
Get-Process | Select-Object ProcessName | Sort-Object ProcessName -Unique |
    Where-Object { $_.ProcessName -match 'track|wing|deck|dcs|sim|joy|vr|openxr|steam|tacview|srs' } |
    Format-Table -AutoSize

# Find DCS installation
Write-Host "`n=== Searching for DCS Installation ===" -ForegroundColor Cyan
$dcsLocations = @(
    "$env:USERPROFILE\Saved Games\DCS",
    "$env:USERPROFILE\Saved Games\DCS.openbeta",
    "C:\Program Files\Eagle Dynamics\DCS World",
    "C:\Program Files\Eagle Dynamics\DCS World OpenBeta",
    "D:\DCS World",
    "D:\Games\DCS World",
    "E:\DCS World",
    "E:\Games\DCS World"
)

foreach ($loc in $dcsLocations) {
    if (Test-Path $loc) {
        Write-Host "Found: $loc" -ForegroundColor Green
    }
}

# Check registry for DCS
Write-Host "`n=== DCS Registry Entries ===" -ForegroundColor Cyan
$regPaths = @(
    "HKLM:\SOFTWARE\Eagle Dynamics",
    "HKLM:\SOFTWARE\WOW6432Node\Eagle Dynamics",
    "HKCU:\SOFTWARE\Eagle Dynamics"
)
foreach ($path in $regPaths) {
    if (Test-Path $path) {
        Get-ChildItem $path -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Host $_.Name
            Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue | Format-List
        }
    }
}

# Check for WinWing software
Write-Host "`n=== WinWing Software ===" -ForegroundColor Cyan
$winwingPaths = @(
    "C:\Program Files\WinWing",
    "C:\Program Files (x86)\WinWing",
    "$env:LOCALAPPDATA\WinWing"
)
foreach ($path in $winwingPaths) {
    if (Test-Path $path) {
        Write-Host "Found: $path" -ForegroundColor Green
        Get-ChildItem $path -ErrorAction SilentlyContinue | Select-Object Name
    }
}

# Check for TrackIR software
Write-Host "`n=== TrackIR Software ===" -ForegroundColor Cyan
$trackIRPaths = @(
    "C:\Program Files\NaturalPoint",
    "C:\Program Files (x86)\NaturalPoint"
)
foreach ($path in $trackIRPaths) {
    if (Test-Path $path) {
        Write-Host "Found: $path" -ForegroundColor Green
    }
}
