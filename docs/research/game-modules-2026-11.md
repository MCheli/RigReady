# Game modules added in November 2026: ids, paths and sources

Date: 2026-11-11. The modules under `src/features/games/` for the games below take every Steam app id, folder and file name from this page. Each was checked against a public source before it went into code.

How the checks were made:

- **Steam app ids.** SteamDB refuses automated requests (HTTP 403 on every page tried), so each id was checked against Steam's own store API, `https://store.steampowered.com/api/appdetails?appids=<id>&filters=basic`, which returns the app's name and type. All of them answered `success: true` with the name in the table. PCGamingWiki's infobox gives the same ids (its `steam appid` field), read through its MediaWiki API (`/w/api.php?action=parse&prop=wikitext`), because its HTML pages also refuse automated requests.
- **Folders.** PCGamingWiki's "Configuration file(s) location" and "Save game data location" sections where it has them, otherwise the publisher's own pages or developer forums, then community guides. Where only community sources exist, the table says so.
- **This PC.** The owner's Steam library was listed read-only. Of these games only EA SPORTS WRC is installed; its folders below were confirmed on disk. Nothing was written there and no game was started.

| Game | Module id | Steam app id | Store API name |
|---|---|---|---|
| Microsoft Flight Simulator (2020) | `msfs2020` | 1250410 | Microsoft Flight Simulator (2020) 40th Anniversary Edition |
| X-Plane 12 | `x-plane-12` | 2014780 | X-Plane 12 |
| X-Plane 11 | `x-plane-11` | 269950 | X-Plane 11 |
| IL-2 Sturmovik: Great Battles | `il2-great-battles` | 307960 | IL-2 Sturmovik: Battle of Stalingrad |
| Falcon BMS (needs Falcon 4.0) | `falcon-bms` | 429530 (Falcon 4.0; BMS is not on Steam) | Falcon 4.0 |
| Assetto Corsa Competizione | `acc` | 805550 | Assetto Corsa Competizione |
| rFactor 2 | `rfactor2` | 365960 | rFactor 2 |
| Automobilista 2 | `ams2` | 1066890 | Automobilista 2 |
| EA SPORTS WRC | `ea-wrc` | 1849250 | EA SPORTS™ WRC |
| F1 25 | `f1-25` | 3059520 | F1® 25 |
| F1 24 | `f1-24` | 2488620 | F1® 24 |
| DiRT Rally 2.0 | `dirt-rally-2` | 690790 | DiRT Rally 2.0 |
| RaceRoom Racing Experience | `raceroom` | 211500 | RaceRoom Racing Experience |

## 1. Microsoft Flight Simulator (2020)

