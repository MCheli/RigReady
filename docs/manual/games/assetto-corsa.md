---
title: Assetto Corsa
description: How Assetto Corsa is found and launched, which cfg files are backed up, and the controllers, bindings and force feedback page read from controls.ini.
order: 40
---

Assetto Corsa keeps its settings as INI files in `Documents\Assetto Corsa\cfg`. RigReady finds the game through Steam, backs up the cfg folder, and reads `controls.ini` to show the controllers the game knows, what is bound to them and the force feedback settings. There is no repair tool for this game.

## Detection and launch

The game is found through Steam (app 244210) when `AssettoCorsa.exe` is in the folder; otherwise the game page offers **Choose folder…**. **Launch** asks Steam to start it. The game counts as running when `AssettoCorsa.exe`, `acs.exe` (the simulation itself) or `Content Manager.exe` is running. The version is the Steam build.

## Files worth backing up

From `Documents\Assetto Corsa\cfg`: the whole folder as one item, and separately `controls.ini` (bindings and force feedback), `video.ini`, `gameplay.ini`, `assists.ini`, `audio.ini` and the `controllers\savedsetups` folder with your saved control presets. The Content Manager settings folder under `%LOCALAPPDATA%\AcTools Content Manager` is listed as a settings folder when it exists.

Assetto Corsa and Content Manager write `controls.ini` while they are open, so a restore is refused while any of them runs. The path variables `{AC_USER}` (the `Documents\Assetto Corsa` folder) and `{AC_INSTALL}` are available in a setup.

## The bindings and controllers page

**Configure > Racing > Assetto Corsa** reads `controls.ini`.

**Controllers** lists the `[CONTROLLERS]` section: each controller's index and name as the game stored them, a short form of its Windows instance id, whether any binding uses it, and a state matched against the connected controllers: **Connected** (the stored instance id is attached), **New Windows id** (a controller of the same model is attached under another id), **Not connected**, or **Unknown**. The input method from the file's header is shown beside the heading. A wheel base can show up as two controllers with the same name; the one without bindings is expected.

When a controller the bindings use is not connected under its stored id, a notice says that Assetto Corsa refers to controllers by their Windows id, and that you should bind it again in the game or in Content Manager, or restore a backup taken while it worked. RigReady does not rewrite `controls.ini`.

**Bindings** lists each action in plain language (Steering, Throttle, Brake, Shift up, Brake balance forward, Look left, and so on, including the sections Content Manager and Custom Shaders Patch add), with its axis or button and the controller, and keyboard bindings where the file has them.

**Force feedback** shows the steering lock in degrees, the force feedback gain and filter, the minimum force, and the kerb, road, slip and ABS effect levels.

![The Assetto Corsa page](../../../artifacts/screens/racing-games/05-assetto-corsa.png)

## Backups and checks

The **Backups** section keeps quick copies of `controls.ini`, with the preview, Undo and **Use in a setup** described on the [iRacing page](iracing.md). A racing setup for Assetto Corsa gets the common racing checks described under [Games](index.md); there is no wheel settings comparison for this game.
