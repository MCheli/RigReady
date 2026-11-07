---
title: Backups, sharing and safety
description: How RigReady keeps copies of your bindings, game settings and setups, and how to get any of them back when something goes wrong.
order: 80
---

Bindings and game settings take hours to make and minutes to lose: a game update, a reinstall, a wrong click, a new PC. RigReady keeps copies at three levels, and every change it makes to your files can be undone.

This section covers all of it: the copies RigReady makes by itself, the backups you make, snapshots of one item, the comparison with the last time a game worked, sharing a setup with other people, and moving to a new PC.

## The three layers

**Automatic copies before every change.** RigReady never writes a file outside its own data folder without first copying the file as it is into its data folder and recording the change in a journal. You do nothing for this; it happens for every restore, every binding edit, every file RigReady writes for a game. The **Safety** page lists every such change with an **Undo** button. See [the Safety page](safety-page.md).

**Backups you make.** **Back up now** on the **Backups** page puts every tracked file and every setup into one zip file that you can keep anywhere, including on another PC. A restore wizard puts any part of it back. See [backups](backups.md), [tracked files](tracked-files.md) and [restore](restore.md).

**Snapshots.** A snapshot is a named copy of one tracked item, for example the bindings of one aircraft before you rebind the throttle. You can compare it with the files as they are now, line by line, and put it back. See [snapshots](snapshots.md).

A fourth tool watches rather than copies: each time a setup's game starts, RigReady records its tracked files, so when something stops working you can see exactly [what changed](what-changed.md) since it last worked.

## What is never copied

Files that hold credentials are never read into a backup, a snapshot, a shared setup or an import, whatever folder you track: SimAppPro's config file with your WinWing account, DCS's saved login (`network.vault`, `steam_authdata.bin`), Steam sign-in files, browser password stores, private keys and certificates. They are listed as left out, with the reason, wherever they would have been included.

## Pages in this section

- [Backups](backups.md): Back up now, what a backup contains, where the files go, how many are kept, the 2 GB limit.
- [Tracked files](tracked-files.md): what is backed up, the suggestions per game and tool, adding your own files and folders.
- [Restore a backup](restore.md): the wizard, what goes where, replace, skip or keep both, closing a game first.
- [Snapshots](snapshots.md): a named copy of one item, compared and put back.
- [What changed](what-changed.md): the files compared with the last time the game started.
- [Share a setup](sharing.md): the `.rigready` file, the privacy review, importing.
- [A picture of your rig](rig-picture.md): one image of a setup to show people.
- [The Safety page](safety-page.md): every change outside RigReady's folder, with Undo.
- [Moving to a new PC](new-pc.md): the steps in order.
