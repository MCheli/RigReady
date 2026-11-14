# Changelog

## 2.0.1 (not released)

[security] A security update, and a fix for monitors turned sideways. Update now.

- Electron, which RigReady is built on, is updated to 44.11.3 for its fixes to the Chromium browser engine, among them one for a flaw Google reports is being exploited (CVE-2026-125350).
- A monitor turned to portrait had its supported sizes read turned, so a monitor layout that changes its size or refresh rate could be refused with "does not offer", although the monitor offers it. RigReady now reads the sizes the right way round in every orientation. Monitors in landscape, and layouts that keep a sideways monitor's size, were not affected.

## 2.0.0 (2026-11-13)

A rebuild from the ground up. Nothing of 1.1.0's code or update channel carries over. The setup files version 1 left in `~/.rigready` are left as they are: they are listed apart on the Setups page, where one can be brought over as a new setup from the parts that convert exactly, or deleted. RigReady 1 also left "Keep in the tray" switched off in the settings file, behind a switch nobody could use; this version ignores that value, so closing the window keeps RigReady in the tray. A 2.0 beta (up to beta 4) that saved the settings kept the off value as a choice: if closing the window quits RigReady, turn on **Keep RigReady in the tray when you close the window** once in Configure > Settings.

The first signed release. The installer, RigReady.exe and the uninstaller carry a code signature with the publisher name "Mark Cheli", issued through Microsoft's Artifact Signing service, so Windows names the publisher in its dialogs and in the file's properties. Installed copies check that signature before they install an update, and refuse one that is unsigned or signed under another name. SmartScreen may still warn the first time the installer runs, until the installer has earned a reputation with Microsoft.

### What it contains

**Play**
- One screen for the setup used last: a readiness dial, the rig drawn with its monitors and devices so a problem shows as a place, a grouped checklist, and a fix beside every failing item.
- One action, Make ready and launch (or Enter): the fixes run in order as visible steps and the game is launched once everything required is met. Make ready, Launch and Stand down are also there on their own.
- Required items make the rig Not ready; optional items only warn. Launch is never blocked, and nothing is launched past a required problem without asking.
- The session is followed: in progress, then Welcome back with Stand down as the main action. Unless the setup switches it off, Stand down then runs by itself after a countdown you can cancel; the countdown length is set for each setup. When the desk monitor layout has not yet been kept with the monitors connected now, the countdown says so and asks you to stay and press Keep it. A history of sessions says what needed fixing most often.
- Stand down and a restore ask all the processes of a helper program to close together, and name one that stays open with the reason. A restore never forces a program closed; Stand down does so only where the check allows it.
- An overlay over the game, off until you turn it on: a small see-through list of each button or hat you press and what the game does on it for the aircraft or car you are in. Each line fades after a few seconds. Once it is on, each setup has its own switch as well, so it can be up in one game and down in another; a setup starts with it on only where RigReady can read that game's bindings. You choose the screen (or "The main screen", which follows the monitor layout in use), the place, the size, the number of lines and how long a press stays; the page warns when the chosen monitor is off in a setup's layout. It is a window on a monitor, not inside a VR headset.
- A compact view that stays on top, a quiet offer to switch when the gear plugged in fits another setup, an optional ready tone.
- One double-click: a desktop shortcut per setup, `RigReady.exe --launch "<setup>"` (also `--make-ready` and `--setup`), a taskbar Jump List, a status badge, progress and three buttons on the taskbar button, an optional global hotkey.
- Tray icon with the same actions; optional start with Windows.

**Setups**
- Created by capturing the rig as it is now: game, devices, apps, monitor layout, audio devices, game files.
- A setup launches its game as a program, through Steam, or not at all. A new setup proposes the helper apps that go with its game, and an app RigReady does not know can be offered in every new setup ("Always offer this app").
- A full editor, clone, copy items between setups, hand-editable YAML that a broken file cannot take down.
- A setup left by RigReady 1 can be brought over as a new setup: the parts that convert exactly are brought, and each part left out is named before anything is written. The old file is only read.

**Checks and fixes**
- Device connected (identical devices told apart), app or service running, monitor layout, default audio device, config file present or containing a value, script, game updated since last verified, device hidden by HidHide.
- Fixes: start an app, apply a monitor layout with a timed revert, set the audio device, restore a file, run a script, show instructions.

