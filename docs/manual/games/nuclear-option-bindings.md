---
title: Nuclear Option bindings
description: What each control does in Nuclear Option, per device, as the game saved it; binding buttons, axes and keys, clearing a controller; cheat sheets.
order: 66
---

The Nuclear Option bindings page shows what the game has bound on each controller, on the keyboard and on the mouse. RigReady reads this from what the game itself saved. It can bind a button or an axis of a controller, or a key of the keyboard, to an action, move it or clear it, and clear everything on one controller at once; a mouse button is bound in the game's own Settings, then Controls.

Open it with **Configure > Bindings** and choose **Nuclear Option** in the **Game** picker above the page, or with [the command palette](../app/command-palette.md): press **Ctrl+K** and type "Nuclear Option bindings".

![The Nuclear Option bindings page, on the throttle](../../../artifacts/screens/nuclear-option-bindings/01-throttle.png)

## Where the game keeps its bindings

Nuclear Option keeps its settings and bindings in the Windows registry, under `HKEY_CURRENT_USER\Software\Shockfront\NuclearOption`, not in files. It writes them the first time it runs. Until then the page says that the game has saved no bindings yet.

The game has one set of bindings for every aircraft, so there is no aircraft to choose.

## What the page shows

A button for each device the game has bindings for, with the number of bindings on it: the controllers first, plugged-in ones before the others, then the keyboard and the mouse. Choose one to see its bindings:

| Column | What it is |
|---|---|
| **Action** | The action by the name the game's controls screen gives it. Where a button or a key drives one side of an axis, it is that side's name: "Zoom In", "Pitch Down". |
| **Group** | The heading the game lists the action under: Flight Controls, Camera Controls, Gameplay. A binding from another tab of the game's screen (Chat, Mission Editor, Debug) names the tab too. |
| **Input** | The control in RigReady's words, the same as on the cheat sheets and in the input tester: "Button 5", "Y axis", "Ctrl + Shift + E". An axis the game reverses says "reversed". |
| **In the game** | The same input as the game's own screen shows it. |

The game counts a controller's buttons from 0, and RigReady, like Windows, from 1. So the game's "Button 4" is Button 5 here.

**Find an action or input** narrows the list: every word you type must be in the action, its group or the input.

