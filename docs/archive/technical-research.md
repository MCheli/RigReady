# RigReady - Technical Research Document

## Overview

This document contains technical research findings relevant to RigReady's implementation, including Windows APIs, SimAppPro analysis, and hardware integration details.

---

## Table of Contents

1. [Windows Display Configuration APIs](#windows-display-configuration-apis)
2. [SimAppPro Analysis](#simapppro-analysis)
3. [USB Device Detection](#usb-device-detection)
4. [Input Handling](#input-handling)
5. [File Format Parsing](#file-format-parsing)

---

## Windows Display Configuration APIs

### Summary

RigReady can programmatically modify Windows display settings **without admin privileges**.

### Capabilities

| Setting | Supported | API |
|---------|-----------|-----|
| Rotation (0°, 90°, 180°, 270°) | ✅ Yes | `ChangeDisplaySettingsEx` |
| Position (virtual desktop) | ✅ Yes | `ChangeDisplaySettingsEx` |
| Resolution | ✅ Yes | `ChangeDisplaySettingsEx` |
| Primary display | ✅ Yes | Position to (0,0) + `CDS_SET_PRIMARY` |
| Refresh rate | ✅ Yes | `ChangeDisplaySettingsEx` |

### Primary APIs

#### Win32 API (Recommended)

```c
// Enumerate displays
BOOL EnumDisplayDevices(
    LPCSTR lpDevice,           // NULL for first call
    DWORD iDevNum,             // Device index
    PDISPLAY_DEVICE lpDD,      // Output structure
    DWORD dwFlags              // 0 or EDD_GET_DEVICE_INTERFACE_NAME
);

// Get available modes
BOOL EnumDisplaySettings(
    LPCSTR lpszDeviceName,     // From EnumDisplayDevices
    DWORD iModeNum,            // Mode index or ENUM_CURRENT_SETTINGS
    DEVMODE *lpDevMode         // Output structure
);

// Apply changes
LONG ChangeDisplaySettingsEx(
    LPCSTR lpszDeviceName,     // Device to modify
    DEVMODE *lpDevMode,        // New settings
    HWND hwnd,                 // NULL
    DWORD dwflags,             // See flags below
    LPVOID lParam              // NULL
);
```

#### Key Flags for ChangeDisplaySettingsEx

| Flag | Value | Description |
|------|-------|-------------|
| `CDS_UPDATEREGISTRY` | 0x01 | Persist changes across reboots |
| `CDS_TEST` | 0x02 | Test if mode is valid |
| `CDS_NORESET` | 0x10000000 | Stage change without applying |
| `CDS_SET_PRIMARY` | 0x10 | Make this the primary display |

#### DEVMODE Structure (Key Fields)

```c
typedef struct _DEVMODE {
    // ...
    DWORD dmFields;           // Which fields are valid
    POINTL dmPosition;        // Monitor position (x, y)
    DWORD dmDisplayOrientation; // Rotation
    DWORD dmPelsWidth;        // Width in pixels
    DWORD dmPelsHeight;       // Height in pixels
    DWORD dmBitsPerPel;       // Color depth
    DWORD dmDisplayFrequency; // Refresh rate
    // ...
} DEVMODE;

// Rotation values
#define DMDO_DEFAULT    0  // Landscape (0°)
#define DMDO_90         1  // Portrait (90°)
#define DMDO_180        2  // Landscape flipped (180°)
#define DMDO_270        3  // Portrait flipped (270°)
```

### Atomic Multi-Monitor Updates

When changing multiple monitors, stage all changes first:

```c
// Stage changes for each monitor (don't apply yet)
for (each monitor in configuration) {
    DEVMODE dm = {0};
    dm.dmSize = sizeof(DEVMODE);
    dm.dmPosition.x = monitor.x;
    dm.dmPosition.y = monitor.y;
    dm.dmDisplayOrientation = monitor.rotation;
    dm.dmFields = DM_POSITION | DM_DISPLAYORIENTATION;

    ChangeDisplaySettingsEx(
        monitor.deviceName,
        &dm,
        NULL,
        CDS_UPDATEREGISTRY | CDS_NORESET,  // Stage, don't apply
        NULL
    );
}

// Apply all changes at once
ChangeDisplaySettingsEx(NULL, NULL, NULL, 0, NULL);
```

### Return Codes

```c
#define DISP_CHANGE_SUCCESSFUL    0   // Success
#define DISP_CHANGE_RESTART       1   // Reboot required (rare)
#define DISP_CHANGE_FAILED       -1   // General failure
#define DISP_CHANGE_BADMODE      -2   // Mode not supported
#define DISP_CHANGE_NOTUPDATED   -3   // Registry write failed
#define DISP_CHANGE_BADFLAGS     -4   // Invalid flags
#define DISP_CHANGE_BADPARAM     -5   // Invalid parameters
```

### .NET P/Invoke

```csharp
[DllImport("user32.dll", CharSet = CharSet.Auto)]
public static extern int ChangeDisplaySettingsEx(
    string lpszDeviceName,
    ref DEVMODE lpDevMode,
    IntPtr hwnd,
    uint dwflags,
    IntPtr lParam);

[DllImport("user32.dll", CharSet = CharSet.Auto)]
public static extern bool EnumDisplayDevices(
    string lpDevice,
    uint iDevNum,
    ref DISPLAY_DEVICE lpDisplayDevice,
    uint dwFlags);

[DllImport("user32.dll", CharSet = CharSet.Auto)]
public static extern bool EnumDisplaySettings(
    string lpszDeviceName,
    int iModeNum,
    ref DEVMODE lpDevMode);
```

### Existing Libraries

| Library | Language | Notes |
|---------|----------|-------|
| **WindowsDisplayAPI** | C# | NuGet package wrapping Win32 |
| **MonitorSwitcher** | C# | Open source utility |
| **MultiMonitorTool** | CLI | NirSoft freeware |
| **display-changer** | CLI | Command-line tool |

### Limitations

- GPU driver must support requested mode
- Some rotations may not work on all displays
- Remote Desktop sessions may behave differently
- Display changes take 1-3 seconds to apply

---

## SimAppPro Analysis

### Overview

SimAppPro is WinWing's official configuration software. Understanding its behavior helps RigReady coexist and potentially replace some functionality.

### Features

| Feature | Description | Replaceable? |
|---------|-------------|--------------|
| Hardware Testing | Test switches and buttons | Not needed |
| Calibration | Axis calibration | ❌ No (hardware-level) |
| Firmware Updates | Download/apply firmware | ❌ No (proprietary) |
| MFD Display Config | Monitor viewport setup | ✅ Yes |
| Keybinding Backup | Cloud profile management | ✅ Yes |
| LED Sync | Cockpit light synchronization | ❌ No (runtime) |
| UFC/ICP Display | Dot-matrix rendering | ❌ No (proprietary) |
| Vibration | Haptic feedback | ❌ No (runtime) |

### Runtime Requirements

**SimAppPro must be RUNNING during gameplay for:**

| Feature | Reason |
|---------|--------|
| LED/Backlight Sync | UDP telemetry → hardware commands |
| UFC/ICP Displays | Text rendering to dot-matrix |
| Vibration/Haptics | Flight data → motor control |

**Not needed at runtime for:**

| Feature | Reason |
|---------|--------|
| MFD LCD Screens | Standard Windows monitors |
| Buttons/Switches | Standard HID devices |
| Axes/Controls | Standard HID devices |

### Communication Architecture

```
DCS World
    │
    ▼ (Export.lua)
wwtExport.lua
    │
    ▼ (UDP localhost:16536)
SimAppPro
    │
    ▼ (Proprietary protocol)
WinWing Hardware
```

### Files Modified by SimAppPro

| File | Location | Purpose |
|------|----------|---------|
| `Export.lua` | `{DCS_USER}/Scripts/` | Entry point for WinWing |
| `wwtExport.lua` | `{DCS_USER}/Scripts/wwt/` | Export logic |
| `wwtNetwork.lua` | `{DCS_USER}/Scripts/wwt/` | Network communication |
| `options.lua` | `{DCS_USER}/Config/` | Monitor settings |
| `MonitorSetup/*.lua` | `{DCS_USER}/Config/` | Viewport definitions |

### Known Problems with SimAppPro

| Issue | Impact | RigReady Opportunity |
|-------|--------|---------------------|
| Aggressive overwriting | Destroys user customizations | Manage files cleanly |
| FPS drops | 42 → 6 FPS reported | Validate config before launch |
| Ignores "Close modification" | Settings don't persist | Proper config management |
| Cloud sync issues | Upload failures | Local-first backup |
| Perpetual beta | Stability concerns | Alternative for config tasks |

### Coexistence Strategy

1. **RigReady handles configuration** (MonitorSetup, keybindings, backup)
2. **SimAppPro handles runtime** (LED sync, UFC displays, vibration)
3. **RigReady validates SimAppPro is running** (pre-flight check)
4. **RigReady doesn't overwrite** wwtExport.lua aggressively

### MonitorSetup.lua Format

RigReady can fully manage this format:

```lua
_ = function(p) return p end

name = _('RigReady Generated')
description = 'Created by RigReady'

Viewports = {
    Center = {
        x = 0,
        y = 0,
        width = 3440,
        height = 1440,
        viewDx = 0,
        viewDy = 0,
        aspect = 3440/1440,
    },
}

-- MFD exports
LEFT_MFCD = {
    x = 3440,
    y = 0,
    width = 800,
    height = 800,
}

RIGHT_MFCD = {
    x = 4240,
    y = 0,
    width = 800,
    height = 800,
}

UIMainView = Viewports.Center
```

---

## USB Device Detection

### Windows APIs

#### SetupAPI (Recommended)

```c
#include <setupapi.h>

// Get device information set
HDEVINFO hDevInfo = SetupDiGetClassDevs(
    &GUID_DEVINTERFACE_HID,  // HID devices
    NULL,
    NULL,
    DIGCF_PRESENT | DIGCF_DEVICEINTERFACE
);

// Enumerate devices
SP_DEVICE_INTERFACE_DATA did = {sizeof(SP_DEVICE_INTERFACE_DATA)};
DWORD index = 0;
while (SetupDiEnumDeviceInterfaces(hDevInfo, NULL,
    &GUID_DEVINTERFACE_HID, index++, &did)) {
    // Get device path and details
}
```

#### DirectInput (For Game Controllers)

```c
#include <dinput.h>

IDirectInput8* pDI;
DirectInput8Create(hInstance, DIRECTINPUT_VERSION,
    IID_IDirectInput8, (void**)&pDI, NULL);

// Enumerate devices
pDI->EnumDevices(DI8DEVCLASS_GAMECTRL,
    EnumDevicesCallback, NULL, DIEDFL_ATTACHEDONLY);

// Callback receives:
// - GUID (port-specific!)
// - Device name
// - Product name
```

### Device Identification

| Identifier | Description | Stable Across Ports? |
|------------|-------------|---------------------|
| VID (Vendor ID) | Manufacturer ID | ✅ Yes |
| PID (Product ID) | Product ID | ✅ Yes |
| Serial Number | Unique device serial | ✅ Yes (if present) |
| Instance Path | Windows device path | ❌ No |
| DirectInput GUID | DirectInput identifier | ❌ No |

### Recommended Approach

Use **VID/PID** for device matching in profiles:

```csharp
public class DeviceSpec {
    public string VendorId { get; set; }   // "0x044F"
    public string ProductId { get; set; }  // "0xB10A"
    public string FriendlyName { get; set; }

    public bool Matches(Device device) {
        return VendorId == device.VendorId
            && ProductId == device.ProductId;
    }
}
```

### Getting VID/PID

```csharp
// From device instance path:
// USB\VID_044F&PID_B10A\5&12345678&0&1
// Extract: VID=044F, PID=B10A

Regex vidPidRegex = new Regex(
    @"VID_([0-9A-F]{4})&PID_([0-9A-F]{4})",
    RegexOptions.IgnoreCase);

Match match = vidPidRegex.Match(instancePath);
string vid = match.Groups[1].Value;  // "044F"
string pid = match.Groups[2].Value;  // "B10A"
```

### Device Change Notifications

```c
// Register for device notifications
DEV_BROADCAST_DEVICEINTERFACE filter = {0};
filter.dbcc_size = sizeof(filter);
filter.dbcc_devicetype = DBT_DEVTYP_DEVICEINTERFACE;
filter.dbcc_classguid = GUID_DEVINTERFACE_HID;

HDEVNOTIFY hNotify = RegisterDeviceNotification(
    hWnd, &filter, DEVICE_NOTIFY_WINDOW_HANDLE);

// Handle WM_DEVICECHANGE messages
case WM_DEVICECHANGE:
    switch (wParam) {
        case DBT_DEVICEARRIVAL:
            // Device connected
            break;
        case DBT_DEVICEREMOVECOMPLETE:
            // Device disconnected
            break;
    }
```

---

## Input Handling

### DirectInput for Game Controllers

```csharp
// Create device
IDirectInputDevice8 device;
directInput.CreateDevice(deviceGuid, out device, null);

// Set data format for joystick
device.SetDataFormat(DeviceDataFormat.Joystick);

// Set cooperative level
device.SetCooperativeLevel(hwnd,
    CooperativeLevel.NonExclusive | CooperativeLevel.Background);

// Acquire and poll
device.Acquire();
device.Poll();

// Get state
JoystickState state = device.GetCurrentState();
// state.Buttons[] - button states
// state.X, state.Y, state.Z - axes
// state.PointOfViewControllers[] - hat switches
```

### XInput for Xbox Controllers

```csharp
// XInput is simpler for Xbox controllers
XINPUT_STATE state;
XInputGetState(controllerIndex, &state);

// state.Gamepad.wButtons - button bitmask
// state.Gamepad.sThumbLX/LY - left stick
// state.Gamepad.sThumbRX/RY - right stick
// state.Gamepad.bLeftTrigger/bRightTrigger - triggers
```

### Raw Input for Low-Level Access

```c
// Register for raw input
RAWINPUTDEVICE rid = {0};
rid.usUsagePage = 0x01;  // Generic desktop
rid.usUsage = 0x04;      // Joystick
rid.dwFlags = RIDEV_INPUTSINK;
rid.hwndTarget = hWnd;
RegisterRawInputDevices(&rid, 1, sizeof(rid));

// Handle WM_INPUT messages
case WM_INPUT:
    RAWINPUT raw;
    GetRawInputData((HRAWINPUT)lParam, RID_INPUT,
        &raw, &size, sizeof(RAWINPUTHEADER));
    // Process raw.data.hid
```

### Input Capture Session Design

```csharp
public class InputCaptureSession {
    private IDirectInputDevice8 device;
    private CancellationTokenSource cts;

    public event Action<CapturedInput> OnInput;

    public async Task Start() {
        cts = new CancellationTokenSource();
        device.Acquire();

        while (!cts.IsCancellationRequested) {
            device.Poll();
            var state = device.GetCurrentState();

            // Detect changes and raise events
            DetectAndRaiseInputEvents(state);

            await Task.Delay(10); // 100Hz polling
        }
    }

    public void Stop() {
        cts?.Cancel();
        device?.Unacquire();
    }
}
```

---

## File Format Parsing

### Lua Parsing (DCS)

#### Option 1: NLua (.NET Lua Interpreter)

```csharp
using NLua;

public class DCSBindingParser {
    public BindingSet Parse(string diffLuaPath) {
        using var lua = new Lua();

        // Execute the diff.lua file
        lua.DoFile(diffLuaPath);

        // Get the result table
        LuaTable diff = lua["diff"] as LuaTable;
        LuaTable keyDiffs = diff["keyDiffs"] as LuaTable;

        var bindings = new List<Binding>();
        foreach (var key in keyDiffs.Keys) {
            LuaTable binding = keyDiffs[key] as LuaTable;
            // Parse binding...
        }

        return new BindingSet { Bindings = bindings };
    }
}
```

#### Option 2: Regex/Manual Parsing

```csharp
// For simpler diff.lua files, regex may suffice
var pattern = @"\[""(\w+)""\]\s*=\s*\{([^}]+)\}";
var matches = Regex.Matches(luaContent, pattern);

foreach (Match match in matches) {
    string key = match.Groups[1].Value;
    string value = match.Groups[2].Value;
    // Parse value...
}
```

### YAML Parsing (iRacing)

```csharp
using YamlDotNet.Serialization;

public class JoyCalibParser {
    public JoyCalib Parse(string yamlPath) {
        var deserializer = new DeserializerBuilder().Build();
        var yaml = File.ReadAllText(yamlPath);
        return deserializer.Deserialize<JoyCalib>(yaml);
    }
}

public class JoyCalib {
    public CalibrationInfo CalibrationInfo { get; set; }
}

public class CalibrationInfo {
    public List<DeviceCalib> DeviceList { get; set; }
}

public class DeviceCalib {
    public string DeviceName { get; set; }
    public string InstanceGUID { get; set; }
    public List<AxisCalib> AxisList { get; set; }
}
```

### JSON Parsing (BeamNG, LMU)

```csharp
using System.Text.Json;

public class BeamNGBindingParser {
    public BindingDiff Parse(string diffPath) {
        var json = File.ReadAllText(diffPath);
        return JsonSerializer.Deserialize<BindingDiff>(json);
    }
}

public class BindingDiff {
    public List<BindingEntry> Bindings { get; set; }
    public List<BindingEntry> Removed { get; set; }
}

public class BindingEntry {
    public string Action { get; set; }
    public string Control { get; set; }
    public string FilterType { get; set; }
}
```

### XML Parsing (MSFS)

```csharp
using System.Xml.Linq;

public class MSFSBindingParser {
    public BindingSet Parse(string xmlPath) {
        var doc = XDocument.Load(xmlPath);

        var devices = doc.Descendants("Device");
        foreach (var device in devices) {
            string name = device.Attribute("DeviceName")?.Value;
            string guid = device.Attribute("GUID")?.Value;

            var actions = device.Descendants("Action");
            foreach (var action in actions) {
                string actionName = action.Attribute("ActionName")?.Value;
                // Parse primary/secondary bindings...
            }
        }
    }
}
```

### INI Parsing

```csharp
// Simple INI parser for app.ini, etc.
public class IniParser {
    private Dictionary<string, Dictionary<string, string>> sections;

    public void Parse(string iniPath) {
        sections = new Dictionary<string, Dictionary<string, string>>();
        string currentSection = "";

        foreach (var line in File.ReadLines(iniPath)) {
            var trimmed = line.Trim();
            if (trimmed.StartsWith("[") && trimmed.EndsWith("]")) {
                currentSection = trimmed.Substring(1, trimmed.Length - 2);
                sections[currentSection] = new Dictionary<string, string>();
            }
            else if (trimmed.Contains("=")) {
                var parts = trimmed.Split('=', 2);
                sections[currentSection][parts[0].Trim()] = parts[1].Trim();
            }
        }
    }

    public string Get(string section, string key) {
        return sections[section][key];
    }
}
```

---

## Recommendations

### Technology Stack Suggestions

| Component | Recommended | Alternative |
|-----------|-------------|-------------|
| Language | C# (.NET 6+) | Python, Rust |
| UI Framework | WPF, Avalonia | WinForms, MAUI |
| Lua Parsing | NLua | MoonSharp |
| YAML Parsing | YamlDotNet | - |
| JSON Parsing | System.Text.Json | Newtonsoft.Json |
| DirectInput | SharpDX, Vortice | Raw P/Invoke |
| Display Config | P/Invoke | WindowsDisplayAPI NuGet |

### Performance Considerations

1. **Device polling**: 100Hz is sufficient for input testing
2. **Check execution**: Run checks in parallel where possible
3. **File watching**: Use FileSystemWatcher for live profile reload
4. **Display changes**: Allow 1-3 seconds for changes to apply

### Security Considerations

1. **No admin required** for normal operation
2. **Scripts not included** in shared configs
3. **Path validation** before file operations
4. **Backup before modify** for all file changes

---

*Document Version: 1.0*