**Monitors and audio**
- A to-scale map, named layouts, Identify with numbers and an up arrow on every screen, position, rotation, on/off, main display, resolution and refresh rate. Applying a layout shows the map moving from before to after.
- A layout applied by hand asks whether to keep it, and goes back by itself without an answer. Make ready and Stand down ask only the first time a layout is used on this PC; once it is kept, they apply it at once and still read it back.
- Identical USB screens are recognised by the serial number of their USB device.

**DCS World**
- Installs across Steam libraries and standalone; update waiting; aircraft list.
- MFD screen setup written to RigReady's own MonitorSetup file, starting from SimAppPro's plan when there is one; without SimAppPro, for every installed aircraft that can export a display, read from the aircraft's own files. An aircraft or a display RigReady did not find can be added by name. When **Use in DCS** changes DCS's window, it offers to update the setups that still expect the old one, naming each and what changes, in one action you can undo; a setup left as it was says so on the Play screen, and "Set the DCS options" asks before it would undo the screen setup in use.
- Export.lua managed one tool at a time; overwrites by other programs are noticed.
- Bindings for every DCS aircraft: effective bindings (defaults plus your changes), editing with a preview, clean-up of unwanted defaults, device ID repair, copy between aircraft, snapshots. Binding the kneeboard button says when its pages cannot be turned from a controller, and offers to bind those next. Binding guides and curated priority lists exist for the aircraft listed in the manual.
- Cheat sheets of what every control does, print and PDF, DCS kneeboard pages in day and night styles, and a trainer that names an action and has you press the control. A throttle stop or a switch position counts once it has been there a moment, and you leave it there; a missed card comes back at the end of the round.
- Simple outline drawings, each control placed by its button number: the WinWing Orion stick (ViperAce F-16EX and F/A-18 grips), the Orion throttle with the F-15EX handles, the MFD frames, the UFC with its HUD, the ICP, the startup panel and take-off panel 2, and the Thrustmaster HOTAS Warthog stick and throttle, the T.16000M and the TWCS throttle. Each has a label block and leader line per control, placed so that no two lines cross. The ViperAce grip, the F-15EX throttle and take-off panel 2 (its brake and wing fold handles included) were checked against presses on a real rig, and a drawing knows where a control rests, such as a throttle at IDLE. A press on a control the drawing does not show is listed under "More controls". The Saitek / Logitech X52 Pro has its controls named, without a drawing. A drawing can be corrected or shown over a photo of the device. For any device, a sheet can be made from your own photos (press a control, then click where it is) or imported from a file; the photos stay on this PC. The outlines are schematic and cover only these devices so far; a photo gives a picture that looks like your own.
- Twenty binding guides for DCS, covering the F/A-18C, F-16C, A-10C II and A-10C, A-10A, F-14 (pilot and RIO), F-15E (pilot and WSO), F-15C, MiG-29, Su-27 and J-11A, Su-33, Su-25T, Su-25, Ka-50 III and Ka-50, UH-1H, P-51D, TF-51D, F-86F and Christen Eagle II. For any other aircraft you can import a guide file or write your own, with no AI key, or have optional AI help draft one.
- Optional AI help with your own key from Anthropic (the default), OpenAI, or any OpenAI-compatible service: presets for Google Gemini, OpenRouter, Mistral, and Ollama and LM Studio on your own PC. Each provider keeps its own encrypted key, gets a Test button and a model you can type, and only its one host is contacted (https, or http to this PC only).


