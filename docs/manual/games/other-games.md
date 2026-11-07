---
title: Any other game
description: A game RigReady does not know still gets a setup of its own: a checklist of devices, apps, monitors and audio, a launch target you give, and tracked files.
order: 70
---

RigReady does not need to know a game to make a rig ready for it. A setup for another game has the same checklist as any other, launches whatever you point it at, and backs up whatever files you tell it to track. What it does not get is a bindings page, suggested files or a detected install.

## Create the setup

On the capture screen ([your first setup](../getting-started/first-setup.md)), the game tiles end with **Another game**, "you say what to launch". Choose it and type the **Game name**; it is used as the setup's name unless you change that. When no game RigReady knows is on the PC at all, the capture screen says so and points you to this tile.

![A setup for another game](../../../artifacts/screens/generic-custom-game/01-other-game.png)

The rest of the capture is the same as for a known game: every device, running app, the monitor arrangement and the audio defaults are proposed as checks, and you keep what this game needs. See [checks](../setups/checks.md).

In **Configure > Setups**, editing the setup shows the game as **Other game…** with its name. Other setups can be given the same choice.

## The launch target

A known game brings its launch target with it. For another game you set it yourself: the program to start, its arguments and working folder, or a Steam game to ask Steam for. Launch is never built from a shell command, so arguments are a list, not a line. Steps to run before and after launch, and what Stand down closes, work the same as for every setup. See [launch](../setups/launch.md).

## Tracked files

Nothing is suggested for a game RigReady does not know. Add the game's settings folder or files on the Backups page: they are then part of every full backup, restored with the restore wizard, and compared with the last time the game started under **What changed**. See [backups](../protect/backups.md).

![Tracked files of another game](../../../artifacts/screens/generic-custom-game/06-tracked.png)

## What is not there

- No **Bindings and controllers** page, no cheat sheet, no device id repair. RigReady does not know the game's binding format.
- No "close the game before restoring" rule of its own. RigReady does not know which program writes the game's files, so close the game yourself before you restore them.
- The game is not found by itself: it does not appear on **Configure > Games**, and there is no **Running** chip based on its process unless the setup has a check for it.
