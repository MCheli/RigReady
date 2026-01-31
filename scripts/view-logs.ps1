param(
    [int]$Lines = 100
)
$logFile = "$env:USERPROFILE\.sim-manager\app.log"
if (Test-Path $logFile) {
    Get-Content -Path $logFile -Tail $Lines
} else {
    Write-Host "Log file not found: $logFile"
}
