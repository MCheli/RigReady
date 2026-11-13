---
title: Virtual controller
description: A virtual Xbox 360 controller or DualShock 4 driven by your stick, wheel or pedals, for games and emulators that read only a gamepad.
order: 70
---

Some games read only a gamepad: Ace Combat 8, many console ports, older driving games, and console emulators such as PCSX2, DuckStation, Dolphin and RetroArch. **Configure > Virtual controller** plugs in a virtual Xbox 360 controller (or a DualShock 4) that those programs see like any other gamepad, and drives it from the controllers you already have: a flight stick, rudder pedals, a throttle, a wheel and pedals, a button box.

![The Virtual controller page](../../../artifacts/screens/virtual-controller-editor/01-page.png)

## The driver

A virtual controller needs the **ViGEmBus** driver by Nefarius Software Solutions, the driver most tools of this kind use (DS4Windows, x360ce and others). RigReady never installs a driver: you install it yourself, once. Its author retired the project and archived it on 2 November 2023, so 1.22.0 is the last release and no fixes will come.

1. On the Virtual controller page, **Open the ViGEmBus releases page** (it asks before opening your browser), and download the setup of the newest release, 1.22.0.
2. Run it. Windows asks for administrator rights; that is the driver's setup asking, not RigReady.
3. Restart Windows if the setup asks you to.

The page then says **Installed**. The project is retired (it gets no more updates) but its signed driver installs and works on Windows 10 and 11. Until it is installed, nothing can be started and the page says why.

![Without the driver](../../../artifacts/screens/virtual-controller-no-driver/01-no-driver.png)

**HidHide**, also by Nefarius, is optional. With it, RigReady can hide your real controllers from games while the virtual one runs, so a game that reads every controller does not see your stick twice. Without it, that option is off and the page says why.

## Profiles

A profile says which of your controls drives each part of the virtual controller. A profile works with any game or emulator that reads a gamepad: the game only sees a controller.

**Starting points** say what each part is for and map nothing yet, because only you know which controls you have. Press **Make a copy** on one and map your own controls in the copy:

- **HOTAS to gamepad**: for any flight or space game. Pitch and roll on the left stick (the stick pulled back is "stick down"), yaw from the pedals or the stick twist on the right stick, one throttle split over both triggers (forward is RT, back is LT), the hat on the d-pad and the main buttons.
- **Wheel and pedals to gamepad**: steering on the left stick, throttle on RT, brake on LT, paddles on the bumpers. For driving games and console emulators.
- **Flight stick to gamepad (Ace Combat 8)**: for that one game, and named for it. The throttle is on RT alone and a button of yours on LT, because the game reads both triggers held together. See [Ace Combat 8](../games/ace-combat-8.md).

**Notes for one game.** A starting point made for one game also says, under a part's plain description, what the part does in that game: "In Ace Combat 8: Lock on". These are notes only; they change nothing a game is sent. A copy keeps them, and its row says "notes for Ace Combat 8". To use the copy for another game, press **Remove the notes for Ace Combat 8** in the editor: the controls you chose stay. The other starting points name no game.

**Names.** No two profiles share a name. A copy gets a name of its own ("My HOTAS", then "My HOTAS 2"), and the editor does not save a name another profile already has. Profiles that shared a name before this rule still load: each says so on its row, and the id on the row tells them apart. The copy opens in the editor; if you went on to another page while it was being made, you stay there and the copy is in the list.

**Which setups use it.** Each of your profiles says which setups start it, such as 'Used by the setup "Ace Combat 8"', or "No setup uses it".

**Deleting.** The bin asks first, with the profile's name and id. When a setup uses the profile, the question names each setup and says what breaks: the setup's step "Start a virtual controller" fails at launch, and the game gets no virtual controller until you choose another profile in that step. **Delete** stays off until you tick **Delete it anyway**. A deleted profile cannot be brought back.

![Deleting a profile that a setup uses](../../../artifacts/screens/virtual-controller-same-names/03-delete-used.png)

Your own profiles are kept in RigReady's data folder.

## The editor

![Mapping a stick](../../../artifacts/screens/virtual-controller-editor/03-editor.png)

For every stick direction, trigger, button and d-pad direction:

- **Press or move**, then press the button, push the hat or move the axis you want for it. RigReady waits ten seconds and counts them down beside the part. Letting go of a stick you just mapped does not count; push the next control away from its centre.
- **Clear** takes the control off again.
- The bar beside a part shows, live, what a game would get from it as the profile is now, before you save it.

**The live picture** near the top draws the whole virtual controller: two sticks, two triggers and the buttons, lit while they are down, with the same in words beside it ("LT 0% · RT 62%", "Left stick: 40% right", "Pressed: A"). Move a control you mapped and watch what a game would get; nothing needs saving first.

**Save and Back** are in a bar along the bottom of the window that stays there however far you scroll. The bar says **Unsaved changes** when what is on screen differs from what was saved, and why Save is off when it is (a name another profile has, for one). Leaving the editor with unsaved changes asks first.

![Save stays in view at the end of the page](../../../artifacts/screens/virtual-controller-editor/06-scrolled-save-in-view.png)