**AI assistants**
- An MCP server inside RigReady, off by default, so that an assistant on the same PC (Claude Desktop, Claude Code, Cursor, VS Code and other MCP clients) can check the rig, make it ready, read and change bindings with a preview, apply a monitor layout, make a backup, read the log and read the manual. `RigReady.exe --mcp` connects assistants that start a program; others pair from Settings.
- Connect an assistant with one button: Settings > AI assistants lists the assistants found on this PC (Claude Desktop, LM Studio, AnythingLLM, Jan, Msty Studio, Goose, then Claude Code, Cursor, VS Code, Windsurf). Claude Desktop and AnythingLLM get RigReady added to their settings file after a preview, with a backup and Undo on the Safety page; Cursor, VS Code and LM Studio get their own install link; Claude Code gets its command, run on request. The welcome screen offers it as an optional last step. The ways that need no pairing token come first; where one is needed, the token is drawn hidden in the text to paste, is never written to the log, and stops working when the pairing is forgotten.
- RigReady asks in its own window before an assistant changes the rig or launches a game (Always ask, Ask before a launch only, or Never ask). Changes go through the same backups and Undo, and Settings lists what assistants did. The AI provider keys and the AI settings are never offered to an assistant.
- Guided conversations for first setup, fixing bindings, a rig that is not ready and a new PC.
- The built-in assistant: a panel beside the page on every screen, opened from the Assistant button (once an AI provider is set up) or the command palette, for any game, with the provider chosen in Settings (Anthropic, OpenAI, an OpenAI-compatible service or a model on this PC). It uses the same tools as the MCP server through the same gate, so its changes are asked about in the window, recorded under "Built-in assistant" and named on the Safety page. Every request is shown before it is sent, with an estimate of what reading it comes to; the panel shows the estimate for the question so far, and a ceiling per question in Settings stops and asks before the estimate passes it. Replies are shown formatted, and a request the provider refused can be sent again with one press.
- Dollar figures for AI requests are estimates and say so: each names the prices it was worked out from (RigReady's built-in prices with the month they were recorded, or your own), and none is a bill. The prices per million tokens (input, output, cache read, cache write) can be edited for each model in Settings, with a reset to the built-in ones; a model without prices shows no dollar figure and takes no limit. An optional monthly budget for the assistant and the binding guide warns from 80 percent and then stops sending. Turning on the budget or a ceiling of your own asks you to acknowledge that it works on RigReady's estimates and that the hard limit belongs at your provider.
- Building a ready check with an assistant: `programs_find` finds where helper programs such as SimAppPro, TrackIR, SRS, Stream Deck, VoiceAttack, Tacview, OpenKneeboard, Pit House and G HUB are installed (Program Files, LocalAppData\Programs, the Steam libraries and the uninstall entries, read only, with path variables), and `setup_propose` drafts checks and launch steps that are saved only when you press Save. Both are offered over MCP too.
- Scripts an assistant writes (`script_draft`): shown in full with an explanation, saved into the data folder with a header only on Save, approved by their SHA-256, asked about before every run, held back when the file changes until approved again, never run by an assistant, never elevated, never shared.

**Racing and other games**
- iRacing, Le Mans Ultimate, BeamNG.drive, Assetto Corsa: detection, bindings as the game's files have them, cheat sheets, backup and restore. Wheel-mode and game-specific checks for iRacing, Le Mans Ultimate and BeamNG.drive; Assetto Corsa gets the common racing checks.
- iRacing bindings: every action iRacing has, bound or not, and what is bound to it, read from the control profile iRacing uses (iRacing keeps bindings in control profiles since 2026 Season 3), for all cars and for each car with a profile of its own, with the controllers matched to what is plugged in and the inputs that do more than one thing. An action can be bound to a controller button or a key, or cleared: RigReady shows the change first, writes nothing until you press Save, backs the file up and lists the change on the Safety page with Undo. A button and a key bound this way were used by iRacing in a test drive. Axes, hat switches and the number pad keys are bound in iRacing itself.
- iRacing control profiles: the bindings page lists every profile and which cars use each. Buttons and keys can be copied from one profile into another after a review, with a backup and Undo. A setup can switch the profile iRacing uses at Make ready and put the old one back at Stand down. The iRacing page, its checks, cheat sheets, backups and the controller ID repair use the profile iRacing loads.
- Controllers iRacing will not find: the bindings of a controller that is gone can be cleared after a review, with Undo. A controller that is only unplugged is never offered. An optional setup check warns when iRacing will ask to calibrate the wheel or pedals plugged in now.
- Binding guides for iRacing by class of car: GT3, GT4, LMDh and prototypes, formula and open-wheel, oval, and dirt. They show what is bound, walk you through binding buttons and keys with each change shown first, and say that the wheel and pedals are bound in iRacing itself. Their plain names for actions also appear on the iRacing bindings page and the cheat sheets.
- Assetto Corsa controller repair: when Windows lists the controllers in another order than when `controls.ini` was saved (a USB port change, a controller added), the page shows which controller each binding really acts on now and renumbers the file after a preview, with a backup and Undo. Identical controllers are asked for, never guessed.
- Microsoft Flight Simulator 2024 and 2020, X-Plane 12 and 11, IL-2 Sturmovik: Great Battles, Falcon BMS, Assetto Corsa EVO, Assetto Corsa Rally, Assetto Corsa Competizione, rFactor 2, Automobilista 2, EA SPORTS WRC, F1 25 and F1 24, DiRT Rally 2.0, RaceRoom, ACE COMBAT 8: detection, launch, files to back up.
- A virtual controller for games and emulators that read only a gamepad: a virtual Xbox 360 controller or DualShock 4 driven by a stick, wheel, pedals or throttle, with deadzones, curves, a steering range and a throttle split over both triggers, started by hand or by a setup, optionally hiding the real controllers with HidHide, with a live picture of the pad while it runs. Needs the ViGEmBus driver, which you install yourself.
- A Wheel page for every major wheelbase brand (Fanatec, Moza, Logitech, Simagic, Thrustmaster, Simucube, Asetek SimSports, Cammus): base, pedals and axes, the PC mode where the USB ID shows it, the maker's software with a "running" check that starts it, backups of profile files where they are plain files, and the maker's own per-game settings where it publishes any.
- A game RigReady does not know can be added on the Games page: its program, settings folders and kind. It is then found, launched, offered in new setups and backed up like the others. Folders such as a whole drive or the Windows folder are refused. Any other game works generically, with a setup of its own.

**Protecting your configuration**
- One-click backup, a restore wizard with a preview and per-item choices, snapshots, "what changed since it last worked".
- Sharing a setup as a file with a privacy review; imports are validated and never write outside known folders. A picture of the setup to show people, with no personal details in it.
- Every change outside RigReady's folder is backed up first, journaled, and can be undone on the Safety page.

**Hardware**
- Devices with your own names, and what each one is and what it is used for when RigReady cannot tell by itself; find a device by pressing a button, an input tester with a live trace per axis and a plot of two axes together, a hands-off health check that shows what it recorded, a USB map drawn as a tree, plug and unplug notifications.
- Stream Deck: inventory, health findings, backup, restore, a guide for a new PC. TrackIR: status and checks.

**The app**
- Per-user installer without administrator rights, updates through GitHub Releases with stable and beta channels, logging with personal details removed, a Diagnostics page. A request RigReady could not carry out leaves one line in the log, so a diagnostics export can explain it.
- The menu names no game. One Games entry, from whose cards the DCS World and Racing pages open, and one Bindings entry with a game picker (DCS and iRacing). It opens the game you looked at last.
- Editors keep their Save button in a bar at the bottom of the window, so it never scrolls away, and say why it is off when it is.
- A command palette (Ctrl+K) over every page and the common actions, with what an action did reported in a toast; Ctrl+1 and Ctrl+2 for Play and Configure; `?` for the list of keys; an About panel.
- The app links to this manual: a help button (?) in the header opens the manual page for the screen shown, tab included; the palette has Open the manual and Open the manual page for this screen; About and Settings link to it; and the notices about controllers that could not be read, a device not found, a monitor layout to put back, DCS files that will not be written, a setup file that cannot be read, Start with Windows and damaged data files link to their troubleshooting page.
- Motion is short and switched off when Windows is asked to reduce it. A page that is still reading shows its outline.
- Security: a review of the whole application (`docs/research/security-review-2026-11.md`), a `SECURITY.md` with the reporting path, and a Security page in the manual. A release marked `[security]` is announced on every screen with the install one click away. Every permission a page could ask for is refused; the windows that draw cheat sheets and pictures cannot reach the network; what a second start hands to the running app is validated first. A setup or backup whose YAML would multiply itself into millions of values is refused, and a restore never writes into the Start menu or its Startup folder.

### New since 2.0.0-beta.5

For those who tried the betas: what changed after the second look on the rig.

- iRacing: the bindings come from the control profile iRacing uses (2026 Season 3 and later), not the older `controls.cfg`. The iRacing page, its checks, cheat sheets, backups and the controller ID repair use it too, and say so when a profile cannot be found.
- iRacing: bind an action to a controller button or a key from the bindings page, with the change shown before anything is written. Button and key bindings made this way were used by iRacing in a test drive.
- iRacing: the control profiles and which cars use each; copying buttons and keys from one profile into another; a setup that switches the profile at Make ready and puts it back at Stand down.
- iRacing: clearing the bindings of controllers that are gone, with Undo, and a check that warns when iRacing will ask to calibrate the wheel or pedals.
- iRacing: binding guides for GT3, GT4, LMDh and prototypes, formula, oval and dirt cars.
- iRacing: the black box actions carry iRacing's own names, such as "Next black box".
- The overlay: a switch in each setup, on to begin with only where RigReady can read the game's bindings. "The main screen" follows the layout in use, and the page warns when the overlay's monitor is off in a setup's layout.
- Stand down's countdown says when the desk layout has not been kept with the monitors connected now. "Replace with the monitors as they are now" counts as keeping it.
- DCS: "Use in DCS" offers to update the setups that expect DCS's old window, and "Set the DCS options" asks before it would undo the screen setup in use.
- The trainer: a switch position or the stop of a lever, such as a throttle at IDLE, counts once it is there, with no need to let go, and a missed card comes back at the end of the round.
- Drawings: the ViperAce grip, the F-15EX throttle and take-off panel 2 match presses on a real rig, and their "?" marks are gone. The wing fold handle is drawn with its positions.
- Wheels: the input tester shows a Fanatec clutch pedal as the clutch whichever axis the base puts it on, and the Y axis is called "Clutch or combined pedals".
- Bringing over a RigReady 1 setup no longer lists the same check twice.
- Installed copies now know the publisher's full certificate details as well as its name, and try the full details first, so an update passes without the updater's warning about checking the name only. The release build checks the full details itself and stops if they no longer match.
- Clicking a switch's title in Settings or on the Overlay page turns the switch on or off.
- The setup editor keeps the capitals in a fix's name.
- For contributors: Claude Code skills that guide adding a device or a game, and a guide to building and running your own copy.

### Known limitations

**Not yet verified in the real game or on real hardware.** These passed tests on recorded data from one rig. Each has instructions in `docs/requirements/ledger.yaml` under the id shown.
- The iRacing device ID repair has not been tried with a wheel whose Windows ID really changed (RACE-IRACING-005).
- The Wheel page has only been tried on a real Fanatec base. Moza, Logitech, Simagic, Thrustmaster, Simucube, Asetek and Cammus bases were tested on recorded data made from their published USB IDs; the page says so and links the hardware report form (RACE-WHEEL-001).
- The Assetto Corsa controller repair has not been tried in the game with a controller that really moved (RACE-AC-001).
- Dragging the overlay into place with the mouse has not been tried on a real rig (OVERLAY-005).
- The virtual controller ran on the real driver once, with ACE COMBAT 8, and nothing recorded it. Hiding the real controllers while a game runs, a DualShock 4 profile and the ACE COMBAT 8 starting point as it is now have not been tried (VPAD-005).
- A monitor switched back on by a layout that asks for no refresh rate should keep the rate it had; this has not been tried on real monitors (DISP-019).
- Which way is up on sideways-mounted screens cannot be read from Windows; Monitors > Identify asks once.
- Restoring a Stream Deck backup file by file, and closing the Stream Deck app, were only exercised against recorded data.
- The taskbar badge, progress bar and thumbnail buttons were accepted by Windows in tests, but nobody has looked at them on a real taskbar; the ready tone's sound and a real press of the global hotkey are untested too.

**By design, for now**
- Many DCS actions (mostly keyboard and view commands) can be shown but not edited; they are marked "bind in DCS".
- For iRacing, RigReady binds buttons and keys. Axes, hat switches and the number pad keys are bound in iRacing itself (BIND-IRACING-008).
- DCS opens its kneeboard in the bottom right corner of its whole window, which can be on a small screen. The Screens tab shows where; RigReady cannot choose the place yet (DCS-MON-010).
- The overlay is a window on a monitor. It does not show inside a VR headset (OVERLAY-007), and over a game in exclusive full screen it may not show at all; set the game to borderless.
- WinWing backlight sync, UFC and ICP displays and vibration still need SimAppPro running. `docs/research/winwing-direct-control.md` describes what replacing it would take.
- Tuning values of a Fanatec wheel base live on the base and cannot be read; the Wheel page keeps a hand-entered copy.
- TrackIR's active profile cannot be switched from outside TrackIR.
- The binding guides were written from general knowledge of the aircraft and cars, and have not been reviewed by a pilot or a racing driver. Action names are checked against the installed DCS and against iRacing's own list of actions.
- The trainer asks buttons and hats only: no axes, modifier combinations or keyboard.
- A single backup is built in memory and capped at 2 GB.
- Windows 10 and 11 only. It has not yet been tried on a real Windows 10 PC.

## 2.0.0-beta.5 (2026-11-13)

The fourth signed test build, for the second look on the rig.

New since beta 4:

- What the guided sitting of 12 November found, fixed.
- One Games entry, and Bindings with a game picker.
- iRacing bindings for all cars and per car, read only. Changing them is built and switched off.
- The overlay.
- Add a game.
- "Always offer this app".
- Bringing a RigReady 1 setup over.
- "What is this device?"
- A Save bar on every editor.
- Stand down when the game closes.
- Closing helper programs together.
- A cheat sheet from a photo of your own controller.
- Your own binding guide without an AI key.
- The Thrustmaster Warthog throttle and TWCS drawings.
- A wording pass for people who only race.
- Fixes from a review of the night's work.

What it contains is the [2.0.0 section of the changelog](https://github.com/MCheli/RigReady/blob/main/CHANGELOG.md). A test build; 2.0.0 followed once the second look on the rig had passed.

## 2.0.0-beta.4 (2026-11-11)

The third signed test build.

Fixed since beta 3, all found by running the test plan against it:

- On the DCS screen map, a monitor's name no longer sits on top of a viewport's.
- The question RigReady asks before an assistant changes something names a setup by its name. It says in a sentence what a directly called channel does, with the call itself under it.
- The count of calls beside a paired assistant no longer falls behind the list. On Windows a settings file could not be replaced while the page was reading it; such a write now waits a moment and tries again.
- iRacing keyboard bindings show the name of the key for the number pad, punctuation, F13 to F16 and the media keys.
- In the trainer, the control asked for stands out from switches that are simply left on.
- The Play screen's drawing of the monitors names every monitor, small ones by a letter and a key.

What it contains is the [2.0.0 section of the changelog](https://github.com/MCheli/RigReady/blob/main/CHANGELOG.md). It is offered only to people who chose the beta channel in Settings > Updates.

## 2.0.0-beta.3 (2026-11-11)

The second signed test build.

New since beta 2:

- Twenty binding guides.
- MFD screen setup for every installed aircraft that exports displays.
- Named controls and drawings for the Thrustmaster Warthog, T.16000M and Saitek X52 Pro.
- 13 more games: MSFS 2020, X-Plane 12 and 11, IL-2, Falcon BMS, ACC, rFactor 2, AMS2, EA WRC, F1 24 and 25, DiRT Rally 2.0, RaceRoom, ACE COMBAT 8.
- A Wheel page for every major wheelbase brand.
- An Assetto Corsa controller repair.
- About 60 more devices recognised.
- The built-in assistant on every screen, with OpenAI, Gemini, OpenRouter, Mistral and local models as well as Anthropic.
- One-button connection for AI assistants over MCP.
- A virtual controller for gamepad-only games and emulators.
- Links from every screen to its manual page.

What it contains is the [2.0.0 section of the changelog](https://github.com/MCheli/RigReady/blob/main/CHANGELOG.md). It is offered only to people who chose the beta channel in Settings > Updates.

## 2.0.0-beta.2 (2026-11-11)

The first signed test build of 2.0.0.

New since beta 1:

- The installer, RigReady.exe and the uninstaller carry a code signature with the publisher "Mark Cheli", issued through Microsoft's Artifact Signing service. Installed copies check that signature before they install an update.
- An answer to an assistant's question that stops further questions about changes.
- The Safety page names the assistant beside a change it made.

What it contains is the [2.0.0 section of the changelog](https://github.com/MCheli/RigReady/blob/main/CHANGELOG.md). It is offered only to people who chose the beta channel in Settings > Updates.

## 2.0.0-beta.1 (2026-11-07)

A test build of 2.0.0, for checking the installer and the app on a real rig before the release.

What it contains is the [2.0.0 section of the changelog](https://github.com/MCheli/RigReady/blob/main/CHANGELOG.md). This build is not code signed; the builds after it are. A draft for testing on the rig; it was not published.

## 1.1.0 and earlier

The first version of the app (January and February 2026). Superseded: 2.0.0 does not use its setups as they are, but can bring one over as a new setup, and 1.1.0 does not update itself to 2.0.0. Its installer stays on the Releases page, and its documents are in `docs/archive/`.
