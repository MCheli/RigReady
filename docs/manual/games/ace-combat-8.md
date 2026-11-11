---
title: ACE COMBAT 8
description: How ACE COMBAT 8 is found, its settings and saves, and flying it with a stick it does not support, through a virtual controller.
order: 45
---

ACE COMBAT 8: WINGS OF THEVE reads a gamepad and two licensed sticks (the Thrustmaster T.Flight HOTAS NEO Ace Combat 8 edition and HORI's Ace Combat 8 flight stick). Other sticks, throttles and pedals are not supported properly. RigReady finds the game and its settings, and gives it a [virtual controller](../hardware/virtual-controller.md) driven by the gear you have.

## Detection and launch

The game is found through Steam (app 2288340) in any Steam library; otherwise the game page offers **Choose folder…**, which needs the folder with `Game\Binaries\Win64\AceCombat8.exe`. **Launch** asks Steam to start it, so Easy Anti-Cheat starts as it should. The game counts as running when `AceCombat8.exe` is running. The version shown is Steam's build number.

## Settings and saves

The game keeps its settings in `%LOCALAPPDATA%\BANDAI NAMCO Entertainment\ACE COMBAT 8\Saved\Config\Windows` (graphics in `GameUserSettings.ini`) and its saves next to them under `SaveGames`. RigReady lists these folders and suggests them for [backup](../protect/backups.md) once the game has created them. These locations come from players' reports; they are used only where they exist.

## Flying it with your own stick

1. Install the ViGEmBus driver yourself ([Virtual controller](../hardware/virtual-controller.md#the-driver) has the steps).
2. On **Configure > Virtual controller**, **Make a copy** of **Flight stick to gamepad (Ace Combat 8)**.
3. In the copy, press **Press or move** for each part and move your control: stick left and right for roll, stick back and forward for pitch, the pedals (or the stick's twist) for yaw, the throttle for both triggers, and the buttons you want for fire, special weapon, target, view and lock on. Put the throttle split at your idle detent. Save.
4. Add the step **Start a virtual controller** with your profile to the steps before launch of an ACE COMBAT 8 setup, with **Hide controllers** on if the game also picks up your real stick.
5. In the game, keep the Standard control scheme, check every axis in the controls settings, and set the game's own sensitivity to taste.

The starting point follows the game's Standard Xbox layout: pitch and roll on the left stick, yaw on the right stick, throttle up on RT and down on LT, lock on with R3, weapons on the d-pad left and right. Players who use the Expert scheme often put yaw on the bumpers instead: map the pedals to LB and RB as buttons (an axis past half its travel) for that.

ACE COMBAT 8 uses Easy Anti-Cheat for online play. Try the virtual controller offline first; see [anti-cheat and online play](../hardware/virtual-controller.md#anti-cheat-and-online-play).
