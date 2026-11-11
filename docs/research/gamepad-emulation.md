# Gamepad emulation: a virtual controller for gamepad-only games

Research for the Virtual controller feature (`src/features/virtual-controller`), November 2026. The trigger was ACE COMBAT 8, which reads a gamepad and two licensed sticks; the same need comes up with emulators (PCSX2, DuckStation, Dolphin, RetroArch) and with older driving and flight games that read only XInput. Sources are listed at the end; claims from forums and guides are marked as such.

## Verdict

- **Driver: ViGEmBus 1.22.0** (Nefarius Software Solutions). It is the driver nearly every community tool uses for a virtual Xbox 360 controller or DualShock 4 (DS4Windows, x360ce 4.x, XOutput, JoyShockMapper, Steam's own competitors, vgamepad). The project was **retired on 2 November 2023** after a trademark agreement with ViGEM GmbH; the repository is archived and read-only, gets no updates, but its releases stay downloadable and the production-signed driver installs and runs on Windows 10 and 11 (x86, x64, ARM64 since 1.21). Licence BSD-3-Clause. Installed as the kernel service `ViGEmBus` ("Nefarius Virtual Gamepad Emulation Service"). It is already installed and running on the owner's rig (`fixtures/rigs/mark-full/services.json`).
- **RigReady never installs it.** The setup needs administrator rights; RigReady runs as the user and only links to the official releases page. Detection is read-only: the service list.
- **Client library: ViGEmClient.dll** (MIT, also archived). Nefarius does not ship it as a DLL; the `vgamepad` Python package (MIT, 0.1.0, October 2023) carries a build of it. `npm run setup:python` downloads that package's source archive from PyPI pinned by SHA-256, takes out only `ViGEmClient.dll` (x64) and its licence, checks the DLL's own SHA-256, and puts it in `resources/vigem/`. Nothing in the archive is run; its bundled ViGEmBus installer is left alone. (`pip install vgamepad` would run that installer; we never pip-install it.)
- **Successors.** Nefarius announced "VirtualPad" as a successor; nothing official has shipped as of this writing, and one user reading of its licence calls it proprietary. **VIIPER** (Alia5, the GlosSI author) emulates an Xbox 360 controller over USB/IP with the signed `usbip-win2` driver; HandheldCompanion and SteamlessController forks use it. Not chosen now: it is newer, needs a different driver, and has no Python client of its own. The port (`VirtualPads`) does not name the driver, so a second implementation can be added later.
- **Hiding the real device: HidHide** (Nefarius, not retired). Its CLI needs no elevation (stated in its CLI documentation); RigReady already read it, and now changes it, always through `HidHideCLI.exe` with an argument list. RigReady's own input reader (`python.exe`) is put on the allow list so RigReady keeps seeing the hidden controllers.
- **Risks.** (1) Anti-cheat: ACE COMBAT 8 ships Easy Anti-Cheat. No report was found of EAC refusing or banning ViGEm controllers in this game; EA's own anti-cheat (Javelin, a different product) blocks DS4Windows and reWASD in EA titles, and a forum comment from Ace Combat 7 warned that x360ce's DLL injection could be flagged. RigReady injects nothing into the game: the virtual controller is a separate device. Still, say "try it offline first". (2) The driver is unmaintained: a future Windows change could break it, with no fix coming. (3) The DLL comes from a third party's build of an archived library; pinned by hash, licence kept with it. (4) DualShock 4 output is implemented from the published report layout but not yet tried against a game.

## ACE COMBAT 8: WINGS OF THEVE

- Steam app **2288340**. Early access 28 to 29 September 2026, release 2 October 2026 (PS5, Xbox Series, PC). Unreal Engine, Windows 11 only, Easy Anti-Cheat and Denuvo.
- **Input.** The game supports gamepads and two licensed sticks: the Thrustmaster T.Flight HOTAS NEO (Ace Combat 8 edition, "NEO mode") and the HORI Ace Combat 8 flight stick. Community reports say the T.16000M, T.Flight HOTAS One/X and Logitech X56 are detected but lack proper remapping; Warthog, VKB, Virpil and WinWing multi-device setups need workarounds. Bandai Namco said the AC7-style remapping options are missing and that it will improve this; update 1.01.002 did not add full HOTAS remapping (per acecombat8.guide).
- **Files** (community guides, not seen on a PC RigReady ran on): settings under `%LOCALAPPDATA%\BANDAI NAMCO Entertainment\ACE COMBAT 8\Saved\Config\Windows` (`GameUserSettings.ini`), the program `Game\Binaries\Win64\AceCombat8.exe` behind EAC's launcher. The game module only uses these when they exist.
- **Standard Xbox layout** (ludo.guide): left stick up and down pitch, left and right roll; right stick left and right yaw; RT throttle up, LT throttle down; R3 lock on; d-pad left and right change weapon, up and down zoom the reticle; L3 with the left stick evasive manoeuvres; Start menu, Back target information. In Expert controls left and right on the stick rolls rather than turns.

## What players use (for this game and similar ones)

| Approach | What it is | Notes |
|---|---|---|
| Joystick Gremlin + vJoy + x360ce + HidHide | The chain the main Steam guide for AC8 describes: Gremlin maps the stick onto vJoy (a virtual DirectInput joystick, not a gamepad), x360ce 4 turns vJoy into a ViGEm Xbox 360 controller, HidHide hides the real stick | Four tools, a fixed start order (vendor software, vJoy, Gremlin profile, x360ce, then the game). Gremlin's Split Axis divides the throttle at about 38% (the idle detent) into LT and RT. Many players report x360ce alone did not help |
| Steam Input | Enable Steam Input for the game, map the stick as a "generic" controller onto an Xbox layout | No extra driver; mixed results with HOTAS, and some guides tell players to turn it **off** when a stick that worked natively breaks |
| x360ce in the game folder | The old DLL-wrapper mode (`xinput1_3.dll` next to the game) | A last resort; DLL wrappers next to an EAC game are a real anti-cheat risk |
| DS4Windows, XOutput, JoyShockMapper | Map one controller to a ViGEm pad | Built for gamepads and gyro, not for HOTAS. Ryochan7's DS4Windows was archived on 1 January 2024; a newer fork moved to VIIPER |
| AC8 HOTAS mod (Nexus) | Binds sticks to the game's own inputs | Per acecombat8.guide: offline single-player only, with Easy Anti-Cheat turned off. Not something RigReady goes near |
| Vendor software (TARGET, G HUB, VKB, SimAppPro) | Calibration, curves, presenting a combined device | Still needed for some hardware before any of the above |

**Community mappings and curves.** Pitch on left stick Y (stick back = stick down), roll on left stick X, yaw on the right stick X (Standard layout) or LB/RB (the Steam guide's layout), forward throttle on RT and reverse on LT with the split at the idle detent, weapons on A, B, X, Y. Deadzones: "the lowest value that does not drift"; 0 to 5% in game for one stick; a Warthog needs one for its twitchy centre. Curves: a gentler centre for fine aiming while keeping full rate at full deflection. Nobody quotes numbers beyond these, so the starting profile uses small deadzones (3% stick, 5% rudder and throttle) and a straight curve, and says it is a starting point.

**Driving games and emulators.** The same need: wheel angle on left stick X (with a steering lock smaller than the wheel's rotation, so the range setting matters), throttle on RT and brake on LT, each with its own curve (a brake curve above 1 gives finer control near the top), paddles on the bumpers or A and X. PCSX2, DuckStation, Dolphin and RetroArch all read an XInput controller through SDL or XInput; DuckStation and PCSX2 also take a DualShock 4 through SDL.

## Latency

The real controllers are read by RigReady's DirectInput reader (`python/input_server.py`), which polls every 16 ms (about 60 Hz) and sends a state only when something changed. The virtual controller is sent a report as soon as that state arrives (two local pipes, well under a millisecond each), and the same report again every 250 ms while nothing moves. XInput keeps the last report, so games polling faster than the reader see the newest state; the worst case added latency is one poll interval, about 16 ms, plus the game's own polling. If players feel it, the reader can poll faster while a virtual controller runs (a change to the shared input port, left for later).

## Lifetime and safety

- The virtual controller is held by a second helper (`python/pad_server.py`), started when one is plugged in. When RigReady quits, the shell unplugs it; when RigReady ends in any other way, the helper's input closes and it unplugs and exits; and ViGEmBus itself removes the controllers of a program that ended. No virtual controller outlives RigReady.
- HidHide changes are written to RigReady's data folder (`virtual-controller/hidden.json`) before the controller is plugged in. They are undone when it stops (by hand, at Stand down, or when the helper dies) and, after a crash, at the next start. Only what RigReady added is taken away: devices that were already hidden, an allow-list entry that was already there and cloaking that was already on stay as they were. HidHide's inverse mode is refused.
- HidHide affects programs that open the device after the change, so the virtual controller is started before the game (a step before launch).

## Sources

- Nefarius, ViGEm end-of-life statement: https://docs.nefarius.at/projects/ViGEm/End-of-Life/
- ViGEmBus repository (archived) and releases: https://github.com/nefarius/ViGEmBus, https://github.com/nefarius/ViGEmBus/releases
- HidHide CLI usage: https://docs.nefarius.at/projects/HidHide/CLI-Usage/
- vgamepad on PyPI: https://pypi.org/project/vgamepad/
- VIIPER: https://github.com/Alia5/VIIPER ; usbip-win2: https://github.com/Alia5/usbip-win2
- DS4Windows discussion on VirtualPad licensing: https://github.com/Ryochan7/DS4Windows/discussions/3124
- ACE COMBAT 8 on Steam: https://store.steampowered.com/app/2288340
- "[FIX] HOTAS Support" Steam guide: https://steamcommunity.com/app/2288340/discussions/0/594068631729613161/
- acecombat8.guide HOTAS page: https://acecombat8.guide/hotas/
- xmodhub HOTAS fix guide: https://www.xmodhub.com/info/guides/ace-combat-8-wings-of-theve-hotas-flight-stick-fix/
- Standard Xbox control scheme: https://www.ludo.guide/guide/ace-combat-8-wings-of-theve/getting-started-core-mechanics/basic-flight-controls/standard-control-scheme-xbox
- Bandai Namco launch news: https://www.bandainamcoent.com/news/ace-combat-8-wings-of-theve-takes-flight-today
- PC issues and fixes (GamingBolt): https://gamingbolt.com/ace-combat-8-wings-of-theve-studio-apologizes-for-pc-issues-working-on-fixes
- Easy Anti-Cheat and Linux (GamingOnLinux): https://www.gamingonlinux.com/2026/09/ace-combat-8-wings-of-theve-shows-online-play-not-working-on-steamos-linux/
- EA on DS4Windows and anti-cheat: https://forums.ea.com/discussions/battlefield-franchise-discussion-en/ds4windows-detected-as-cheat/12318804
- Ace Combat 7 x360ce anti-cheat comment: https://steamcommunity.com/app/502500/discussions/0/1777135944136094085
