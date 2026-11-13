---
title: iRacing bindings
description: Every action in iRacing and what it is bound to, for all cars and each car, binding an action to a button or a key, and the control profiles.
order: 15
---

The iRacing bindings page lists every action iRacing has, bound or not, and what is bound to it. It reads the file iRacing itself uses: the control profile iRacing loads, or on an older iRacing, `controls.cfg` in `Documents\iRacing`. It can also bind an action to a controller button or a key, or clear a binding, one at a time; see [Changing a binding](#changing-a-binding).

Open it with **Configure > Bindings** and choose **iRacing** in the **Game** picker above the page, or with [the command palette](../app/command-palette.md): press **Ctrl+K** and type "iRacing bindings". Bindings opens the game you looked at last, so the next time it is iRacing straight away.

![The iRacing bindings page, with the bindings for all cars](../../../artifacts/screens/iracing-bindings-all-cars/01-all-cars.png)

## Where iRacing keeps its bindings

Since 2026 Season 3, iRacing keeps bindings in **control profiles**, each a folder under `Documents\iRacing\profiles\controls` with its own `controls.cfg` and `joyCalib.yaml`. The first time a newer iRacing starts, it copies your bindings into a profile called "Baseline", and `app.ini` says which profile it loads. From then on iRacing reads the profile and leaves the older `Documents\iRacing\controls.cfg` as it was.

RigReady reads the profile `app.ini` names, and says so beside **Bindings for**: "iRacing keeps bindings in control profiles. It uses the profile “Baseline” for all cars." When the older `controls.cfg` is still there, the same line says that iRacing does not read it any more, so the page does not show it. The older files are read only on an iRacing from before control profiles, which has no `profiles` folder.

![The bindings of the control profile iRacing uses](../../../artifacts/screens/iracing-bindings-profiles/01-profile.png)

## Which bindings you are looking at

**Bindings for** chooses the set. **All cars** is the file every car uses unless it has its own.

- On an iRacing with control profiles, a car is in the list when you gave it a profile of its own in iRacing's Options. `app.ini` names the car only by iRacing's short name for it, so that is what the list shows, with the profile: for example "cadillacctsvr (profile “Test Profile CTSV”)" for the Cadillac CTS-V. When two or more cars use the same profile, each is listed with the others named, because a change for one of them is a change for all of them; the review before saving and the message after it name every car it reaches.
- On an older iRacing, a car is in the list when its folder under `Documents\iRacing\setups` holds a `controls.cfg`, which iRacing writes when you tick "Use custom controls for this car". Such a car shows as its folder name with "(custom controls)", for example "mx5 mx52016 (custom controls)".

![A car with a control profile of its own](../../../artifacts/screens/iracing-bindings-profile-car/01-car-profile.png)

The line under the field says how many cars have bindings of their own. The path of the file being shown is at the bottom of the page. The address of the page keeps the chosen car, so opening the page again by its address shows the same car.

## Control profiles

On an iRacing with control profiles, **Control profiles** lists every profile folder under `Documents\iRacing\profiles\controls`. The one iRacing uses for all cars is marked **All cars**, and each profile says which cars `app.ini` gives it, by iRacing's short name for the car ("Car with this profile: cadillacctsvr."). A profile no car uses says so. A line of `app.ini` that names a profile with no folder is listed as **Not on this PC**, because iRacing cannot load it either. You choose and make profiles in iRacing itself: **Options**, then **Controls**.

![The control profiles, and which cars use them](../../../artifacts/screens/iracing-profiles-copy/01-profiles.png)

### Copying bindings between profiles

**Copy bindings between profiles** copies buttons and keys from one profile into another, for example the bindings you added to a car's profile back into the one for all cars.

1. Choose **Copy from** and **Into**. The box lists every action whose button or key differs between the two, with what each profile has, and says how many are the same in both.
2. Each action where the first profile has a button or a key is ticked. Where the first profile has nothing, copying would clear the binding in the other; such an action says so and is not ticked until you tick it. **Tick all** and **Tick none** do what they say.
3. Press **Review copying**. RigReady shows the file that will change before anything is written.
4. Press **Copy**. RigReady backs up the profile's `controls.cfg`, changes the ticked actions and nothing else in it, and reads the file back before it says what it copied. The profile you copy from is not changed. The copy is one entry on the [Safety page](../protect/safety-page.md), with **Undo**.

![Choosing what to copy](../../../artifacts/screens/iracing-profiles-copy/02-copy-choose.png)

![The file that will change, before anything is written](../../../artifacts/screens/iracing-profiles-copy/03-copy-review.png)

Some bindings are left as they are, under **Left as they are**, each with the reason:

- An axis, in either profile, and the calibration in `joyCalib.yaml`. iRacing calibrates an axis as it binds it, so bind axes in iRacing.
- An action the other profile does not have (a profile made by an older iRacing has fewer actions).
- A binding RigReady cannot read exactly, or a key RigReady has no name for.

As with any change here, close the iRacing simulator first. While it runs, the box says so and **Copy** is not offered.

![While iRacing runs, nothing is copied](../../../artifacts/screens/iracing-profiles-copy/05-iracing-running.png)

### A setup that switches the profile

A setup can make iRacing use a profile for all cars while you play with it: add the check **iRacing control profile** to the setup and choose the profile ([Checks and fixes](../setups/checks.md#iracing-control-profile-iracing-bindingscontrolprofile)). **Make ready** then sets that profile in `app.ini`, and **Stand down** puts back the one that was there before.

![The setup before Make ready](../../../artifacts/screens/iracing-profiles-switch/01-not-ready.png)

![After Make ready](../../../artifacts/screens/iracing-profiles-switch/03-made-ready.png)

![Stand down puts the profile back](../../../artifacts/screens/iracing-profiles-switch/05-stood-down.png)

Nothing is written while the iRacing simulator runs: it writes `app.ini` when it closes and would put its own profile back. Make ready then says so, and Stand down says so and tries again the next time.

## The controllers

**Controllers and keyboard in this set** lists every controller the file names, and the keyboard, each with the number of actions bound on it. A controller shows the name you gave it on the [Devices page](../hardware/devices.md), or the name iRacing stored in `joyCalib.yaml`, or its USB ids when nothing else knows it. Each controller has a state:

- **Connected**: the controller the file names is attached now.
- **New Windows id**: no controller has the stored id, but one of the same model is attached. iRacing will treat it as new. **Point iRacing at the new id** opens the repair on the [iRacing page](iracing.md).
- **Not connected**: no controller of that model is attached. The page says how many bindings do nothing until it is plugged in.
- **Cannot tell**: Windows did not list the connected controllers.

Above the list of actions there is a button for each of them; it shows only the actions bound on that device.

![A wheel that Windows gave a new id](../../../artifacts/screens/iracing-bindings-moved-wheel/01-new-windows-id.png)

## The list of actions

The list has every action in the file, in four groups: Driving, In-car adjustments, Cameras and replay, and Interface and chat. Each row has the action in plain words with iRacing's own id next to it, what is bound ("Accelerator", "Button 13", "Wheel Axis, turning right", a key with its modifiers) and the device. An action with nothing bound says "Not bound". The heading counts the actions, the bound and the not bound.

- The field **Find an action, a button or a key** searches the name, iRacing's id, the input and the device.
- **Not bound** shows only the actions with nothing bound.
- For a car, **Differs from All cars** shows only what that car changes, and the column **All cars has** shows what the same action is bound to for every other car.

![Searching the list](../../../artifacts/screens/iracing-bindings-all-cars/04-search.png)

![A car with custom controls, and what it changes](../../../artifacts/screens/iracing-bindings-car/02-car-differs.png)

If a file holds a kind of binding RigReady has not seen before, the row says "A binding RigReady cannot read", and the heading counts such rows. Nothing is guessed.

## Inputs that do more than one thing

**Inputs that do more than one thing** lists every button, axis or key that is bound to two or more actions in the set you are looking at. A wheel button that does two things comes first. iRacing's own defaults give several keys a second job in its camera editor; those are counted in one line and shown with **Show them**, because they do not clash while you drive.

![An input that does two things](../../../artifacts/screens/iracing-bindings-all-cars/07-shared-inputs.png)

## The cheat sheet

**Cheat sheet** opens the [cheat sheets](../controls/cheat-sheets.md) for iRacing with the set you were looking at.

## Changing a binding

Every action that takes a button or a key has **Change** in the last column. A button and a key bound this way were used by iRacing 2026.11.02.01 in a test drive on 13 November 2026, and the notice at the top of the page says so.

![The notice, and Change on each action](../../../artifacts/screens/iracing-bindings-all-cars/03-editing-notice.png)

1. Press **Change** on the action. The box shows the action, the set it is in, and what it has now.
2. Press **Press the button or the key**, then press a button on any controller, or a key with or without Shift, Ctrl and Alt. **Esc** stops listening.
3. RigReady shows what will change: what the action has now, what it would have, whether it is for all cars or one car, the file, and every other action the same button or key already does. Nothing is written yet. Pressing the button again, or holding it, changes nothing.
4. Press **Save in iRacing’s file** to write it, or **Cancel** to leave everything as it was. RigReady backs up the whole file first, changes that one action and nothing else, and reads the file back before it says "Saved". Each change is one entry on the [Safety page](../protect/safety-page.md), with **Undo**.

![What will change, before anything is saved](../../../artifacts/screens/iracing-bindings-edit-profile/02-review-before-save.png)

**Clear this binding** in the same box removes a binding, with the same review first.

The action you just saved stays in the list with its new binding, even when the search or a filter would now hide it (with **Not bound** on, an action you just bound is no longer "not bound"). It goes when you change the search or a filter.

![A row just saved stays in sight under Not bound](../../../artifacts/screens/iracing-profiles-kept-row/01-kept-under-not-bound.png)

Some things stay with iRacing, and the page says so where they come up:

- An axis: iRacing calibrates an axis as it binds it. An action on an axis shows "In iRacing" instead of **Change**.
- A hat switch, and the number pad keys.
- A binding RigReady cannot read.

Close the iRacing simulator before you change a binding: it writes its own bindings when it closes and would undo the change. While it runs, the page says so and **Save** is not offered. Changes go into the file iRacing reads: the control profile for all cars, or a car's own set when you chose that car. The older `controls.cfg` beside a profile is never written.

The other change RigReady makes to these files is the repair of a wheel with a new Windows id, on the [iRacing page](iracing.md). It replaces one id with another of the same length, backs the files up first, and says in its own dialog that it has not yet been verified on real hardware. It changes the older `controls.cfg` files, not a control profile.

## When there is nothing to show

- On a PC without iRacing the page says "iRacing was not found on this PC" and links to the iRacing game page.
- When iRacing is installed but has not written a `controls.cfg` yet, the page says "iRacing has no bindings file yet". Set up your controls in iRacing once, and the page fills in.
- When iRacing keeps control profiles but `app.ini` names none for all cars, or names one that has no `controls.cfg`, the page says it cannot tell which bindings iRacing uses and shows no list, not even a car's own profile. It never shows the older `controls.cfg` in their place, because iRacing does not read it.
- A file that is damaged or cut short is refused with a plain message, and nothing of it is shown.

![A PC without iRacing](../../../artifacts/screens/iracing-bindings-not-here/01-not-on-this-pc.png)
