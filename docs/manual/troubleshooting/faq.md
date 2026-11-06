---
title: Questions and answers
description: Short answers about administrator rights, what RigReady changes, using it without DCS, several PCs, where the data is, internet use and the licence.
order: 90
---

Short answers to the questions people ask first. Each links to the page with the detail.

## Does it need administrator rights?

No. The installer installs for your user only and never asks for elevation, and RigReady runs as a normal program. The few things that need rights, such as HidHide's own configuration, RigReady does not do; it tells you what to do in the tool that has them. See [install](../getting-started/install.md).

## Does it change my game files?

Only when you ask it to, and never without a copy first. A [restore](../protect/restore.md), a binding edit, a file written for [DCS](../dcs/index.md): each is saved first, recorded on the Safety page, and can be undone there. RigReady writes its own `RigReady.lua` for DCS screens rather than editing a file you made, manages Export.lua one line at a time, and replaces only the kneeboard pages it wrote itself. It refuses to write DCS files while DCS is running. See [the Safety page](../protect/safety-page.md).

## Can I use it without DCS?

Yes. The [Play screen](../play/index.md), setups, checks, monitors, audio, backups, devices and the [input tester](../hardware/input-tester.md) work for any game. The racing games have their own pages, and any other game works with a setup of its own: a checklist, a launch target and tracked files. The DCS pages simply say DCS was not found. See [games](../games/index.md).

## Can I use it on several PCs?

Each PC has its own RigReady and its own data. To carry things across, make a backup on one and restore it on the other, or share a setup as a `.rigready` file. There is no sync and no account. See [moving to a new PC](../protect/new-pc.md) and [share a setup](../protect/sharing.md).

## Where is my data?

In `~/.rigready`, the folder `.rigready` in your Windows user folder, or wherever `RIGREADY_HOME` points. Setups are YAML files you may edit. See [The app and its data folder](../app/index.md).

## Does it need the internet?

No. It uses the network only to check for [updates](../app/updates.md), which you can turn off, and for [AI help](../dcs/binding-guide-and-ai.md), which needs your own key and your approval of every request. See [privacy](../app/privacy.md).

## What does "not yet verified on real hardware" mean?

A few features passed their tests on recorded data from one rig but have not been tried in the real game or on the real device yet. The app marks them, and the [changelog](../../../CHANGELOG.md) lists them under known limitations: a [binding written by RigReady](../dcs/bindings.md) checked in DCS's own controls screen, [MFD displays](../dcs/screens.md) drawn by DCS from RigReady's monitor setup with SimAppPro closed, the [iRacing device ID repair](../games/iracing.md) with a wheel whose ID really changed, [restoring a Stream Deck backup](../hardware/stream-deck.md) file by file, the [taskbar](../one-click/taskbar.md) badge and buttons on a real taskbar, the [ready tone](../play/the-menu.md)'s sound and a real press of the [hotkey](../one-click/hotkey.md). They work as far as tests can tell; treat them with a little more care.

## Is it free?

Yes. RigReady is open source under the MIT licence. The About panel, from the version number at the top right, has the licence and the links to the website, the source code and where to report a problem.

## Which Windows?

Windows 10 and 11, 64-bit. Nothing else.

## Can I edit a setup by hand?

Yes. Each setup is a YAML file in `profiles` under the data folder; the [Setups page](../setups/index.md) has **Open file**. A file with a mistake is listed apart with the line and the reason, and does not affect the others. See [setups as YAML](../setups/yaml.md).
