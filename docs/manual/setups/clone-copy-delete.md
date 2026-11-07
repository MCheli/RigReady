---
title: Clone, copy and delete
description: "Cloning a setup, copying checks from one setup into another, deleting a setup together with its desktop shortcut, and bringing both back from the Safety page."
order: 80
---

Setups are usually alike: the same gear, the same helper apps, a different aircraft. Rather than capturing the rig again, clone a setup or copy items between setups.

![Copying items from another setup](../../../artifacts/screens/profile-clone-copy/02-copy-dialog.png)

## Clone

**Clone** on the Setups page makes a complete copy named "<name> (copy)" with a new id, and opens it in the editor so you can give it its own name. Nothing is shared with the original: changing one never changes the other. The copy has no desktop shortcut of its own until you make one.

## Copy from another setup

In the editor, **Copy from another setup…** above the checklist opens a dialog: choose the setup to copy from, then tick the checks and the steps (before launch, after launch, at Stand down) you want. An item that is already in this setup, meaning the same kind of check with the same target (the same program, device, file, service or game), is marked "already in this setup" and skipped, unless you tick **Add items that are already here anyway**. Copied items get new ids. The dialog says what it did ("Copied 3 items from "DCS F/A-18C"; skipped 1 already here. Save to keep them."); nothing is written until you save.

## Delete

**Delete…** in a setup's menu on the Setups page asks first: "The setup is removed from RigReady, and so is its desktop shortcut when it has one. Copies are kept, and the Safety page can bring both back together. Nothing on the rig or in any game changes, and monitor layouts and backups stay." The setup's desktop shortcut goes first, when there is one (under the setup's current name or an earlier one, see [Desktop shortcut](../one-click/desktop-shortcut.md)), then the file. Both are recorded as one action, "Delete setup "<name>"", so **Configure > Safety** lists them together and one **Undo** brings both back ([Protect](../protect/index.md)). The message afterwards says whether a shortcut went with the setup. When the shortcut cannot be removed, nothing is deleted. A broken file and a file from RigReady 1 can be deleted the same way.

![The deleted setup on the Safety page](../../../artifacts/screens/profile-clone-copy/05-in-safety.png)

If the deleted setup was the one on the Play screen, the screen moves to the setup you used most recently before it, or to the first in the list when no other has been used yet ([Switching setups](../play/switching-setups.md)).

## What a delete leaves behind

- The saved monitor layouts and the backups the setup used; other setups may use them.
- The session history: sessions of the deleted setup stay in History under its name.
