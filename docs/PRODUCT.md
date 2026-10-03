# RigReady — Product Definition

This is the source of truth for what RigReady is. It supersedes `docs/archive/` (the January–February 2026 brainstorm, requirements and design documents), which remain useful background but are not binding. The per-requirement list lives in `docs/requirements/ledger.yaml`.

Agreed with the owner (Mark Cheli) on 2026-10-03.

## The problem

A sim rig PC is also used for other things. Getting it ready to fly or race means the right hardware is plugged in, the right helper apps are running, the monitors are arranged correctly, and the game's bindings and settings are intact. When one of those is off, you find out after the game has loaded and have to start over. Setting bindings up from scratch on a new PC or a reinstall takes ten or more hours.

## Three jobs, in priority order

### 1. Tell me I'm ready, then launch ("Fly" mode)

1. I open RigReady and it shows the setup I used last, for example "DCS F/A-18C".
2. It shows a checklist grouped by kind: devices connected, apps running, monitors correct, audio correct, config files in place.
3. Anything wrong has a fix next to it. **Make ready** runs every available fix in the right order (start apps, apply the monitor layout, restore files).
4. I press **Launch**. The game starts. Launch is never blocked, only warned.
5. Afterwards, **Stand down** closes the helper apps and puts the monitors back to the desk layout.

### 2. Set it up and protect it ("Configure" mode)

- Create and edit setups (profiles), one per aircraft or car. Setup is primarily **capture what is true right now** while the rig is working (devices, running apps, monitor layout, audio devices, config files), then edit — not a form to type into.
- Back up and restore bindings and configs. One-click backup and a restore wizard covering game settings, bindings and Stream Deck.
- Manage bindings: see them, edit them, clean up what the game binds by default on every device, recover when Windows changes device IDs, copy common controls between aircraft.
- Per-aircraft cheat sheets: a picture of each device with what every control does, printable and exportable as a DCS kneeboard page.
- AI-assisted binding guidance (optional, bring your own Anthropic API key): what should be bound on this aircraft, in what priority, with plain-language labels. Non-AI parts work without a key.
- Share a setup with other people as a file, with personal paths and identifiers reviewed and removed. Scripts are never included.
- Stream Deck: install guidance, backup, restore, backup management.

### 3. Troubleshoot hardware

- See every device, identify it by pressing a button, give it a name.
- Test buttons and axes the way a game sees them, one device or all at once.
- Health: stuck buttons, noisy axes, rogue inputs.
- USB map: which hub each device is on, to stay under Windows limits and find what to unplug.
- Notice devices hidden by HidHide.

## Two modes that must feel different

"I just want to fly" (checklist, Make ready, Launch, Stand down) and "I'm configuring things" (profiles, bindings, backups, device tools, settings). The first is one screen that is useful within two seconds of opening. The second is where all the depth lives.

## Scope

- **Games:** DCS World first and deepest (F/A-18C, then UH-1H Huey). Racing in full scope: iRacing, Le Mans Ultimate, BeamNG.drive, including wheel settings per game. Any other game works generically (checklist, launch, tracked files, backup).
- **Hardware on the owner's rig:** nine WinWing devices, Thrustmaster TPR pedals, Virpil control panel, TrackIR 5, Stream Deck, Fanatec Podium DD2 wheel. Samsung 49" ultrawide (flying and racing), three identical USB MFD screens (flying), a Dell desk monitor (off while flying), a TV (racing).
- **SimAppPro:** the goal is to replace it where possible. Configuration (MFD screen setup, export scripts, binding backup) must not need it. Runtime features that use WinWing's proprietary protocol (backlight sync, UFC/ICP displays, vibration) are a research item; until solved, RigReady checks that SimAppPro is running when a profile needs those.
- **Platform:** Windows 10/11 only. No admin rights for normal use. Starts with Windows (optional) and lives in the tray.
- **Open source (MIT).** The owner's rig is the first and real test, but nothing may be hardcoded to it.

## Rules that are never broken

1. No file outside RigReady's own data folder is changed without an automatic backup first and a visible description of the change.
2. No success message for something that did not happen. An unimplemented action is not shown.
3. Display changes can always be reverted; applying a layout offers a timed revert.
4. Profiles identify devices by vendor/product ID plus serial or instance where needed to tell identical devices apart — never by display name alone.
5. Nothing from a profile or an imported file is ever placed into a shell command string.
6. A requirement is "done" only with evidence: an automated test that exercises the real code path, and for anything visible, a screenshot from a scenario run.

## Explicitly later

Active in-game overlay, VR headset checks, a hosted sharing service (file sharing comes first; the owner has a home server for later), plugin system.
