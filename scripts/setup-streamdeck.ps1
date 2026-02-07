# Stream Deck DCS Setup Script
# This script downloads and installs Stream Deck software, DCS-BIOS, and the DCS Interface plugin
# Then restores your Stream Deck profiles from backup

param(
    [string]$BackupPath = "C:\Users\Owner\Documents\DCS Backup\Stream Deck - 02-03-2024 - 19-16.streamDeckProfilesBackup",
    [switch]$SkipStreamDeck,
    [switch]$SkipDCSBios,
    [switch]$SkipPlugin,
    [switch]$SkipRestore,
    [switch]$NonInteractive,
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

# Configuration
$DownloadDir = "$env:TEMP\StreamDeckSetup"
$DCSBiosVersion = "0.8.4"
$PluginVersion = "1.0.4"

# URLs
$StreamDeckDownloadPage = "https://www.elgato.com/us/en/s/downloads"
$DCSBiosUrl = "https://github.com/DCS-Skunkworks/dcs-bios/releases/download/v$DCSBiosVersion/DCS-BIOS_v$DCSBiosVersion.zip"
$PluginUrl = "https://github.com/enertial/streamdeck-dcs-interface/releases/download/v$PluginVersion/com.ctytler.dcs.streamDeckPlugin"

# DCS paths
$DCSPath = "$env:USERPROFILE\Saved Games\DCS"
$DCSBetaPath = "$env:USERPROFILE\Saved Games\DCS.openbeta"

function Write-Step {
    param([string]$Message)
    Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[!] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[X] $Message" -ForegroundColor Red
}

function Read-YesNo {
    param([string]$Prompt, [bool]$Default = $true)
    if ($NonInteractive -or $Yes) {
        return $Default
    }
    $choice = Read-Host $Prompt
    return ($choice -eq 'Y' -or $choice -eq 'y')
}

function Wait-ForUser {
    param([string]$Message = "Press Enter to continue...")
    if (-not $NonInteractive) {
        Write-Host $Message
        Read-Host | Out-Null
    }
}

function Test-StreamDeckInstalled {
    $paths = @(
        "$env:ProgramFiles\Elgato\StreamDeck\StreamDeck.exe",
        "${env:ProgramFiles(x86)}\Elgato\StreamDeck\StreamDeck.exe",
        "$env:LOCALAPPDATA\Elgato\StreamDeck\StreamDeck.exe"
    )
    foreach ($path in $paths) {
        if (Test-Path $path) {
            return $true
        }
    }
    # Check if running
    $process = Get-Process -Name "StreamDeck" -ErrorAction SilentlyContinue
    return $null -ne $process
}

function Test-DCSBiosInstalled {
    $scriptPaths = @(
        "$DCSPath\Scripts\DCS-BIOS",
        "$DCSBetaPath\Scripts\DCS-BIOS"
    )
    foreach ($path in $scriptPaths) {
        if (Test-Path $path) {
            return $path
        }
    }
    return $null
}

function Get-DCSScriptsPath {
    if (Test-Path $DCSBetaPath) {
        return "$DCSBetaPath\Scripts"
    } elseif (Test-Path $DCSPath) {
        return "$DCSPath\Scripts"
    }
    return $null
}

function Install-StreamDeck {
    Write-Step "Installing Stream Deck Software"

    if (Test-StreamDeckInstalled) {
        Write-Success "Stream Deck software is already installed"
        return $true
    }

    Write-Host "Stream Deck software needs to be installed manually."
    Write-Host ""
    Write-Host "Options:" -ForegroundColor Yellow
    Write-Host "  1. Download from: https://www.elgato.com/us/en/s/downloads"
    Write-Host "  2. Install from Microsoft Store: https://apps.microsoft.com/detail/xp8bsn2sf4xcjz"
    Write-Host ""

    if (Read-YesNo "Would you like to open the download page in your browser? (Y/N)") {
        Start-Process "https://www.elgato.com/us/en/s/downloads"
        Write-Host ""
        Wait-ForUser "Please install Stream Deck software and press Enter when done..."

        if (Test-StreamDeckInstalled) {
            Write-Success "Stream Deck software installed successfully"
            return $true
        } else {
            Write-Warning "Stream Deck software not detected. You may need to restart the script after installation."
            return $false
        }
    }

    return $false
}

function Install-DCSBios {
    Write-Step "Installing DCS-BIOS v$DCSBiosVersion"

    $existingPath = Test-DCSBiosInstalled
    if ($existingPath) {
        Write-Success "DCS-BIOS is already installed at: $existingPath"
        return $true
    }

    $scriptsPath = Get-DCSScriptsPath
    if (-not $scriptsPath) {
        Write-Error "DCS Saved Games folder not found. Please ensure DCS is installed and has been run at least once."
        return $false
    }

    # Create download directory
    if (-not (Test-Path $DownloadDir)) {
        New-Item -ItemType Directory -Path $DownloadDir -Force | Out-Null
    }

    $zipPath = "$DownloadDir\DCS-BIOS_v$DCSBiosVersion.zip"

    Write-Host "Downloading DCS-BIOS..."
    try {
        Invoke-WebRequest -Uri $DCSBiosUrl -OutFile $zipPath -UseBasicParsing
        Write-Success "Downloaded DCS-BIOS"
    } catch {
        Write-Error "Failed to download DCS-BIOS: $_"
        Write-Host "Please download manually from: https://github.com/DCS-Skunkworks/dcs-bios/releases"
        return $false
    }

    # Extract to Scripts folder
    Write-Host "Extracting DCS-BIOS to $scriptsPath..."
    try {
        # Create Scripts folder if it doesn't exist
        if (-not (Test-Path $scriptsPath)) {
            New-Item -ItemType Directory -Path $scriptsPath -Force | Out-Null
        }

        Expand-Archive -Path $zipPath -DestinationPath $scriptsPath -Force
        Write-Success "DCS-BIOS installed successfully"

        # Check for Export.lua setup
        $exportLua = "$scriptsPath\Export.lua"
        $dcsBiosLine = 'dofile(lfs.writedir()..[[Scripts\DCS-BIOS\BIOS.lua]])'

        if (Test-Path $exportLua) {
            $content = Get-Content $exportLua -Raw
            if ($content -notmatch 'DCS-BIOS') {
                Write-Host "Adding DCS-BIOS to Export.lua..."
                Add-Content -Path $exportLua -Value "`n$dcsBiosLine"
                Write-Success "Updated Export.lua"
            } else {
                Write-Success "Export.lua already configured for DCS-BIOS"
            }
        } else {
            Write-Host "Creating Export.lua..."
            Set-Content -Path $exportLua -Value $dcsBiosLine
            Write-Success "Created Export.lua with DCS-BIOS"
        }

        return $true
    } catch {
        Write-Error "Failed to extract DCS-BIOS: $_"
        return $false
    }
}

function Install-StreamDeckPlugin {
    Write-Step "Installing DCS Interface Stream Deck Plugin v$PluginVersion"

    # Check if Stream Deck is installed first
    if (-not (Test-StreamDeckInstalled)) {
        Write-Warning "Stream Deck software must be installed first"
        return $false
    }

    # Create download directory
    if (-not (Test-Path $DownloadDir)) {
        New-Item -ItemType Directory -Path $DownloadDir -Force | Out-Null
    }

    $pluginPath = "$DownloadDir\com.ctytler.dcs.streamDeckPlugin"

    Write-Host "Downloading DCS Interface plugin..."
    try {
        Invoke-WebRequest -Uri $PluginUrl -OutFile $pluginPath -UseBasicParsing
        Write-Success "Downloaded DCS Interface plugin"
    } catch {
        Write-Error "Failed to download plugin: $_"
        Write-Host "Please download manually from: https://github.com/enertial/streamdeck-dcs-interface/releases"
        return $false
    }

    # Install the plugin by opening it (Stream Deck will handle installation)
    Write-Host "Installing plugin (Stream Deck will prompt for confirmation)..."
    try {
        Start-Process $pluginPath
        Write-Host ""
        Wait-ForUser "Please click 'Install' in the Stream Deck dialog that appears, then press Enter..."
        Write-Success "DCS Interface plugin installation initiated"
        return $true
    } catch {
        Write-Error "Failed to launch plugin installer: $_"
        return $false
    }
}

function Restore-StreamDeckProfiles {
    Write-Step "Restoring Stream Deck Profiles from Backup"

    if (-not (Test-Path $BackupPath)) {
        Write-Error "Backup file not found: $BackupPath"
        return $false
    }

    if (-not (Test-StreamDeckInstalled)) {
        Write-Warning "Stream Deck software must be installed first"
        return $false
    }

    # Stream Deck profiles location
    $profilesDir = "$env:APPDATA\Elgato\StreamDeck\ProfilesV2"

    Write-Host "Backup file: $BackupPath"
    Write-Host "Size: $([math]::Round((Get-Item $BackupPath).Length / 1MB, 2)) MB"
    Write-Host ""

    # List profiles in backup
    Write-Host "Profiles in backup:" -ForegroundColor Yellow
    $profiles = @(
        "DCS World (Main)",
        "F18C XL (F/A-18C Hornet)",
        "F-16 stream deck xl profile",
        "F-15E S4+ Pilot",
        "F-15E S4+ WSO",
        "F-14B cold start with Rio cockpit XL",
        "UH-1H (Huey)",
        "P-51D (Mustang)",
        "Discord Labeled XL Plugin Win"
    )
    foreach ($profile in $profiles) {
        Write-Host "  - $profile"
    }
    Write-Host ""

    # The .streamDeckProfilesBackup file can be imported via Stream Deck app
    Write-Host "To restore profiles:" -ForegroundColor Yellow
    Write-Host "  1. Open Stream Deck software"
    Write-Host "  2. Click the gear icon (Preferences)"
    Write-Host "  3. Go to 'Profiles' tab"
    Write-Host "  4. Click 'Import' or drag the backup file into the window"
    Write-Host ""

    if (Read-YesNo "Would you like to open the backup file location? (Y/N)") {
        $backupDir = Split-Path $BackupPath -Parent
        Start-Process "explorer.exe" -ArgumentList "/select,`"$BackupPath`""
        Write-Success "Opened backup location in Explorer"
    }

    # Also offer to open Stream Deck
    if (Read-YesNo "Would you like to launch Stream Deck software? (Y/N)") {
        $sdPaths = @(
            "$env:ProgramFiles\Elgato\StreamDeck\StreamDeck.exe",
            "${env:ProgramFiles(x86)}\Elgato\StreamDeck\StreamDeck.exe",
            "$env:LOCALAPPDATA\Elgato\StreamDeck\StreamDeck.exe"
        )
        foreach ($sdPath in $sdPaths) {
            if (Test-Path $sdPath) {
                Start-Process $sdPath
                Write-Success "Launched Stream Deck software"
                break
            }
        }
    }

    return $true
}

function Show-Summary {
    Write-Step "Setup Summary"

    Write-Host ""
    Write-Host "Component Status:" -ForegroundColor Yellow

    # Stream Deck
    if (Test-StreamDeckInstalled) {
        Write-Success "Stream Deck Software: Installed"
    } else {
        Write-Warning "Stream Deck Software: Not Installed"
    }

    # DCS-BIOS
    $biosPath = Test-DCSBiosInstalled
    if ($biosPath) {
        Write-Success "DCS-BIOS: Installed at $biosPath"
    } else {
        Write-Warning "DCS-BIOS: Not Installed"
    }

    # Plugin (can't easily detect, so just note)
    Write-Host "[?] DCS Interface Plugin: Check Stream Deck app" -ForegroundColor Cyan

    Write-Host ""
    Write-Host "Backup:" -ForegroundColor Yellow
    if (Test-Path $BackupPath) {
        Write-Success "Backup file found: $BackupPath"
    } else {
        Write-Warning "Backup file not found"
    }

    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Yellow
    Write-Host "  1. Ensure Stream Deck device is connected"
    Write-Host "  2. Open Stream Deck software"
    Write-Host "  3. Import profiles from backup file"
    Write-Host "  4. Launch DCS World to test"
    Write-Host ""
}

# Main execution
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Stream Deck DCS Setup Script" -ForegroundColor Cyan
Write-Host "  RigReady - Sim Hardware Manager" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Pre-flight checks
Write-Step "Pre-flight Checks"

# Check for DCS
$dcsFound = (Test-Path $DCSPath) -or (Test-Path $DCSBetaPath)
if ($dcsFound) {
    Write-Success "DCS Saved Games folder found"
} else {
    Write-Warning "DCS Saved Games folder not found - DCS-BIOS installation may fail"
}

# Check for backup
if (Test-Path $BackupPath) {
    Write-Success "Stream Deck backup found"
} else {
    Write-Warning "Stream Deck backup not found at: $BackupPath"
}

Write-Host ""
if (-not (Read-YesNo "Ready to begin setup? (Y/N)")) {
    Write-Host "Setup cancelled."
    exit 0
}

# Run installation steps
$success = $true

if (-not $SkipStreamDeck) {
    $result = Install-StreamDeck
    $success = $success -and $result
}

if (-not $SkipDCSBios) {
    $result = Install-DCSBios
    $success = $success -and $result
}

if (-not $SkipPlugin) {
    $result = Install-StreamDeckPlugin
    # Don't fail if plugin install fails - it's interactive
}

if (-not $SkipRestore) {
    $result = Restore-StreamDeckProfiles
}

# Show summary
Show-Summary

if ($success) {
    Write-Host "Setup completed!" -ForegroundColor Green
} else {
    Write-Host "Setup completed with warnings. Please review the messages above." -ForegroundColor Yellow
}

# Cleanup
if (Test-Path $DownloadDir) {
    if (Read-YesNo "Clean up temporary downloads? (Y/N)") {
        Remove-Item -Path $DownloadDir -Recurse -Force
        Write-Success "Cleaned up temporary files"
    }
}

if (-not $NonInteractive) {
    Write-Host ""
    Write-Host "Press Enter to exit..."
    Read-Host | Out-Null
}