![The stick's bindings, narrowed to "target"](../../../artifacts/screens/nuclear-option-bindings/02-stick-search.png)

A controller that is not plugged in is still listed, marked **Not plugged in**. Its axes are then named in the usual order (X, Y, Z, then the rotations), because RigReady cannot ask the controller for their names.

![The keyboard's bindings](../../../artifacts/screens/nuclear-option-bindings/03-keyboard.png)

## Binding a controller's buttons and axes

Close Nuclear Option first: the game reads its bindings when it starts and saves them itself, so RigReady refuses the change while the game runs, and says so.

- **Change** on a row moves that action to another button, or another axis, of the same controller.
- **Clear** on a row takes the binding away.
- **Bind an action** above the list binds an action that has none on this controller: choose the action, then the button or the axis.

An axis action is offered three ways, as on the game's own controls screen: as a whole, for an axis of the controller ("Zoom View"), and by each of its two sides, for a button each ("Zoom In", "Zoom Out").

Press the button on the controller, or type its number: the one on the controller's [cheat sheet](../controls/cheat-sheets.md) and in the **Input** column (the first button is 1). A press on another controller is not taken; the dialog says which controller it was. A controller that is not plugged in can only have the number typed. RigReady shows the change before anything is written: what the action is on now and will be on, anything else that button already does ("One press will do both"), and the saved bindings it will change. Only **Save** writes.

![The review before a binding is saved](../../../artifacts/screens/nuclear-option-bindings-edit/01-review.png)

RigReady copies the saved bindings of that controller first. The change is one entry on the [Safety page](../protect/safety-page.md), named for example "Nuclear Option bindings: Toggle Navigation Lights bound to Button 12 on Joystick - HOTAS Warthog", and **Undo** there puts the bindings back as they were. Undo is refused when the game has changed them again since, so that it cannot throw away something you did in the game.

![The changes on the Safety page](../../../artifacts/screens/nuclear-option-bindings-edit/04-safety-page.png)

The game picks the change up the next time it starts; its own controls screen then shows it. The game counts buttons from 0, so Button 12 here is "11" there.

### An axis

For an axis action the dialog asks for the axis instead of a button. Move the axis on the controller, or choose it in the list; the names are the ones on the controller's cheat sheet and in the **Input** column ("X axis", "Z rotation"). Tick **Reversed** to have the game turn it round. **Change** on an axis row opens on what the action has, so that reversing an axis is one tick. The review says what else that axis already does: one movement will do both.

![An axis chosen by moving it](../../../artifacts/screens/nuclear-option-bindings-axes/02-moved.png)

A controller that is not plugged in has its axes listed in the usual order (X, Y, Z, then the rotations and two sliders), because RigReady cannot ask it for their names.

### A key

On the **Keyboard** tab, **Change**, **Clear** and **Bind an action** work on keys. Choose the key in the list, or press **Press the key** and then the key itself; tick **Ctrl**, **Alt** or **Shift** for a key that is held with them (pressing the key with them held ticks them for you). The review says what else that key, with those modifier keys, already does. An axis action is bound on the keyboard by its two sides (Pitch Up, Pitch Down), a key each; the axis as a whole is for a controller.

![A key chosen by pressing it](../../../artifacts/screens/nuclear-option-bindings-keys/01-pressed.png)

The game shows two keys for an action on its controls screen. RigReady binds one: changing an action that has two replaces both with the one you choose, and the review lists both under what it has now.

The keys RigReady can bind are the letters and digits, the numeric keypad, F1 to F12, the arrows and the keys above them, Space, Enter, Tab, Backspace, Esc, Delete, the punctuation keys of a US keyboard, and Shift, Ctrl and Alt on either side. For another key it says that it does not know how the game numbers it.

What RigReady will not do here, and says so when asked: bind a mouse button; bind half an axis to one side of an action; bind a hat switch; change a binding it does not understand, such as an axis the controller does not report; bind anything on a controller the game has saved no bindings for yet.

## Clearing a controller

The first time Nuclear Option sees a controller it binds its own defaults to it: pitch and roll on the first two axes, Fire on the first button, and so on. It does that for every controller, so a button box, a panel or a set of racing pedals ends up flying the aircraft too. **Clear all**, beside **Bind an action**, takes every binding off the controller you are looking at: its buttons and its axes, in every tab of the game's controls screen.

Close the game first, as for one binding. RigReady shows how many bindings will go and which saved bindings it will change; nothing is written until you press **Clear all** in that dialog. Your other controllers, the keyboard and the mouse are not changed.

![The review before a controller is cleared](../../../artifacts/screens/nuclear-option-bindings-clear-all/01-review.png)

It is one entry on the [Safety page](../protect/safety-page.md), named for example "Nuclear Option bindings: all 8 bindings cleared on Throttle - HOTAS Warthog", and **Undo** there puts every one of them back.

![A controller with nothing bound](../../../artifacts/screens/nuclear-option-bindings-clear-all/02-cleared.png)

The game leaves a cleared controller alone: at its next start its controls screen shows the controller with nothing bound, and it does not put its defaults back. The controller stays in the game's list, so you can bind it again there or here. **Restore Defaults** in the game binds every controller again.

## Cheat sheets, the trainer and the overlay

The same bindings are what the [cheat sheets](../controls/cheat-sheets.md) draw for Nuclear Option, what the [trainer](../controls/trainer.md) asks, and what the [overlay](../play/overlay.md) names when you press a control. **Cheat sheet** at the top of the page opens the sheet.

![A cheat sheet with Nuclear Option's bindings](../../../artifacts/screens/nuclear-option-bindings/04-cheat-sheet.png)

## What RigReady does not do

- **Bind a mouse button or a hat switch.** Those are bound in the game.
- **Put the bindings back from a backup.** Every full backup keeps the game's registry values, bindings included, as a record you can read on the backup's page ([Backups](../protect/backups.md)). RigReady cannot write them back to the registry, so a restore does not include them.
- **Show a binding on a hat switch by its direction.** How the game saves one is not known to RigReady yet; such a binding may be shown as a button.
- **Know an action a game update added.** It is listed as "Action" and its number until RigReady learns its name.

When the game saved a map RigReady cannot read, the page says so above the list and shows the rest.
