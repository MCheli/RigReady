Get-PnpDevice -Status OK -Class 'HIDClass' | ForEach-Object {
    $device = $_
    $vendorId = if ($device.InstanceId -match 'VID_([A-F0-9]+)') { $matches[1] } else { '' }
    $productId = if ($device.InstanceId -match 'PID_([A-F0-9]+)') { $matches[1] } else { '' }
    [PSCustomObject]@{
        VendorId = $vendorId
        ProductId = $productId
        InstanceId = $device.InstanceId
        FriendlyName = $device.FriendlyName
    }
} | Where-Object { $_.VendorId -ne '' } | ConvertTo-Json -Depth 3
