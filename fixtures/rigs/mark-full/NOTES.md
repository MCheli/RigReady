# mark-full: notes

Recorded 2026-10-03 from the owner's rig with everything connected (flight gear and the Fanatec DD2; the TV is not connected). Re-record with `npm run rig:record -- mark-full`; this file is not overwritten.

## What state was recorded

The **desk** state, which is the wrong one for flying: Dell G3223D primary at 0,0 (2560x1440), ultrawide LC49G95T at 2560,0 (5120x1440), the three MFD screens ("USB_Monitor", EDID REG0319) in landscape 1024x768 at 7680 / 8704 / 9728, all with raw rotation 1 (identity). Scenario `desk-mfds-wrong` is this state unchanged.

The known-good flying layout (ultrawide primary at 0,0; MFDs portrait 768x1024 at x=5120, 5888, 6656; Dell off) is produced by mutation in `fixtures/scenarios/flying-fresh.yaml`.

## MFD screen orientation: still unconfirmed

Whether portrait on these panels is rotation **90 or 270** could not be determined from the machine:

- Asking Windows for its stored configuration for "everything except the Dell" (`SetDisplayConfig` with `SDC_TOPOLOGY_SUPPLIED`) failed with error 31 for every variant tried, including the full current set, so the display database could not be read this way. Nothing was changed by those attempts.
- The scenarios assume **90**. Someone has to look at the panels once (apply 90, check the taskbar is at the physical bottom) and correct `flying-fresh.yaml` and `profiles/dcs-f-a-18c.yaml` if it is 270.

## Facts learned from the real apply test (layout restored exactly afterwards)

- The MFD screens only offer one mode, 1024x768 (EDID and `WmiMonitorListedSupportedSourceModes`). Portrait is therefore a rotation, not a different resolution.
- In the Windows display configuration API the source mode keeps the unrotated size (1024x768) when rotation is 90/270; the desktop sees the turned size (768x1024). `DisplayInfo.width/height` are the desktop size. `rawRotation` is the untouched `DISPLAYCONFIG_ROTATION` value (1=0°, 2=90°, 3=180°, 4=270°).
- The three MFD screens have the same EDID name and serial; they differ only in the instance part of their device path (`...reg0319#a&2c1ac5a9...`, `...a&270816bc...`, `...a&2f291759...`), which is what `DisplayInfo.id` holds. Which id is the left, centre or right panel is not known from the recording.
- Disabling the primary, moving, rotating and re-enabling all worked through `SetDisplayConfig` on this rig, including the USB (indirect display) MFD screens.

## DirectInput

The pygame sidecar listed 10 game controllers; Windows classes 12 USB devices as game controllers. Missing from the sidecar's list: T-Pendular-Rudder (TPR pedals) and WINWING F18 TAKEOFF PANEL 2. Not investigated.

## Privacy

Paths have the Windows user name replaced with `User`. The recording still contains real device serial numbers and the full list of running programs.
