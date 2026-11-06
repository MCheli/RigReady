---
title: The app itself
description: Where RigReady keeps its own data and logs, how to move that folder, and the pages about settings, updates, the command palette, diagnostics and privacy.
order: 100
---

Everything RigReady keeps for itself lives in one folder, and everything it does to your PC is described in this section: its settings, how it updates itself, the command palette and the keyboard, where its log is, what leaves the PC, and how to remove it.

Nothing here touches your games. For what RigReady does to game files, see [protect your configuration](../protect/index.md).

## The data folder

RigReady's data folder is `~/.rigready`: the folder `.rigready` in your Windows user folder, normally `C:\Users\<you>\.rigready`. The manual writes it as `~/.rigready` throughout. **Configure > Diagnostics** and the **About** panel (the version number at the top right) both show the exact path.

To keep the data somewhere else, set the environment variable `RIGREADY_HOME` to the folder you want before starting RigReady. Everything below then goes there instead.

What is in it:

| Folder or file | What it holds |
|---|---|
| `profiles\` | Your setups, one YAML file each. You may edit them by hand; see [setups as YAML](../setups/yaml.md). |
| `settings.json` | The [settings](settings.md). |
| `displays\layouts.json` | Your saved monitor layouts. |
| `backup\` | The [Always back up](../protect/tracked-files.md) list, the backup preferences, the [snapshot](../protect/snapshots.md) index, the [what changed](../protect/what-changed.md) records, and the stored file contents they share. |
| `backups\` | The [backup files](../protect/backups.md) you made, as zip files, and under `backups\auto` the automatic copies of every file RigReady changed. |
| `journal.jsonl` | The change journal the [Safety page](../protect/safety-page.md) reads. |
| `logs\rigready.log` | The log, with up to four older files beside it (`rigready.log.1` and so on); each is at most 5 MB. |
| `secrets\` | The Anthropic API key, encrypted for your Windows account. |
| `window.json`, `panels.json`, `state.json` | Where the window and the pop-out panels were left, and which [setup was used last](../play/switching-setups.md). |

The program itself is installed under `%LOCALAPPDATA%\Programs\RigReady`, and a downloaded update waits in `%LOCALAPPDATA%\rigready-updater` until it is installed.

## Pages in this section

- [Settings](settings.md): every setting, section by section.
- [Updates](updates.md): how RigReady updates itself, and when it never does.
- [The command palette](command-palette.md): Ctrl+K, every page and the common actions.
- [Keyboard shortcuts](keyboard-shortcuts.md): the whole list.
- [Text size](text-size.md): larger, smaller, full screen.
- [Diagnostics](diagnostics.md): the log, the report with personal details removed, where to report a problem.
- [Privacy](privacy.md): what leaves the PC, and what never does.
- [Uninstall](uninstall.md): removing RigReady, with or without its data.
