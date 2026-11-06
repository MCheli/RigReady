---
title: The command line
description: "RigReady.exe --launch, --make-ready and --setup: naming a setup by name or id, --hidden, what a second start does, and a Stream Deck button."
order: 50
---

Everything a desktop shortcut or a Jump List entry does can be typed, put in a batch file or given to a Stream Deck button. The program is `RigReady.exe` in the folder RigReady was installed to.

## The three commands

```
RigReady.exe --launch "DCS F/A-18C"       make the rig ready, then launch
RigReady.exe --make-ready "DCS F/A-18C"   make the rig ready, stop before launching
RigReady.exe --setup "DCS F/A-18C"        only show that setup
```

The setup comes after the flag, or after an equals sign: `--launch=dcs-f-a-18c`. One command per start: two flags at once are refused with "Use only one of --launch, --make-ready, --setup at a time." A flag without a setup opens the window with the usage line.

What each command does, step by step, is on [Starting without the window](index.md): the window comes forward, the setup is checked and becomes the one in use, every fix runs, and `--launch` starts the game only when every required check is met.

## Naming a setup

A setup is found by its id first, then by its name; capitals do not matter. The id is the file name of the setup without `.yaml`, for example `dcs-f-a-18c` for "DCS F/A-18C"; **Configure > Setups > Edit > YAML file > Show in Explorer** shows it. When two setups share a name the command stops and asks for the id: "2 setups are named "DCS". Use the id of the one you mean: dcs, dcs-2." An unknown setup stops with "There is no setup "x"" and the names of the setups on this PC.

## --hidden

`RigReady.exe --hidden` starts RigReady in the tray without showing the window. It is what **Start with Windows** uses. It is ignored when a command is given: what a command does is always shown.

## A second start while RigReady runs

Only one RigReady runs at a time. Starting `RigReady.exe` again hands its arguments to the running one and exits at once:

- With no command, the window comes forward.
- With a command, the running RigReady runs it, exactly as if it had been started with it.
- If a command is already running, or the Play screen is making ready, launching or standing down, the new command is not run; the window comes forward and shows what is going on.

So a Stream Deck button or a batch file need not care whether RigReady is already open.

## Exit codes

A start that hands over to the running RigReady exits with 0 straight away; the result of the command is on RigReady's window, not in an exit code. A first start stays running, in the tray after a launch. RigReady exits with 1 only when it cannot start at all or is not on Windows. There is no exit code that says whether the rig was ready or the game launched.

`RigReady.exe --diagnose <file>` is different: it writes a report of the machine as JSON to the file and exits, for support. It opens no window.

## Examples

A Stream Deck button: add a **System > Open** action and put the program and its argument in its field, with the id form so there is only one pair of quotes:

```
"C:\Program Files\RigReady\RigReady.exe" --launch=dcs-f-a-18c
```

A batch file on the desktop or in a macro program:

```
@echo off
"C:\Program Files\RigReady\RigReady.exe" --launch "DCS F/A-18C"
```

Replace the path with where RigReady.exe is on your PC.