- Steam settings: `%APPDATA%\Microsoft Flight Simulator\` (PCGamingWiki, Configuration file(s) location). `UserCfg.opt` holds `InstalledPackagesPath`, as in 2024.
- Microsoft Store: `%LOCALAPPDATA%\Packages\Microsoft.FlightSimulator_8wekyb3d8bbwe\LocalCache\`; its input profiles are in `SystemAppData\wgs\<user id>\` as Xbox containers (PCGamingWiki). RigReady does not back those up and says so.
- Steam Cloud: `<Steam>\userdata\<user id>\1250410\remote\` (PCGamingWiki, Save game data location); the controller profiles are kept there ([MSFS forum: how controller profiles are stored](https://forums.flightsimulator.com/t/rationale-for-how-hardware-controller-profiles-are-stored-in-fs-2020/393634)). Offered as one folder.
- Program: `FlightSimulator.exe`. Not required in the Steam folder: like 2024, the manifest is enough.

## 2. X-Plane 12 and 11

- Standalone installs: the installer records each install folder, one per line, in `%LOCALAPPDATA%\x-plane_install_11.txt` ([X-Plane developer: how to locate X-Plane](https://developer.x-plane.com/article/how-to-programmatically-locate-x-plane-9-or-10/), which describes the format and names the file for 9, 10 and 11). X-Plane 12 writes `x-plane_install_12.txt` in the same folder ([Navigraph forum](https://forum.navigraph.com/t/x-plane-12-0-fms-data-manager-not-updating/20216), [TDS Sim forum](https://www.tdssim.com/forum/thread-1430.html)). A listed folder counts only when it holds `X-Plane.exe`.
- Preferences: `<install>\Output\preferences` (PCGamingWiki, X-Plane 11). Control profiles: `Output\preferences\control profiles\` ([Sporty's: Honeycomb profiles in X-Plane 12](https://www.sportys.com/blog/how-to-install-sportys-honeycomb-bravo-profiles-with-x-plane-12/), [AVSIM](https://www.avsim.com/forums/topic/701822-controller-settings-keyboard-settings-saving/)). The `.prf` file names differ between versions in the sources, so the module offers whatever `*.prf` files are there instead of naming them.

## 3. IL-2 Sturmovik: Great Battles

- One install holds every Great Battles title; on Steam it is app 307960. Program `bin\game\Il-2.exe` ([IL-2 forum: launching from bin\game](https://forum.il2sturmovik.com/topic/79028-trying-to-start-il-2-with-a-batch-file)).
- Bindings: the developer's own list of files to keep across a reinstall is `data\input\current.actions`, `current.devices`, `current.map`, `current.responses`, `curves.cfg` and `data\swf\il2\storage\storeddevices.txt` ([IL-2 Update 2.005 notes](https://il2sturmovik.com/news/261/update-2005/)). Later versions also keep `devices.txt` in `data\input`, numbering the controllers (IL-2 forum threads on backing up controls, e.g. [59492](https://forum.il2sturmovik.com/topic/59492-loosing-joystick-config-and-keybinding-how-to-backup) and [74258](https://forum.il2sturmovik.com/topic/74258-controls-setup-files-for-backup); community sources). `data\startup.cfg` holds the options (the same threads).
- PCGamingWiki has no configuration section for it.

## 4. Falcon BMS

- Registry: `HKLM\SOFTWARE\Wow6432Node\Benchmark Sims\<version>`, value `baseDir`; the version keys are named `Falcon BMS 4.38`, `Falcon BMS 4.37` and so on. The game is `<baseDir>\bin\x64\Falcon BMS.exe`, and the launcher Benchmark Sims publishes registers `<baseDir>\Launcher.exe` as the program to start. Source: Benchmark Sims' own launcher, [`AppRegInfo.cs` in BenchmarkSims/FalconBMS-Launcher](https://github.com/BenchmarkSims/FalconBMS-Launcher) (`availableBMSVersions`, `BMSExists`).
- Settings: `User\Config`. The same project lists the files it overwrites there and backs up to `User\Config\Backup`: `axismapping.dat`, `DeviceSorting.txt`, `Falcon bms.cfg`, `joystick.cal`, the `.pop` pilot file ([FalconBMS-Launcher README](https://github.com/BenchmarkSims/FalconBMS-Launcher)). Keyfiles (`*.key`) and `Falcon BMS User.cfg` are kept there too ([BMS forum: backing up axis mappings](https://forum.falcon-bms.com/post/240344)).
- Falcon 4.0 is required to install BMS ([CombatACE: Falcon BMS 4.38 released](https://combatace.com/forums/topic/99966-falcon-bms-438-the-big-one-is-released)); on Steam it is app 429530 (PCGamingWiki, Falcon 4.0).

## 5. Assetto Corsa Competizione

- Settings: `%USERPROFILE%\Documents\Assetto Corsa Competizione\Config\` (PCGamingWiki). `controls.json` is there ([Coach Dave Academy](https://coachdaveacademy.com/tutorials/ultimate-assetto-corsa-competizione-controller-settings), [Overtake](https://www.overtake.gg/threads/acc-g29-controls-json.168533/)); `menuSettings.json` can be reset by a major update (Kunos patch notes for 1.10.3, as quoted in search results). Control presets go in `Customs\Controls`, and players advise keeping `Config`, `Setups` and `Customs` (Steam community discussions for app 805550, e.g. [this one](https://steamcommunity.com/app/805550/discussions/0/3712684644824906822)); community sources only.
- Saves (`Savegames`) are left out.
- Program: `AC2\Binaries\Win64\AC2-Win64-Shipping.exe` ([SteamDB depot 805551](https://steamdb.info/depot/805551), as quoted in search results; the page itself refuses automated requests).

## 6. rFactor 2

- Settings: `<game>\UserData\Config.ini`; player file `<game>\UserData\player\player.json` (PCGamingWiki). The active bindings are `UserData\player\Controller.JSON`, saved when the game exits, and saved controller profiles are in `UserData\Controller` ([Granite Devices forum](https://community.granitedevices.com/t/rfactor-2-and-simucube-2/2975), [Steam discussion](https://steamcommunity.com/app/365960/discussions/0/135507548121919466)).
- Program: `Bin64\rFactor2.exe`. Not confirmed by a public page reached here, so the Steam install is not required to contain it (the manifest is enough); the name is used for "running" and for a folder chosen by hand.

## 7. Automobilista 2

- Settings: `%USERPROFILE%\Documents\Automobilista 2\`; profiles in `savegame\<user id>\automobilista 2\profiles\` (PCGamingWiki). The controller settings are `default.controllersettings*` in that profiles folder ([Reiza forum](https://forum.reizastudios.com/threads/having-to-reassign-controls-on-every-single-launch.35211)).
- Program: `AMS2AVX.exe` ([ReShade forum log](https://www.reshade.me/forum/troubleshooting/10102-automobilista-2-6-4-1-okay-6-5-1-causes-ctd-analysis-with-steps-and-logs)).

## 8. EA SPORTS WRC

- Settings: `%LOCALAPPDATA%\WRC\Saved\Config\WindowsNoEditor\` (PCGamingWiki); saves are Steam Cloud files in `userdata\<id>\1849250\remote` and `%LOCALAPPDATA%\WRC\Savegame` (PCGamingWiki), left out.
- Confirmed on this PC (read only): that folder holds `GameUserSettings.ini`, `EgoInput.ini`, `Input.ini` and other engine INI files; `Documents\My Games\WRC\telemetry\config.json` holds the UDP telemetry settings; the program is `<Steam>\steamapps\common\EA SPORTS WRC\WRC\Binaries\Win64\WRC.exe`.
- Where the game keeps custom controller bindings was not found; the game page says they may not be in the backup.

## 9. F1 25 and F1 24

- Settings: `%USERPROFILE%\Documents\My Games\F1 25\hardwaresettings` (PCGamingWiki, F1 25) and `...\F1 24\hardwaresettings\hardware_settings_config.xml` (PCGamingWiki, F1 24). EA's own troubleshooting guide asks players to delete the files there when a wheel misbehaves ([EA: F1 25 PC and wheel troubleshooting guide](https://forums.ea.com/blog/f1-games-game-info-hub-en/f1%C2%AE-25-pc-and-wheel-troubleshooting-guide/12211575)).
- Saves: Steam Cloud (`userdata\<id>\3059520\remote`, `...\2488620\remote`; PCGamingWiki), left out. Where custom bindings are kept was not confirmed; the page says so.
- Program: `F1_25.exe` in the Steam folder ([EA forum crash report](https://forums.ea.com/idea/f1-25-bug-reports-en/f1-25-crashes-on-launch---steam---no-missing-files/13310172)); `F1_24.exe` by the same pattern, not confirmed. Neither is required in a Steam install.
- F1 25 is the current game; F1 24 is included because the same module covers it at no cost.

## 10. DiRT Rally 2.0

- Settings: `%USERPROFILE%\Documents\My Games\DiRT Rally 2.0\hardwaresettings\` (Steam) and `...\DiRT Rally 2.0\` (Microsoft Store) (PCGamingWiki). Store package: `CodemastersSoftwareCompan.DiRTRally2.0Windows_4cfye3zbe1gaw` (PCGamingWiki, Store save location).
- Binding maps: `<game>\input\actionmaps\*.xml`, one per wheel, and `<game>\input\devices\device_defines.xml` for the controllers the game recognises ([Steam discussion](https://steamcommunity.com/app/690790/discussions/0/1643168364656296125), [Codemasters: Multi Input Device Configuration (PDF)](https://cdn.cloudflare.steamstatic.com/steam/apps/690790/manuals/DR2_Multi_Input_Device_Configuration.pdf)).
- Program: `dirtrally2.exe`, not confirmed by a page reached here; not required in a Steam install.

## 11. RaceRoom Racing Experience

- Settings: `%USERPROFILE%\Documents\My Games\SimBin\RaceRoom Racing Experience\UserData` (PCGamingWiki). No public source was found that names the files inside, so the module offers the folder as a whole and does not describe its contents beyond "settings".
- Program: `Game\x64\RRRE64.exe`, not confirmed by a page reached here; not required in a Steam install.

## What was left out, and why

- **Bindings views and repairs** for any of these games: each needs its file format read and, for a repair, a test on the real game (see the coverage audit, gap 9). These modules find, launch and back up only.
- **Launching Microsoft Store editions** (MSFS 2020, DiRT Rally 2.0): Windows starts Store apps from their package; the page says so, as for MSFS 2024.
- **IL-2 standalone default folder**: no public source for where the 1C installer puts the game was found, so a standalone install is found only through **Choose folder…**.
- **X-Plane 10 and older, F1 23 and older, Dirt Rally (2015)**: not asked for.
