# Get all game controllers with full details
Write-Host "=== All Game Controllers (Detailed) ===" -ForegroundColor Cyan

# Known vendor IDs
$vendors = @{
    '4098' = 'WinWing'
    '044F' = 'Thrustmaster'
    '3344' = 'Virpil'
    '0FD9' = 'Elgato'
    '1189' = 'NaturalPoint (TrackIR)'
    '231D' = 'VKB'
    '03EB' = 'VKB (Atmel)'
}

Get-PnpDevice -Status OK -Class 'HIDClass' |
    Where-Object { $_.FriendlyName -match 'game controller' } |
    ForEach-Object {
        $device = $_
        $vid = if ($device.InstanceId -match 'VID_([A-F0-9]+)') { $matches[1] } else { 'Unknown' }
        $pid = if ($device.InstanceId -match 'PID_([A-F0-9]+)') { $matches[1] } else { 'Unknown' }
        $vendorName = if ($vendors.ContainsKey($vid)) { $vendors[$vid] } else { "Unknown ($vid)" }

        [PSCustomObject]@{
            Vendor = $vendorName
            ProductID = $pid
            InstanceId = $device.InstanceId
        }
    } | Sort-Object Vendor, ProductID | Format-Table -AutoSize

# Check for Thrustmaster pedals specifically
Write-Host "`n=== All Thrustmaster Devices ===" -ForegroundColor Cyan
Get-PnpDevice -Status OK | Where-Object { $_.InstanceId -match 'VID_044F' } |
    Select-Object FriendlyName, @{N='PID';E={if($_.InstanceId -match 'PID_([A-F0-9]+)'){$matches[1]}}} |
    Format-Table -AutoSize

# Check for Virpil devices
Write-Host "`n=== All Virpil Devices ===" -ForegroundColor Cyan
Get-PnpDevice -Status OK | Where-Object { $_.InstanceId -match 'VID_3344' } |
    Select-Object FriendlyName, @{N='PID';E={if($_.InstanceId -match 'PID_([A-F0-9]+)'){$matches[1]}}} |
    Format-Table -AutoSize
