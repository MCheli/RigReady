param(
    [string]$Layout
)

# set-displays.ps1
# Applies display layout using ChangeDisplaySettingsEx P/Invoke
# Input: JSON array of display configurations

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class DisplaySettings {
    [DllImport("user32.dll")]
    public static extern int ChangeDisplaySettingsEx(
        string lpszDeviceName,
        ref DEVMODE lpDevMode,
        IntPtr hwnd,
        uint dwflags,
        IntPtr lParam
    );

    [DllImport("user32.dll")]
    public static extern bool EnumDisplaySettings(
        string deviceName,
        int modeNum,
        ref DEVMODE devMode
    );

    public const int ENUM_CURRENT_SETTINGS = -1;
    public const uint CDS_UPDATEREGISTRY = 0x01;
    public const uint CDS_SET_PRIMARY = 0x10;
    public const uint CDS_NORESET = 0x10000000;
    public const uint CDS_RESET = 0x40000000;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct DEVMODE {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmDeviceName;
        public short dmSpecVersion;
        public short dmDriverVersion;
        public short dmSize;
        public short dmDriverExtra;
        public int dmFields;
        public int dmPositionX;
        public int dmPositionY;
        public int dmDisplayOrientation;
        public int dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel;
        public int dmPelsWidth;
        public int dmPelsHeight;
        public int dmDisplayFlags;
        public int dmDisplayFrequency;
        public int dmICMMethod;
        public int dmICMIntent;
        public int dmMediaType;
        public int dmDitherType;
        public int dmReserved1;
        public int dmReserved2;
        public int dmPanningWidth;
        public int dmPanningHeight;
    }
}
"@

try {
    $displays = $Layout | ConvertFrom-Json

    foreach ($display in $displays) {
        $deviceName = $display.Name

        $dm = New-Object DisplaySettings+DEVMODE
        $dm.dmSize = [System.Runtime.InteropServices.Marshal]::SizeOf($dm)

        # Get current settings first
        [DisplaySettings]::EnumDisplaySettings($deviceName, [DisplaySettings]::ENUM_CURRENT_SETTINGS, [ref]$dm) | Out-Null

        # Update with desired settings
        $dm.dmPelsWidth = $display.Width
        $dm.dmPelsHeight = $display.Height
        $dm.dmPositionX = $display.X
        $dm.dmPositionY = $display.Y
        $dm.dmFields = 0x00000020 -bor 0x00000080 -bor 0x00000100 -bor 0x00020000
        # DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFLAGS | DM_POSITION

        # Set rotation if specified (0=default, 1=90, 2=180, 3=270)
        if ($display.PSObject.Properties['Rotation'] -and $null -ne $display.Rotation) {
            $dm.dmDisplayOrientation = $display.Rotation
            $dm.dmFields = $dm.dmFields -bor 0x00000080
        }

        $flags = [DisplaySettings]::CDS_UPDATEREGISTRY -bor [DisplaySettings]::CDS_NORESET
        if ($display.IsPrimary) {
            $flags = $flags -bor [DisplaySettings]::CDS_SET_PRIMARY
        }

        $result = [DisplaySettings]::ChangeDisplaySettingsEx($deviceName, [ref]$dm, [IntPtr]::Zero, $flags, [IntPtr]::Zero)

        if ($result -ne 0) {
            Write-Error "Failed to set display $deviceName (error code: $result)"
        } else {
            Write-Output "Configured $deviceName : $($display.Width)x$($display.Height) at ($($display.X),$($display.Y))"
        }
    }

    # Apply all changes
    $emptyDm = New-Object DisplaySettings+DEVMODE
    $emptyDm.dmSize = [System.Runtime.InteropServices.Marshal]::SizeOf($emptyDm)
    [DisplaySettings]::ChangeDisplaySettingsEx($null, [ref]$emptyDm, [IntPtr]::Zero, 0, [IntPtr]::Zero) | Out-Null

    Write-Output "Display configuration applied."
} catch {
    Write-Error "Error: $_"
    exit 1
}
