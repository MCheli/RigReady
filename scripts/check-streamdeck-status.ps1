# Check Stream Deck Setup Status

Write-Host "=== Stream Deck Setup Status ===" -ForegroundColor Cyan
Write-Host ""

# DCS-BIOS
Write-Host "DCS-BIOS:" -ForegroundColor Yellow
$dcsBiosPath = "$env:USERPROFILE\Saved Games\DCS\Scripts\DCS-BIOS"
if (Test-Path $dcsBiosPath) {
    Write-Host "  [OK] Installed at $dcsBiosPath" -ForegroundColor Green
} else {
    Write-Host "  [X] Not found" -ForegroundColor Red
}

# Export.lua
$exportLua = "$env:USERPROFILE\Saved Games\DCS\Scripts\Export.lua"
if (Test-Path $exportLua) {
    $content = Get-Content $exportLua -Raw
    if ($content -match 'DCS-BIOS') {
        Write-Host "  [OK] Export.lua configured" -ForegroundColor Green
    } else {
        Write-Host "  [!] Export.lua exists but DCS-BIOS not configured" -ForegroundColor Yellow
    }
}

Write-Host ""

# Stream Deck Software
Write-Host "Stream Deck Software:" -ForegroundColor Yellow
$sdPath = "$env:APPDATA\Elgato\StreamDeck"
if (Test-Path $sdPath) {
    Write-Host "  [OK] Installed" -ForegroundColor Green
} else {
    Write-Host "  [X] Not found" -ForegroundColor Red
}

Write-Host ""

# Stream Deck Plugins
Write-Host "Stream Deck Plugins:" -ForegroundColor Yellow
$pluginPath = "$env:APPDATA\Elgato\StreamDeck\Plugins"
if (Test-Path $pluginPath) {
    $plugins = Get-ChildItem $pluginPath -Directory
    $dcsPlugin = $plugins | Where-Object { $_.Name -match 'dcs|ctytler' }
    if ($dcsPlugin) {
        foreach ($p in $dcsPlugin) {
            Write-Host "  [OK] $($p.Name)" -ForegroundColor Green
        }
    } else {
        Write-Host "  [!] DCS Interface plugin not found" -ForegroundColor Yellow
        Write-Host "  Other plugins installed:" -ForegroundColor Gray
        $plugins | ForEach-Object { Write-Host "    - $($_.Name)" -ForegroundColor Gray }
    }
} else {
    Write-Host "  [X] Plugins folder not found" -ForegroundColor Red
}

Write-Host ""

# Stream Deck Profiles
Write-Host "Stream Deck Profiles:" -ForegroundColor Yellow
$profilePath = "$env:APPDATA\Elgato\StreamDeck\ProfilesV2"
if (Test-Path $profilePath) {
    $profiles = Get-ChildItem $profilePath -Directory
    Write-Host "  [OK] $($profiles.Count) profiles found" -ForegroundColor Green
} else {
    Write-Host "  [X] Profiles folder not found" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
