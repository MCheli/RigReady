Add-Type -AssemblyName System.Windows.Forms

$monitors = [System.Windows.Forms.Screen]::AllScreens
$result = @()

foreach ($monitor in $monitors) {
    $result += @{
        Name = $monitor.DeviceName
        Width = $monitor.Bounds.Width
        Height = $monitor.Bounds.Height
        X = $monitor.Bounds.X
        Y = $monitor.Bounds.Y
        IsPrimary = $monitor.Primary
    }
}

$result | ConvertTo-Json -Compress
