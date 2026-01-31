param(
    [int]$Lines = 100
)
$logFile = "$env:USERPROFILE\.rigready\app.log"
if (Test-Path $logFile) {
    Get-Content -Path $logFile -Tail $Lines
} else {
    Write-Host "Log file not found: $logFile"
}