For an axis:

- **Invert** turns it round. A pedal that reads "full" when released needs it on its trigger.
- **Deadzone**: how much movement near the centre (or, on a trigger, near the start) counts as none. A few percent stops a worn stick from drifting.
- **Curve**: 1 is straight. Above 1 is gentler near the centre and steeper at the end, for fine aiming with full rate at full deflection; below 1 the other way round.
- **Full at**: how much of the real travel gives full output. For a wheel, fill in **Wheel turns** (its rotation, lock to lock, say 900 degrees) and **Full stick at** (the steering lock you want, say 270 degrees) and press **Set the range**: 0.3.

**One throttle axis on both triggers** splits one throttle over LT and RT: forward of the split is RT, behind it LT, and at the split neither. **Split at** says where that point is on the lever, from 5 to 95 percent; put it at your idle detent. The deadzone is on both sides of the split. One axis split this way can never press both triggers at once, and pulled fully back it always presses LT.

Turn the switch off for a game that reads both triggers held together, or one where LT should not follow the throttle. LT and RT then each take a control of their own: an axis (two pedals, or the throttle on RT alone) or a button, which counts as the trigger fully pressed.

A button can also be an axis pushed past half its travel (a clutch pedal as a button, say); **Other side** turns which half counts.

**Games see** chooses an Xbox 360 controller (what nearly every PC game and emulator expects) or a DualShock 4 (for an emulator or game that prefers a PlayStation pad). On a DualShock 4, A is Cross, B Circle, X Square, Y Triangle, the bumpers are L1 and R1, Back is Share and Start is Options.

## Starting and stopping

- By hand: **Start** beside a profile on the page, **Start virtual controller** in the command palette (Ctrl+K), or the **Virtual controller** entry of the tray menu. It runs until you stop it or quit RigReady.
- **Hide the real controllers from games while it runs** (on the page) uses HidHide. RigReady keeps its own controller reader allowed to see them, so the virtual controller keeps working.
- While one runs, a small strip in the corner of every screen, the Play screen included, says which, with **Stop**. The tray's tooltip says "virtual controller on" and its menu has **Stop the virtual controller**.
- The panel at the top of the page says which profile is on and what drives it, and shows the live picture of what the game is being sent: move the stick or press a button to see it there. The row of the running profile says "It is running now" and its **Start** is off.

![The running panel with the live picture](../../../artifacts/screens/virtual-controller-launch/02-running.png)

When RigReady quits, or stops in any other way, the virtual controller goes with it. Controllers it hid are shown to games again when it stops; if RigReady was ended before it could do that, it does it when it starts next.

## In a setup

Add the step **Start a virtual controller** to a setup's [steps before launch](../setups/launch.md) and choose your virtual controller from the list, by name. If you want, turn on **Hide controllers**. Two virtual controllers of the same name are told apart in the list: each line says what the controller is made of, and its id (shown on its row on the Virtual controller page and at the top of its editor, such as `my-hotas`). A new setup for a game that reads a gamepad offers the step by itself; see [Creating a setup from the rig](../setups/capture.md#before-launch). Make ready and launch then starts it before the game, so the game finds it when it starts. [Stand down](../play/stand-down.md) stops a virtual controller that a setup started and shows hidden controllers again. A step **Stop the virtual controller** exists for a setup's Stand down steps too.

The check **Virtual controller driver installed** fails on a PC without the driver, with the steps to install it.

![Started by a setup](../../../artifacts/screens/virtual-controller-launch/01-launched.png)

## In an emulator

Start the virtual controller first, then the emulator, and map it once in the emulator:

- **PCSX2** (PlayStation 2): Settings > Controllers, port 1, choose the "XInput" or "SDL" device for the Xbox 360 controller (or the DualShock 4 through SDL), then **Automatic Mapping**.
- **DuckStation** (PlayStation 1): Settings > Controllers, Controller Port 1, **Automatic Mapping** with the "XInput-0" or "SDL-0" device. For a driving game, an Analog Controller (DualShock) or the NeGcon type gives steering on the left stick.
- **Dolphin** (GameCube, Wii): Controllers > Standard Controller > Configure, Device "XInput/0/Gamepad", then map each button.
- **RetroArch**: Settings > Input > Port 1 Controls, device "XInput Controller (User 1)"; the Xbox layout is mapped by itself.

Hide the real controllers too if the emulator picks your stick as player 1.

## Anti-cheat and online play

Ace Combat 8 uses Easy Anti-Cheat online. Nothing has been reported of it refusing a virtual controller made with ViGEmBus, and RigReady changes nothing in the game itself, but try it offline first. Anti-cheat in some other games (EA's, for one) blocks virtual controllers; when a game refuses to start or warns you, stop the virtual controller.

## What RigReady does not do

- It never installs or updates a driver, and never asks for administrator rights.
- It does not change HidHide's own settings beyond what it added, takes away exactly what it added, and refuses to hide anything in HidHide's inverse mode.
- It plugs in one virtual controller at a time.
- Force feedback and rumble from the game are not passed back to your wheel or stick.
