# Get simulation-related devices
Write-Host "=== WinWing Devices (VID_4098) ===" -ForegroundColor Cyan
Get-PnpDevice -Status OK | Where-Object { $_.InstanceId -match 'VID_4098' } |
    Select-Object FriendlyName, @{N='ProductID';E={if($_.InstanceId -match 'PID_([A-F0-9]+)'){$matches[1]}}} |
    Format-Table -AutoSize

Write-Host "`n=== Stream Deck (VID_0FD9) ===" -ForegroundColor Cyan
Get-PnpDevice -Status OK | Where-Object { $_.InstanceId -match 'VID_0FD9' } |
    Select-Object FriendlyName, InstanceId | Format-Table -AutoSize

Write-Host "`n=== TrackIR / NaturalPoint (VID_1189) ===" -ForegroundColor Cyan
Get-PnpDevice -Status OK | Where-Object { $_.InstanceId -match 'VID_1189' } |
    Select-Object FriendlyName, InstanceId | Format-Table -AutoSize

Write-Host "`n=== Thrustmaster (VID_044F) ===" -ForegroundColor Cyan
Get-PnpDevice -Status OK | Where-Object { $_.InstanceId -match 'VID_044F' } |
    Select-Object FriendlyName, InstanceId | Format-Table -AutoSize

Write-Host "`n=== All Game Controllers ===" -ForegroundColor Cyan
Get-PnpDevice -Status OK -Class 'HIDClass' | Where-Object { $_.FriendlyName -match 'game controller' } |
    Select-Object FriendlyName, @{N='VendorID';E={if($_.InstanceId -match 'VID_([A-F0-9]+)'){$matches[1]}}},
                               @{N='ProductID';E={if($_.InstanceId -match 'PID_([A-F0-9]+)'){$matches[1]}}} |
    Format-Table -AutoSize
