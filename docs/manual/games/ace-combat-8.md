---
title: Ace Combat 8
description: How Ace Combat 8 is found, its settings and saves, and flying it with a stick it does not support, through a virtual controller.
order: 45
---

Ace Combat 8: Wings of Theve reads a gamepad and two licensed sticks (the Thrustmaster T.Flight HOTAS NEO Ace Combat 8 edition and HORI's Ace Combat 8 flight stick). Other sticks, throttles and pedals are not supported properly. RigReady finds the game and its settings, and gives it a [virtual controller](../hardware/virtual-controller.md) driven by the gear you have.

## Detection and launch

The game is found through Steam (app 2288340) in any Steam library; otherwise the game page offers **Choose folder…**, which needs the folder with `Game\Binaries\Win64\AceCombat8.exe`. **Launch** asks Steam to start it, so Easy Anti-Cheat starts as it should. The game counts as running when `AceCombat8.exe` is running. The version shown is Steam's build number.

## Settings and saves

The game keeps its settings in `%LOCALAPPDATA%\BANDAI NAMCO Entertainment\ACE COMBAT 8\Saved\Config\Windows` (graphics in `GameUserSettings.ini`) and its saves next to them under `SaveGames`. RigReady lists these folders and suggests them for [backup](../protect/backups.md) once the game has created them. These locations come from players' reports; they are used only where they exist.

## Flying it with your own stick

1. Install the ViGEmBus driver yourself ([Virtual controller](../hardware/virtual-controller.md#the-driver) has the steps).
2. On **Configure > Virtual controller**, **Make a copy** of **Flight stick to gamepad (Ace Combat 8)**. The copy is called "My Ace Combat 8 stick".
3. In the copy, press **Press or move** for each part and move your control:
   - the stick left and right for roll, back and forward for pitch;
   - the pedals (or the stick's twist) for yaw;
   - the throttle for **Right trigger (RT)**, which speeds up;
   - a button for **Left trigger (LT)**, which slows down. The speed brake switch of a throttle suits it;
   - the buttons you want for the rest. Each part says what it does in the game, where players' guides agree.
4. Watch the live picture near the top of the editor while you move the controls, then **Save**.
5. Make the setup: **Configure > Setups > New setup from this rig**, and choose Ace Combat 8. The step **Start a virtual controller** is offered under **Before launch**, with your copy chosen by name ([Creating a setup from the rig](../setups/capture.md#before-launch)). If the game also picks up your real stick, open the step in [the setup editor](../setups/editor.md) and turn on **Hide controllers**.
6. In the game's flight control setting, choose **Expert** for a stick: left and right then roll the aircraft, as a real stick does. With **Standard**, left and right turn the aircraft instead, which suits a gamepad's thumb stick. Then check every axis in the game's controls screen and set the game's own sensitivity to taste.

**The high-G turn.** The game reads RT and LT held together as a high-G turn. That is why this starting point has the switch **One throttle axis on both triggers** turned off: one throttle split over both triggers can never press both at once, and pulled fully back it always brakes. With the throttle on RT and a button on LT, push the throttle forward and hold the button for the turn.

**What is not certain.** The notes come from players' guides, not from the game's makers. The guides agree on pitch and roll on the left stick, RT, LT, the high-G turn and the two flight control settings. They do not agree on what A, B, X and Y do, or on whether yaw is read from the right stick or from the bumpers: look at the game's controls screen. If yaw is on the bumpers in yours, map the pedals to LB and RB as buttons (an axis counts as a button once it is pushed past half its travel).

Ace Combat 8 uses Easy Anti-Cheat for online play. Try the virtual controller offline first; see [anti-cheat and online play](../hardware/virtual-controller.md#anti-cheat-and-online-play).
