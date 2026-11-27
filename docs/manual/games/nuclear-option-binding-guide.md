---
title: Binding guide for Nuclear Option
description: One guide for every aircraft in Nuclear Option: what to bind first, a walkthrough that binds buttons, axes and keys, and a setup suggested by AI.
order: 67
---

**Configure > Binding guide** explains what matters when you fly Nuclear Option, in plain language and in priority order, and walks you through binding it. The page is in the menu when DCS World, iRacing or Nuclear Option is found on this PC. Choose **Nuclear Option** in the **Game** picker at the top. Nothing on the Walkthrough and Priorities tabs needs an AI key.

The guides for DCS aircraft and for iRacing are described in [Binding guide and AI help](../dcs/binding-guide-and-ai.md) and [Binding guide for iRacing](iracing-binding-guide.md).

![The walkthrough for Nuclear Option](../../../artifacts/screens/ai-assist-nuclear-option/01-walkthrough.png)

## One guide for every aircraft

Nuclear Option has one set of bindings for every aircraft, so there is one guide, **All aircraft**, and nothing to choose. It has thirty items in three tiers:

| Tier | What is in it |
|---|---|
| **Must have to fly and fight** | Pitch and roll, yaw, the throttle, Fire, selecting and cancelling a target, the next weapon, countermeasures, the landing gear and the brakes. |
| **Should have** | The radar, the choice of countermeasure, the previous weapon, the map, the radial menu and the weapon wheel, flight assist, zoom, free look, night vision and Eject. |
| **Nice to have** | The engine, the navigation lights, linking the guns, the turret, looking at the target, the game's extra axis, and what is fine on the keyboard: the view, pause, slow motion and chat. |

Each item has a title, what it does, when you use it, where it belongs (**On the stick, throttle or pedals**, **On a panel or button box**, **Fine on the keyboard**), and the game's actions it stands for, each with a plain name and the name the game's own controls screen gives it.

The guide was written from general knowledge of the game and from the names on its controls screen (Early Access 0.34.6). It has not been reviewed by the game's developers or by an experienced player, and it is not affiliated with Shockfront Studios. What is checked, by a test, is that every action the guide names is one RigReady reads from the game. **Where this guide comes from** at the bottom of the Priorities tab says the same.

## What is bound

The guide reads what the game saved, the same bindings the [Nuclear Option bindings page](nuclear-option-bindings.md) shows; **See them all** at the top opens that page. An item is **Bound** when the game has it on a controller (or anywhere, for an item that is fine on the keyboard), **Partly bound** when some of its actions are, and **Not bound on a controller** otherwise. The **Priorities** tab shows the whole guide at a glance, with a plan for the stick, the throttle, the pedals, a panel and the keyboard.

![The priorities for Nuclear Option](../../../artifacts/screens/ai-assist-nuclear-option/06-priorities.png)

## Binding from the walkthrough

The walkthrough goes through the items one at a time. Close Nuclear Option first: the game reads its bindings when it starts and saves them itself, so RigReady saves nothing while it runs, and says so.

Press **Bind** beside an action, then use the control you want for it:

- **A button of a controller, or a key**, for an action that is a button, and for one side of an axis (Zoom In, Apply Brakes). A key can be held with Ctrl, Alt or Shift; Esc stops waiting.
- **An axis of a controller**, for an axis: move the stick, the lever or the slider. In the review, tick **Reversed** to have the game turn it round.

RigReady shows the change before anything is written: the device, what the action is on now and will be on, anything else that control already does ("one press does both"), and the saved bindings it will change. **Save** writes it; **Cancel** writes nothing.

![The review before an axis is saved](../../../artifacts/screens/ai-assist-nuclear-option/02-axis.png)

The save is the same one the [Nuclear Option bindings page](nuclear-option-bindings.md) makes: the saved bindings are copied first, the change is one entry on the [Safety page](../protect/safety-page.md), and **Undo** there puts them back. The game picks the change up the next time it starts.

![The item after a button was saved](../../../artifacts/screens/ai-assist-nuclear-option/04-bound.png)

What the walkthrough says instead of offering it: an axis moved for a button action, or a button pressed for an axis, is said to be the wrong kind of control; a hat switch is said to be one, and is bound in the game. A controller the game has saved no bindings for yet cannot be bound from RigReady: start the game once with it plugged in. A key bound for an action that belongs on a controller is saved, and the item still says "Not bound on a controller".

**Done, next** and **Skip** keep your place, and the progress is saved as you go.

## AI help

With an AI provider set up in **Settings** ([Choose who answers](../ai/providers.md)), the page has an **AI help** tab for questions about your Nuclear Option setup, and each action in the walkthrough has **Explain**. Before anything is sent a dialog shows the complete request. It holds the game's list of actions with what each is bound to now, the product names and layout of your connected controllers, the guide's text and your question; no file path, device id or serial number. The answer is the model's: the guide it reads was not reviewed by anyone who plays the game, and the request says so.

### Suggest a setup

**Suggest a setup** on the **AI help** tab asks the model where each important action belongs on the controllers you have plugged in. The request is shown first, like every other. The answer comes back as a list, one binding a line, each with its reason:

![A suggested setup for Nuclear Option](../../../artifacts/screens/ai-assist-nuclear-option-suggest/02-suggestions.png)

RigReady checks every line against the game and your controllers before you see it. A line that names an action the game does not have, a controller that is not plugged in, a button or an axis the controller lacks, an axis for a button action, a hat, an action of the game's Chat, Mission Editor or Debug tab, or a second control for an action already in the list, is left out and counted under the list, with the reason. A suggestion that is bound so already is marked and not ticked. Two suggestions that want the same control are both unticked until you choose one.

A suggested binding takes its control over. If the button or the axis does something else now, the line says what, and that stops when you write the change. This differs from a single change on the [bindings page](nuclear-option-bindings.md), which leaves the other action on the control and tells you. An axis you reversed stays reversed. Only the controller's bindings for the Game tab of the game's controls screen are changed.

Tick what you want and press **Review**. The review lists, controller by controller, what each action will be on and what each control stops doing:

![The review of a suggested setup](../../../artifacts/screens/ai-assist-nuclear-option-suggest/03-review.png)

**Write the change** saves all of it as one entry on the **Safety** page, each controller's saved bindings backed up first. **Undo** on the guide page, or on the Safety page, puts every controller back. Nothing is written while Nuclear Option runs, and if the game's saved bindings changed after the review, RigReady says so and writes nothing.

A suggestion uses buttons and axes of controllers the game has saved bindings for. It does not suggest keys, hats or mouse buttons.

## What RigReady does not do here

- **Bind a hat switch or a mouse button.** Those are bound in the game, under Settings, then Controls.
- **Suggest a key, a hat or a mouse button with AI.** A suggested setup uses buttons and axes of your controllers.
- **A guide of your own.** RigReady uses the guide it includes; importing or writing one is for a DCS aircraft or an iRacing car without a guide.
- **Plain names on the cheat sheets.** The game's own action names are already plain, so the cheat sheets keep them.
