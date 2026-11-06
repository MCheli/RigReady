---
title: Wheel
description: The Wheel page: your Fanatec base as Windows sees it, its software, the tuning presets you record by hand, and recommended settings per game next to the files.
order: 80
---

**Configure > Wheel** (also under Hardware, and reached from the [Racing overview](index.md#configure-racing)) is the page for a Fanatec wheel base. It shows whether the base is connected and in which mode, which Fanatec software is installed and running, and a record of the tuning presets the base keeps in its own memory, which RigReady cannot read. It also puts the recommended settings for each game next to what can be read from the game's files.

## The wheel base

The top panel says which base is connected (the name you gave it on the [Devices page](../hardware/devices.md), with the name it reports), its mode, its vendor and product id, and what it is connected through:

- **PC (red) mode**: the base reports itself as what it is, for example 0EB7:0007 for a Podium DD2.
- **Compatibility (yellow) mode**: the base reports itself as a ClubSport Wheel Base V2.5 (0EB7:0004). A warning says that bindings saved in PC mode do not match it in [iRacing](iracing.md), [Le Mans Ultimate](le-mans-ultimate.md) or [BeamNG.drive](beamng.md), and to switch the base to PC mode in its menu or in the Fanatec App.

Games see a Podium base as two controllers with the same name. The page says how many controllers Windows makes of the base and that both are the base, not a duplicate; games use the first. Fanatec accessories on USB (pedals, the shifter or handbrake adapter) are listed as "Also connected".

A PC that never had a Fanatec base shows "No Fanatec wheel base on this PC" and nothing to set up.

![The Wheel page](../../../artifacts/screens/racing-wheel/01-wheel.png)

## Fanatec software

The panel lists what RigReady can see of the Fanatec software: the driver package and its version, the Fanatec Wheel Service (the Windows service `FWPnpService`), the Fanatec Service program (LEDs, displays and game integration) and whether it is running, and the Fanatec App with its version and whether it is open. Under it:

- **Base firmware in this driver**: the firmware version the installed driver ships for Podium bases, from the driver's own version list. The firmware on the base itself can only be read on the base or in the Fanatec App.
- **Last seen by the Fanatec driver**: the steering wheel (rim) code and the wheel rotation the driver last saw, from its cache in the registry. Fanatec does not publish what the rim codes mean, so they are shown as codes.

## Your tuning presets

The base keeps five tuning presets in its own memory. No file on the PC holds them, and Fanatec offers no supported way to read them, so RigReady cannot back them up by itself. What it can do is keep the copy you write down.

Five tabs, **Preset 1** to **Preset 5**, each with a name, a note ("Which rim, which cars"), and a field for each tuning parameter: SEN, FF, FFS, NDP, NFR, NIN, INT, FEI, FOR, SPR, DPR, BLI, SHO and BRF. Type the values as the base shows them ("1080", "AUT", "Lin", "Off"); each field's hint says what the parameter is. Tick **The preset I drive with** on the one you normally use. **Save presets** stores them with RigReady's own data, so they survive a reinstall of the Fanatec software.

![Recording the presets](../../../artifacts/screens/racing-wheel/02-presets.png)

RigReady never writes tuning to the base. The presets are a record to set the base back from, by hand.

## Recommended settings

The last section shows, for iRacing, Le Mans Ultimate and BeamNG.drive, a table of recommended settings with their source and the date they were retrieved, and a caveat where there is one: the iRacing values are from the Podium DD1 entry of Fanatec's forum post, Fanatec publishes no recommendation for Le Mans Ultimate (the values are a community guide), and BeamNG.drive is not in Fanatec's game list (the values are Fanatec's general guide).

Each row says whether the setting is **on the wheel** or **in the game**, the recommended value, and what is on this PC:

- A setting on the wheel is always **Cannot be read**. When your active preset has a value for it, that value is shown next to "Set on the wheel", so you can compare by eye.
- A setting in the game is compared when the game's files hold it: smoothing, minimum torque and "rotation from the wheel driver" for Le Mans Ultimate; force feedback on and the steering rotation for BeamNG.drive. It reads **As recommended** or **Differs**. The BeamNG steering rotation is compared with the SEN of your recorded preset, and is **For reference** when the preset has no SEN.
- A setting that is not stored where RigReady can read it, such as iRacing's strength and wheel force, says so.

![Recommended settings](../../../artifacts/screens/racing-wheel/03-recommended.png)

The optional check **wheel settings as recommended**, offered when a setup for Le Mans Ultimate or BeamNG.drive is captured, runs the same comparison on the [Play screen](../play/index.md) and lists the settings that differ ([Checks and fixes](../setups/checks.md)).

## Backups

The **Backups** section at the bottom keeps copies of the Fanatec App's own settings file (`shared_preferences.json` under its application data folder), and records the Fanatec Service settings from the registry as a file in every backup. The registry record is kept as a record only: RigReady never writes the registry, so a restore puts back the App's settings file and shows the registry values for you to compare. [Restoring](../protect/restore.md) needs the Fanatec App closed; if it is open, RigReady offers to close it, restore, and start it again.

The same two items are offered for a full backup on the Backups page: see [backups](../protect/backups.md).
