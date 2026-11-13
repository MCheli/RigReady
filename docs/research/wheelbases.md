# Wheelbases of every major brand

Researched 2026-11-11

## How to read this document

Each fact is marked **confirmed** with its source, or **unconfirmed**. "Confirmed" means a public source states it. It does not mean the fact was checked on real hardware. Nothing here was measured on this PC. Where two sources disagree, both are given.

USB ids are written `VVVV:PPPP` in hex. Linux kernel ids come from the mainline `drivers/hid/hid-ids.h` ([source](https://raw.githubusercontent.com/torvalds/linux/master/drivers/hid/hid-ids.h)), which is the strongest public source because each id was added by someone holding the device. The community table at [JacKeTUs/linux-steering-wheels](https://github.com/JacKeTUs/linux-steering-wheels) ([raw](https://raw.githubusercontent.com/JacKeTUs/linux-steering-wheels/main/README.md)) is the second source and is cited below as "LSW".

Market share, from the project's own market notes (2026 survey figures; the notes are not in this repository): Moza 24.1%, Fanatec 21.7%, Logitech 17.9%, Simagic 17.2%, Thrustmaster 5.8%. Simucube, Asetek and Cammus are not reported in that write-up, so their share is unknown.

Fanatec is covered in [racing.md, section 5](racing.md#5-fanatec) and is not repeated here.

Recommended in-game settings are listed only where the wheel vendor itself publishes them. Third-party guides (Coach Dave Academy, simracingsetup.com and others) exist for every brand but are left out on purpose.

## Moza (Pit House)

Market share 24.1%, the largest brand.

### USB ids

Vendor id `346E`, confirmed (kernel hid-ids.h, [universal-pidff hid-ids.h](https://raw.githubusercontent.com/JacKeTUs/universal-pidff/main/hid-ids.h)).

| Model | Product id | Second product id | Status |
|---|---|---|---|
| R3 | `0005` | `0015` | confirmed (kernel) |
| R5 | `0004` | `0014` | confirmed (kernel) |
| R9 | `0002` | `0012` | confirmed (kernel) |
| R12 | `0006` | `0016` | confirmed (kernel) |
| R16 and R21 (shared) | `0000` | `0010` | confirmed (kernel) |

Every base has a second id, named `_2` in the kernel. The kernel patch does not say why ([patch thread](https://lists.linaro.org/archives/list/linux-stable-mirror@lists.linaro.org/message/7F7CXDMFA6ZFMRW4GDIGKPAM7UVWYHO6)). Whether `_2` marks a firmware generation, a compatibility mode or a hardware revision is **unconfirmed**. RigReady should treat both ids as the same model. R16 and R21 cannot be told apart by USB id (confirmed, they share one define).

Newer Moza bases (R25 Ultra and others) are not in the kernel list; their ids are **unconfirmed**.

### Devices Windows sees

- The base is a HID PID force feedback device (confirmed, it is driven by the generic `hid-universal-pidff`, [universal-pidff](https://github.com/JacKeTUs/universal-pidff)).
- The base also exposes a serial (CDC ACM) interface, which is how Pit House and the Linux tool Boxflat change settings (confirmed, [boxflat README](https://github.com/Lawstorant/boxflat): "check `/dev/ttyACM*`", udev rule on vendor `346e`). RigReady will therefore see a COM port with vendor `346E` beside the game controller.
- CRP, CRP2 and SR-P pedals connect either to the base (RJ cable) or straight to the PC by USB (confirmed, [Moza product compatibility](https://support.mozaracing.com/en/support/solutions/articles/70000645133-moza-racing-products-compatibility), [CRP2 support](https://support.mozaracing.com/en/support/solutions/articles/70000668979-moza-crp2-pedals-support)). Through the base, the pedal axes are reported by the base device (unconfirmed, implied by the RJ path). Through USB, the pedals are their own game controller; their product id is **unconfirmed**.
- Plugging pedals in both ways at once is a known fault (third-party, [simracingcockpit troubleshooting](https://simracingcockpit.gg/moza-troubleshooting/)). A RigReady check could flag two Moza pedal sources.
- Rim buttons on Moza rims are reported through the base (unconfirmed). Third-party rims need their own USB (confirmed, [Moza wheel base FAQ](https://support.mozaracing.com/support/solutions/articles/70000627811-wheel-base-faqs)).

### DirectInput axes

Not published by Moza. **Unconfirmed.**

### Software

- Product: MOZA Pit House.
- Default install folder: `C:\Program Files (x86)\MOZA Pit House` (confirmed, [Moza Pit House user manual](https://support.mozaracing.com/en/support/solutions/articles/70000625635-moza-pit-house-user-manual)).
- Process image: `MOZA Pit House.exe` (confirmed by a third-party install database only, [advanceduninstaller](https://www.advanceduninstaller.com/MOZA-Pit-House-4dae50d78451836324a7eec22e14f9d5-application.htm); treat as likely). A `MaintenanceTool.exe` updater sits in the same folder (same source).
- Uninstall DisplayName: "MOZA Pit House" (same third-party source, likely).
- Windows service: none found. **Unconfirmed.**
- Game integration files live in `<install>\bin\GameConfigs\<game>\` (confirmed, [Moza Farming Simulator article](https://support.mozaracing.com/en/support/solutions/articles/70000677022-farming-simulator)).

### Is the software needed?

- Settings are written to the base over the serial link, so Boxflat can configure a base with no Pit House present (confirmed, Boxflat exists and works that way). That the base keeps settings after power-off is **unconfirmed** but implied.
- Force feedback from the game does not need Pit House (confirmed indirectly: it works on Linux through `hid-universal-pidff` with no Moza software).
- Pit House must be open for telemetry features (shift lights, rim displays) in iRacing; a Moza blog says it picks up iRacing telemetry when open ([Moza iRacing blog](https://mozaracing.com/blogs/blog/moza-ffb-settings-for-iracing-r5-r9-r12-r16-and-r21)).

### Profiles on disk

Location **unconfirmed**. A Moza forum post reports presets resetting after a Windows reinstall ([support forum](https://support.mozaracing.com/support/discussions/topics/70000509478)), which suggests presets are local files, not on the base. RigReady should find the folder on the rig before promising a backup.

### Compatibility and console modes

Moza bases do not support PS4 or PS5. Xbox needs an Xbox-licensed rim or bundle (confirmed, [wheel base FAQ](https://support.mozaracing.com/support/solutions/articles/70000627811-wheel-base-faqs)). No USB-id mode switch is documented. Pit House's "Forza compatibility" option is a game setting, not a USB mode (unconfirmed).

### Vendor-published game settings

- iRacing: Moza blog "MOZA FFB settings for iRacing R5, R9, R12, R16 and R21" ([mozaracing.com](https://mozaracing.com/blogs/blog/moza-ffb-settings-for-iracing-r5-r9-r12-r16-and-r21)). It says to set the Pit House steering angle to match iRacing's wheel range, and gives iRacing "Wheel Force (Nm)" equal to the base torque (R9 9, R12 12, R16 16) with game FFB intensity and torque limit at 100%. Also an R9 guide ([Moza R9 iRacing](https://mozaracing.com/blogs/blog/moza-r9-force-feedback-setup-guide-for-iracing)).
- Le Mans Ultimate, BeamNG, Assetto Corsa: no Moza page found. Pit House ships per-game presets (unconfirmed list).

## Logitech (G HUB)

Market share 17.9%. The G29 and G920 are by far the best-selling wheels on Amazon US (market research).

### USB ids

Vendor id `046D`, confirmed (kernel).

| Model | Mode or edition | Product id | Status |
|---|---|---|---|
| G29 | PS3 switch position | `C24F` | confirmed id (kernel `G29_WHEEL`); the PS3 label is from SDL's controller list ([SDL commit](https://skia.googlesource.com/third_party/sdl/+/44703d54ac44d2b0d822512c153229b214d12180%5E%21/)) |
| G29 | PS4 switch position (Logitech's advised PC position) | `C260` | confirmed (SDL list, and the Logitech driver INF as listed on [drivermax](https://www.drivermax.com/Logitech-G29-Driving-Force-Racing-Wheel-PS4-Logitech-G-series-USB-VID-046D-PID-C260-2023_7_1_0-2023-07-03-4682665-driver.htm)) |
| G29 | after a G27 emulation switch | `C29B` | confirmed by one user report ([Steam LinuxFF thread](https://steamcommunity.com/groups/linuxff/discussions/0/1692669912381672495)) |
| G920 | Xbox and PC | `C262` | confirmed (kernel) |
| G923 | PlayStation and PC | `C266` and `C267` | confirmed ([new-lg4ff](https://github.com/berarma/new-lg4ff)); LSW lists `C267` |
| G923 | Xbox and PC | `C26D` and `C26E` | confirmed (new-lg4ff; kernel has `C26E` as `G923_XBOX_WHEEL`) |
| PRO Racing Wheel | Xbox and PC | `C272` | confirmed (LSW, [mescon RS50 driver](https://github.com/mescon/logitech-rs50-linux-driver), Logitech INF on [drivermax](https://www.drivermax.com/Logitech-G-HUB-PRO-Racing-Wheel-for-Xbox-and-PC-USB-Logitech-USB-VID-046D-PID-C272-MI-00-2022_3_0_2-2022-09-02-4524409-driver.htm)) |
| PRO Racing Wheel | PlayStation and PC | `C268` | confirmed by one source (mescon RS50 driver) |
| RS50 | compatibility mode | `C272` (same as PRO) | confirmed by one source (mescon RS50 driver) |
| Older: Driving Force `C294`, MOMO `C295`, DFP `C298`, G25 `C299`, DFGT `C29A`, G27 `C29B` | | | confirmed (kernel) |

Which of the two G923 ids in each pair is the "real" mode and which is a compatibility or bootloader id is **unconfirmed**. Note `C294` is also the id every Logitech wheel shows in legacy "Driving Force" compatibility mode on Linux (kernel name `LOGITECH_WHEEL`); on Windows that state is **unconfirmed**.

### Devices Windows sees

One game controller. Logitech pedals plug into the wheel and appear as axes of the wheel device; the shifter (Driving Force Shifter) also plugs into the wheel (confirmed for the pedal axes by the kernel driver, which reports them on the wheel, and by the combined-pedals option below). The PRO Racing Wheel's PRO pedals can connect by their own USB (unconfirmed).

### DirectInput axes

- Steering on X (unconfirmed for Windows, conventional).
- With "combined pedals" on, accelerator and brake are one axis on Y (confirmed for the Linux driver, [lg4ff sysfs ABI](https://gbmc.googlesource.com/linux/+/4aa2e7393e140f434c469bffe478e11cb9c55ed8/Documentation/ABI/testing/sysfs-driver-hid-logitech-lg4ff)). The same option exists in G HUB on Windows (unconfirmed exact axis).
- Separate accelerator, brake and clutch axis assignments on Windows: **unconfirmed**. Check `joy.cpl` on a real wheel before relying on them.

### Software

- Product: Logitech G HUB.
- Install folder: `C:\Program Files\LGHUB` (confirmed, [file.net lghub_updater.exe](https://www.file.net/process/lghub_updater.exe.html)).
- Processes: `lghub.exe` (UI), `lghub_agent.exe` (the agent that applies settings), `lghub_updater.exe` (confirmed, [file.net lghub_agent.exe](https://www.file.net/process/lghub_agent.exe.html), [Logitech service restart guide](https://support.logi.com/hc/ko/articles/35644288645655-G-HUB-Service-restart-guide)). Newer builds may add more helper processes (unconfirmed).
- Windows service: `LGHUBUpdaterService` (confirmed, Logitech's restart guide tells users to restart it).
- Uninstall DisplayName: "Logitech G HUB" (confirmed by third-party install database, [advanceduninstaller](https://www.advanceduninstaller.com/Logitech-G-HUB-82598879dcea63000aeaec6fc8b89f3d-application.htm)).
- The old Logitech Gaming Software (LGS) still appears on some rigs; its names are not researched here.

### Is the software needed?

Force feedback works without G HUB (confirmed indirectly: the wheels work on Linux with only the kernel driver). Rotation range, sensitivity, centering spring and profile switching are applied by G HUB's agent while it runs (confirmed in part: Logitech's own article warns that settings are lost on sleep or reboot if `settings.db` is not writable, [Logitech](https://support.logi.com/hc/en-us/articles/1500005396981)). Whether a G29 keeps its range with G HUB closed is **unconfirmed**.

### Profiles on disk

- `%LOCALAPPDATA%\LGHUB\settings.db` and `settings.backup` (confirmed, [Logitech](https://support.logi.com/hc/en-us/articles/1500005396981)).
- `settings.db` is a SQLite file and is locked while G HUB runs (lock confirmed by user reports, [elevenforum](https://www.elevenforum.com/t/where-are-profiles-stored-from-logitech-g-hub-2025.8.41569/latest); SQLite format unconfirmed here).
- Some users also find an `%APPDATA%\LGHUB` folder in recent versions (same elevenforum thread). A safe backup copies both folders with G HUB closed.

### Compatibility and console modes

- G29: the PS3/PS4 slide switch changes the product id (`C24F` and `C260`), so the mode is detectable from USB. Logitech tells PC users to use the PS4 position ([Logitech support](https://support.logi.com/hc/articles/360023181054)).
- G923 and PRO: the PS and Xbox editions are different products with different ids, so the edition is detectable.

### Vendor-published game settings

None found from Logitech for iRacing, Le Mans Ultimate, BeamNG or Assetto Corsa. G HUB ships game profiles (unconfirmed list).

## Simagic (SimPro Manager)

Market share 17.2%.

### USB ids

| Model | Vendor:product | Status |
|---|---|---|
| M10, Alpha Mini, Alpha, Alpha Ultimate (older firmware) | `0483:0522` | confirmed (LSW). All four share one id, so the model cannot be read from USB |
| EVO Sport | `3670:0500` | confirmed (LSW) |
| EVO | `3670:0501` | confirmed (LSW) |
| EVO Pro | `3670:0502` | confirmed (LSW) |
| Any base in "Compatibility mode" | `1234:BEAD` (the vJoy default id) | confirmed ([simagic-ff README](https://github.com/JacKeTUs/simagic-ff)) |

`0483` is STMicroelectronics' generic vendor id, also used by VRS and many other devices (kernel uses `0483` for VRS). Seeing `0483:0522` alone does not prove a Simagic base. The simagic-ff udev rules use `3670` for "GT Neo, Evo wheelbases" and `0483` for "older wheelbases" (confirmed). Whether Alpha-family bases move to a `3670` id on the newest firmware (v159 and later, SimPro v2) is **unconfirmed**.

### Devices Windows sees

- Rims and devices connected through the base are reported as part of the base (confirmed, simagic-ff README).
- P1000 pedals have a CAN-Bus/USB switch: in USB mode they are their own USB device to the PC, in CAN mode they go through the base (confirmed, [P1000 manual](https://image.simagic.com/profile/upload/2024/07/18/SIMAGIC_P1000_UM.pdf), [P1000 page](https://simagic.com/pages/details-p1000)). P2000 pedals connect by USB (retailer listings only). Pedal product ids **unconfirmed**.
- The Alpha QR passthrough is a separate plain USB connection (confirmed, simagic-ff README).

### DirectInput axes

Not published. **Unconfirmed.**

### Software

- Product: SimPro Manager. Version 3.x drives EVO bases; 2.x drives Alpha, Alpha Mini and Alpha U (third-party, [simracingcockpit](https://simracingcockpit.gg/simagic-troubleshooting/)).
- SimPro 2.x install folder `C:\Program Files\simpro2`, main exe `simpro2.exe`, uninstaller `Uninstall simpro2.exe`, plus `SIMAGIC-Driver.exe` (third-party install database, [advanceduninstaller 2.0.345](https://www.advanceduninstaller.com/SimPro-Manager-2_0_345-9c6763a212da7abfdd668cfae22ea355-application.htm); likely). Publisher "Shenzhen SIMAGIC Technology Co., Ltd." (same source).
- Uninstall DisplayName pattern: "SimPro Manager 2.0.NNN" (same source; version in the name).
- SimPro Manager 3.x exe name and path: **unconfirmed**.
- Windows service: **unconfirmed**.

### Is the software needed?

Settings can be saved to the base's internal memory and persist after power-off (confirmed for the original Alpha, [Alpha manual](https://www.manualslib.com/manual/2201604/Simagic-Alpha.html?page=22); older Alpha Manager docs describe a "WriteStorage" command, [simagic.github.io](https://simagic.github.io/base/alpha_manager)). Force feedback works without SimPro (confirmed indirectly: simagic-ff drives it on Linux). Whether EVO bases behave the same is **unconfirmed**.

### Profiles on disk

SimPro Manager has "Cloud Saves and Local Saves" for FFB settings ([Simagic user guide](https://simagic.com/blogs/announcement/simagic-latest-driver-simpro-manager-user-guide)). The local folder is **unconfirmed**. The Alpha manual mentions saving settings to an `.ini` file per game (confirmed, Alpha manual), so plain files existed at least in the old software.

### Compatibility and console modes

Normal mode versus Compatibility mode. Compatibility mode presents the vJoy id `1234:BEAD` (confirmed, simagic-ff), so RigReady can detect it from USB and tell the user why games see a "vJoy" device. Simagic bases are PC-only (unconfirmed for every model).

### Vendor-published game settings

None found on simagic.com for iRacing, Le Mans Ultimate, BeamNG or Assetto Corsa. SimPro ships game presets (confirmed in general, user guide; list unconfirmed).

## Thrustmaster (drivers and Control Panel)

Market share 5.8%, down from 26.6% in 2022.

### USB ids

Vendor id `044F`, confirmed (kernel).

| Model | Mode | Product id | Status |
|---|---|---|---|
| Any belt wheel before initialisation | generic "Thrustmaster FFB Wheel" | `B65D` | confirmed (kernel `hid-thrustmaster.c` header comment and id table, [source](https://raw.githubusercontent.com/torvalds/linux/master/drivers/hid/hid-thrustmaster.c)) |
| T300 RS | PS3 mode, normal | `B66E` | confirmed ([hid-tmff2 header](https://raw.githubusercontent.com/Kimplul/hid-tmff2/master/src/hid-tmff2.h), LSW) |
| T300 RS | PS3 mode, advanced (F1 rim) | `B66F` | confirmed (hid-tmff2, LSW) |
| T300 RS | PS4 mode | `B66D` | confirmed (hid-tmff2, LSW) |
| T-GT II | reuses the T300 id | (a T300 id) | confirmed ([hid-tmff2 README](https://github.com/Kimplul/hid-tmff2): "might show up as a T300") |
| T248 | PC mode | `B696` | confirmed (hid-tmff2, LSW) |
| TX | active | `B669` | confirmed (hid-tmff2, LSW) |
| TS-XW | active | `B692` | confirmed (hid-tmff2) |
| TS-PC Racer | | `B689` | confirmed (hid-tmff2) |
| T150 | after initialisation | `B677` | confirmed ([devicehunt](https://devicehunt.com/view/type/usb/vendor/044F), and the kernel commit "a T150 will re-appear as 044f:b677 and a T300 as 044f:b66e", [commit](https://git.evolution-x.org/anierin/msm-5.15/commit/c49c33637802)) |
| TMX | | `B67F` (LSW); `B67E` "TMX GIP Racing Wheel" (user lsusb report); `B67D` (driver database) | conflicting, **unconfirmed** which is the PC mode |
| T818 | | | **unconfirmed**; one forum user says it shares the T128/T248 id ([EA forum](https://forums.ea.com/discussions/wrc-technical-issues-en/thrustmaster-direct-drive-wheel-support/8396004)) |
| T248X (Xbox), T128 | | | **unconfirmed** |

The `B65D` to model-id switch is the important RigReady check. A belt wheel plugs in as `044F:B65D`; the Thrustmaster driver (or on Linux `hid-thrustmaster`) sends a model-specific USB control request and the wheel re-enumerates with its real id (confirmed, kernel source). A wheel still on `B65D` after the driver is installed means the driver did not switch it, which is the common "my wheel shows as Thrustmaster FFB Wheel" fault (user reports, [Overtake](https://www.overtake.gg/threads/t500-appears-as-thrustmaster-ffb-wheel-instead-thrustmaster-t500-rs-racing-wheel.164293/); Thrustmaster has a support article on it, [support.thrustmaster.com](https://support.thrustmaster.com/?p=13461), which could not be fetched).

The kernel's wheel table maps the reported model code to a name: T150RS, T300RS (missing attachment, standard, Open Wheel, Sparco R383, Ferrari Alcantara), T500RS (confirmed, kernel source). This means the rim attached to a T300 is readable on initialisation, at least on Linux.

### Devices Windows sees

One game controller for the base. T3PA/T3PM pedals on the T300, T150 and T248 plug into the base (RJ12) and appear as axes of the wheel (unconfirmed for each model). T-LCM pedals and the T818's pedals can use their own USB (unconfirmed).

### DirectInput axes

Not published. **Unconfirmed.**

### Software

- Driver package "Thrustmaster FFB Racing wheel" / "FFB Racing Wheel drivers", install folder `C:\Program Files\Thrustmaster\FFB Racing wheel` (older: `C:\Program Files (x86)\Thrustmaster\FFB Wheel`), driver file `tmHidUsb.sys`, installer `tmInstall.exe`, registry key `HKLM\Software\Thrustmaster\Thrustmaster FFB Racing Wheel` (third-party install database, [advanceduninstaller](https://advanceduninstaller.com/Thrustmaster-FFB-Racing-Wheel-55534198cce12761bfeb573326a5603d-application.htm), [another listing](https://advanceduninstaller.com/FFB-Racing-Wheel-drivers-6fb2afcedd215b4ff44b7099a86a7a3a-application.htm); likely).
- Uninstall DisplayName patterns: "Thrustmaster FFB Racing Wheel", "FFB Racing Wheel drivers", "Thrustmaster FFB Wheel driver" (same source, varies by version).
- Settings UI: the "Thrustmaster Control Panel" is a page in Windows' Game Controllers (`joy.cpl`) properties, not a separate process (unconfirmed). Newer wheels (T818, T598) use the "My Thrustmaster Panel" app ([T818 support](https://support.thrustmaster.com/en/product/t818-en/)); its exe name is **unconfirmed**.
- Windows service: **unconfirmed**.
- Install rule from Thrustmaster: do not plug the wheel in before the installer asks (confirmed in Thrustmaster installer notes as quoted by search results; useful as a RigReady fix step).

### Is the software needed?

The driver is needed on Windows to switch the wheel out of `B65D` and enable force feedback (confirmed for Linux by the kernel comment that FFB is unavailable in generic mode; on Windows by the user reports above). Settings set in the Control Panel (rotation, gain) are applied by the driver (unconfirmed whether stored on the base).

### Profiles on disk

No profile files documented for the classic driver. **Unconfirmed.** Settings may live in the registry under the key above (unconfirmed).

### Compatibility and console modes

T300: PS3 normal, PS3 advanced and PS4 modes have different ids (confirmed), so the mode is detectable. TX and TS-XW are Xbox models with their own ids.

### Vendor-published game settings

None found from Thrustmaster for the four sims.

## Simucube (Simucube Tuner, formerly True Drive)

Market share unknown (not in the survey write-up).

### USB ids

Vendor id `16D0` (a shared vendor id sold in small blocks by MCS Electronics, so the product id must be checked too; vendor note unconfirmed).

| Model | Product id | Status |
|---|---|---|
| Simucube 1 | `0D5A` | confirmed (LSW) |
| Simucube 2 Sport | `0D61` | confirmed (LSW) |
| Simucube 2 Pro | `0D60` | confirmed (LSW) |
| Simucube 2 Ultimate | `0D5F` | confirmed (LSW) |
| Simucube 3 | | **unconfirmed** |

Not in the mainline kernel id list (they use the generic `hid-pidff`).

### Devices Windows sees

The base is one HID PID game controller (confirmed, works with `hid-pidff`). Simucube wireless wheels report through the base (unconfirmed). ActivePedal and SC-Link devices have their own USB connection (unconfirmed ids).

### DirectInput axes

Not published. **Unconfirmed.**

### Software

- Simucube Tuner (current), and Simucube 2 True Drive (legacy, development ended, still available). True Drive will not start while Tuner runs with Simucube 2 support on (confirmed, [Simucube Tuner 2.5](https://simucube.com/SIMUCUBE-TUNER-2-5/), [Granite Devices forum](https://community.granitedevices.com/t/simucube-tuner-and-simucube-2-questions-and-feedback/12289)).
- True Drive install folder: `C:\Program Files\Simucube 2 True Drive` (confirmed by a user, [Granite Devices forum](https://community.granitedevices.com/t/where-is-the-truedrive-profiles-saved/5018)).
- Exe names, Tuner install folder, service and uninstall DisplayName: **unconfirmed**.
- True Drive Paddock (cloud profiles) is to be discontinued in 2026 ([Simucube Tuner 3.1](https://simucube.com/?p=56056)).

### Is the software needed?

The base stores only a default profile; the active profile is pushed by Tuner, which applies the last used profile when it sees the device (confirmed, Granite Devices forum, 2023 post; an older 2020 post said profiles were in servo flash, superseded). So without Tuner running, the base runs its default profile. Game force feedback itself does not need Tuner (confirmed indirectly, works on Linux).

### Profiles on disk

- `%USERPROFILE%\Documents\Simucube 2\cachedprofiles` holds offline profiles and those used from Paddock (confirmed, Granite Devices forum and Tuner docs as quoted in search).
- Older True Drive kept a backup `simucubeprofiles.ini` in its folder (confirmed, same forum, 2020).
- Tuner can export a profile to a file of the user's choice ([Tuner docs](https://docs.simucube.com/TunerSoftware/userinterface/profiles.html)). File format **unconfirmed**. Plain files, so copyable.

### Compatibility and console modes

PC-only. No USB-id modes.

### Vendor-published game settings

None found on simucube.com for the four sims. Tuner ships Simucube presets (confirmed in general, Tuner docs).

## Asetek SimSports (RaceHub)

Market share unknown.

### USB ids

Vendor id `2433`, confirmed (kernel).

| Model | Product id | Status |
|---|---|---|
| Invicta | `F300` | confirmed (kernel) |
| Forte | `F301` | confirmed (kernel) |
| La Prima | `F303` | confirmed (kernel) |
| Tony Kanaan Edition | `F306` | confirmed (kernel) |
| DD10 and newer | | **unconfirmed** |

### Devices Windows sees

The base is a HID PID device (confirmed, `hid-universal-pidff`). Asetek pedals are separate USB devices calibrated in RaceHub (unconfirmed ids). Asetek bases need "high torque mode" turned on after power-on (confirmed, LSW).

### Software

- RaceHub, current 4.5.x ([Asetek RaceHub](https://www.asetek.com/simsports/racehub/)). It runs a background "RaceHub Service" (confirmed, [RaceHub 4.0 release note](https://asetek.com/simsports/wp-content/uploads/2024/12/Release-Note-for-RaceHub-version-4.0-1.pdf)).
- Exe name, service name, install path and uninstall DisplayName: **unconfirmed**.

### Is the software needed?

Settings are written to the base with "Save to wheelbase" (confirmed, Asetek's LMU guide, [asetek.com](https://asetek.com/simsports/guides/le-mans-ultimate-early-access-recommended-settings)). That suggests the base keeps them with RaceHub closed (unconfirmed).

### Profiles on disk

Presets can be imported and exported as files in RaceHub (confirmed, the LMU guide has users import a downloaded preset file). Local folder **unconfirmed**.

### Vendor-published game settings

Asetek publishes per-game guides (official):
- Le Mans Ultimate: [early access settings](https://asetek.com/simsports/guides/le-mans-ultimate-early-access-recommended-settings), [LMU 1.3 settings](https://www.asetek.com/simsports/guides/le-mans-ultimate-1-3-settings/), including downloadable RaceHub presets.
- iRacing: [RaceHub and game setup](https://www.asetek.com/blogs/wheelbase-settings-for-iracing/).
- BeamNG.drive: [wheelbase settings for BeamNG](https://www.asetek.com/simsports/guides/wheelbase-settings-for-beamng-drive/) (updated for RaceHub 4.0).
- Assetto Corsa EVO: [settings](https://www.asetek.com/simsports/guides/assetto-corsa-evo-wheelbase-settings/) (damping, friction and similar at 0%). Original Assetto Corsa: only on a sandbox mirror, not used here.

The Asetek pages returned HTTP 403 to automated fetches, so the values were not read in full; RigReady should link to the pages rather than copy numbers.

## Cammus

Market share unknown.

### USB ids

Vendor id `3416`, confirmed (kernel).

| Model | Product id | Status |
|---|---|---|
| C5 | `0301` | confirmed (kernel) |
| C12 | `0302` | confirmed (kernel) |

### Devices, software, profiles

- The base is a HID PID device (confirmed, `hid-universal-pidff`).
- The Windows software is described only as "CAMMUS PC software", with a separate phone app ([C5 manual](https://www.manualslib.com/manual/3614194/Cammus-C5.html)). Product name, exe, service, install path, profile location and whether settings live on the base: **unconfirmed**.
- No vendor-published game settings found.

## Summary

| Brand | Vendor id | Product ids (model, mode) | Software process | Profile files | Mode detection from USB |
|---|---|---|---|---|---|
| Moza | `346E` | R3 `0005`/`0015`, R5 `0004`/`0014`, R9 `0002`/`0012`, R12 `0006`/`0016`, R16 and R21 `0000`/`0010` | `MOZA Pit House.exe` (likely) in `C:\Program Files (x86)\MOZA Pit House` | unconfirmed | none; second id meaning unconfirmed; also a `346E` COM port |
| Fanatec | see [racing.md](racing.md#5-fanatec) | | | | |
| Logitech | `046D` | G29 `C24F` (PS3 switch), `C260` (PS4 switch); G920 `C262`; G923 PS `C266`/`C267`, Xbox `C26D`/`C26E`; PRO Xbox `C272`, PRO PS `C268` | `lghub.exe`, `lghub_agent.exe`, `lghub_updater.exe`; service `LGHUBUpdaterService` | `%LOCALAPPDATA%\LGHUB\settings.db` (+ `settings.backup`; maybe `%APPDATA%\LGHUB`) | G29 switch position; G923 and PRO edition |
| Simagic | `0483` (legacy) / `3670` | legacy Alpha family and M10 `0483:0522`; EVO Sport `3670:0500`, EVO `0501`, EVO Pro `0502` | `simpro2.exe` (SimPro 2.x, likely); 3.x unconfirmed | Local and cloud saves, folder unconfirmed | Compatibility mode shows `1234:BEAD` |
| Thrustmaster | `044F` | generic `B65D`; T300 PS3 `B66E`, PS3 advanced `B66F`, PS4 `B66D`; T-GT II as T300; T248 `B696`; TX `B669`; TS-XW `B692`; TS-PC `B689`; T150 `B677`; TMX `B67F` (conflicting); T818 unconfirmed | driver package, `joy.cpl` panel; "My Thrustmaster Panel" for T818 | none documented | `B65D` = driver has not switched it; T300 modes by id |
| Simucube | `16D0` | SC1 `0D5A`, SC2 Sport `0D61`, Pro `0D60`, Ultimate `0D5F` | Simucube Tuner (exe unconfirmed); legacy True Drive | `Documents\Simucube 2\cachedprofiles`, exported files | none |
| Asetek | `2433` | Invicta `F300`, Forte `F301`, La Prima `F303`, Tony Kanaan `F306` | RaceHub plus RaceHub Service (names unconfirmed) | importable preset files, folder unconfirmed | none |
| Cammus | `3416` | C5 `0301`, C12 `0302` | unconfirmed | unconfirmed | none |

## Open questions to settle on a real rig

1. Moza: what the `_2` product ids mean, the Pit House preset folder, and the pedal product id over direct USB.
2. Logitech: the Windows DirectInput axis for each pedal with combined pedals on and off.
3. Simagic: whether Alpha-family bases on current firmware still report `0483:0522`; SimPro 3.x exe and profile folder.
4. Thrustmaster: TMX and T818 ids; the "My Thrustmaster Panel" exe; whether any service is installed.
5. Simucube, Asetek, Cammus: exe names, service names and uninstall DisplayNames (read from the registry `Uninstall` keys on a machine that has them).
