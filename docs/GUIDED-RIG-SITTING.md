# The guided rig sitting

How a release candidate is tested on the owner's real rig with as little of the owner's time as possible. Claude drives RigReady; the owner only does what needs hands: pressing controls, moving a cable, clicking a Windows prompt, looking inside a game.

## The driver

`scripts/rig-driver.mjs` launches an installed (or unpacked) RigReady with Playwright and serves a small JSON API on `http://127.0.0.1:47123`, local only. Run it from the repository, so Playwright resolves:

```
node scripts/rig-driver.mjs
```

It prints its address and a token. Every request must carry the token in an `x-rig-token` header, and a request that names an `Origin` is refused: the driver can start any program and click anything in RigReady, and a web page open on the same PC can post to a local port too. `RIG_DRIVER_TOKEN` sets the token (random at each start otherwise); `RIG_DRIVER_PORT` sets another port, for a second driver beside a sitting.

| Action | Body | Does |
|---|---|---|
| `launch` | `{exe, outDir, env?, args?}` | Starts the app; screenshots go to `outDir` (required; the sitting uses `Desktop\rigready-test`) |
| `page` | `{max?}` | Lists the visible headings, buttons and `data-testid`s: what is on screen, in words |
| `click`, `fill`, `wait`, `text` | `{testid}` or `{role, name}` or `{text}` or `{selector}`, plus `nth`, `value`, `timeout` | Acts on or reads one element |
| `inspect` | a target, plus `max` | Every match with its text, classes, `data-*` values, and whether it reads as pressed, checked, selected or disabled: "which control lit up" |
| `press` | `{key}` | Presses a key |
| `goto` | `{hash}` | Opens a route, for example `#/configure/devices` |
| `scroll` | a target, or `{}` | Brings the target into view; with no target, puts everything back at its top |
| `shot` | `{name, full?}`, optionally a target | Saves `<outDir>/<name>.png`: the window, or only the target |
| `dialog` | `{save: path}` or `{open: [paths]}` | Answers the next native Save or Open dialog, which Playwright cannot reach. Send it before the click that opens the dialog; `null` or `[]` cancels |
| `windows`, `use`, `closeWindow` | `{}`, `{index}`, `{index}` | Lists the windows; makes another one (a popped-out cheat sheet) the one the other actions act on; closes an extra window and goes back to the main one |
| `close`, `stop` | `{}` | Closes the app; `stop` also ends the driver, so nothing is left listening |

For example (`$T` holds the token):

```
curl -s -X POST -H "x-rig-token: $T" -d '{"exe":"C:\\Users\\Owner\\AppData\\Local\\Programs\\RigReady\\RigReady.exe","outDir":"C:\\Users\\Owner\\Desktop\\rigready-test"}' http://127.0.0.1:47123/launch
curl -s -X POST -H "x-rig-token: $T" -d '{}' http://127.0.0.1:47123/page
curl -s -X POST -H "x-rig-token: $T" -d '{"testid":"mode-configure"}' http://127.0.0.1:47123/click
curl -s -X POST -H "x-rig-token: $T" -d '{"name":"05-setups"}' http://127.0.0.1:47123/shot
```

With no `env`, the app uses the real profile and data folder: that is the point of a sitting, and the reason the data folder is copied first.

The production build has no test hooks, so the driver works through the UI and its `data-testid`s only, as a person would.

### Working notes

- **Selects and menus.** Click the field's `data-testid`, then choose with the selector `.v-overlay--active .v-list-item` (with `nth`, or `:has-text("...")`). A long list holds only about a dozen rows at a time: with the list open, `press` the first letters of the entry to bring it into the list, then click it.
- **Text fields, checkboxes and switches** are `[data-testid=X] input`.
- **`page` lists the shell first.** The header's and the menu's entries (about two dozen) come before the page's own. In a popped-out window they are listed too, although the sheet covers them.
- **Slow pages.** `wait` for an element instead of pausing: `capture-game` after `fly-create`, `screens-apply` on the DCS screens tab (about six seconds behind a `page-skeleton`).
- **Paths in JSON.** Write the body to a file and post it with `--data-binary @file`: a Windows path typed into a shell command loses backslashes.
- **A second start.** RigReady runs once per profile, and the installer starts it when it finishes. If `launch` says RigReady ended as soon as it started, a copy is running: the owner quits it from the tray, then `launch` again.
- **Listening for a control** ("Press it on the device", "Press or move") lasts about ten seconds. Tell the owner what to press first, then click.
- **`robocopy`** returns 1 when it copied files; anything below 8 is success.

### Trying it without the owner

The driver and the plan can be tried alone, against nothing real: pass `env` with `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` and `RIGREADY_HOME` pointed at a temporary folder (the isolated launch in `ARCHITECTURE.md`), with a copy of the files the plan reads (`.rigready`, `Saved Games\DCS\Config`, `Documents\iRacing`) placed in it, and start the driver with `ANTHROPIC_API_KEY` unset. Devices, monitors and audio are still the real ones, read only.

The temporary folder does not hold back everything. These act on the real PC whatever `env` says, so a dry run leaves them alone:

- Start with Windows.
- Applying or replacing a monitor layout, and turning a monitor the other way up.
- The default audio device.
- Make ready, launch and Stand down: they start and close real programs.
- The header's "?": it opens the browser. Check a manual address by fetching it instead.

Two more reach outside it while they run: the virtual controller plugs a virtual pad into Windows (leave "hide the real controllers" off), and the assistant server listens on its usual local port.

A dry run finds problems in the driver and the plan. It is not evidence for a requirement: only the sitting is.

## The sitting, phase by phase

The owner answers each prompt in chat with "done" or one word. About 30 minutes of attention, in phases that can be paused between.

0. **Before (Claude).** Copy `C:\Users\Owner\.rigready` to `Desktop\rigready-test\data-before`. Check SimAppPro, DCS and iRacing are not running, and that no driver is left listening from an earlier run. Download the draft's installer, check its signature and its SHA-512 against `latest.yml`, put it on the Desktop.
1. **Install (owner, 2 min).** Quit SimAppPro if it runs. Run the installer: the dialog names the publisher (Mark Cheli) when signed. On its last page, untick "Run RigReady" (or quit RigReady from the tray afterwards): the driver has to be the one that starts it. Claude then checks the installed version and signature, launches it through the driver, and screenshots About, Setups (RigReady 1 files listed apart), Play and Settings; turns on Start with Windows.
2. **Monitors and setup (owner, 5 min).** Claude saves the monitors as they stand as a layout and marks it the desk layout. The owner puts the monitors the way they fly. Claude creates a setup from the rig, which saves that arrangement as a second layout and makes the setup check for it; presses Identify, and the owner says whether the numbers match. A layout that is in use has no Apply, so the apply test goes both ways: Claude applies the desk layout with its preview, keeps it, reads back the refresh rate, then applies the flying layout the same way.
3. **Drawings and input (owner, 6 min).** Claude opens the cheat sheet for the stick and asks for one control at a time; after each press it reads which label lit and compares it with the expected control. Same for the throttle. Kneeboard export. Find a device (one press on the pedals). Input tester (sweep stick, throttle, pedals, wheel, one prompt each). A trainer round, with Claude reading each prompt aloud in chat.
4. **DCS (owner, 10 min).** With the monitors in the flying layout, Claude writes one binding (the preview names the file; Undo is on the same screen) and sets up the DCS screens: "Use in DCS" writes at once, the panel beside it is the preview, and the Safety page undoes it. Then Make ready and launch. The owner checks the binding in Options > Controls, the three MFD screens in a hot-start mission, and the bound button; quits DCS. Claude runs Stand down and checks the monitors went back to the desk layout.
5. **iRacing repair (owner, 5 min, optional).** The wheel base is switched on. The owner moves its USB cable. Claude finds the new ID and runs the repair (files shown first). The owner tries a Test Drive without calibrating.
6. **AI assistant (owner, one click).** Claude turns the MCP server on, pairs, and calls it directly over HTTP: a read needs no question; Make ready raises one in RigReady's window, which the owner allows. Claude checks the Safety page names the assistant, forgets the pairing, turns the server off. The buttons that connect an installed assistant show only in the real profile.
7. **Wrap-up (Claude).** Diagnostics export; compare the data folder with `data-before`; write `Desktop\rigready-test\results.md`; turn every failure into a fix PR; record verified requirements in the ledger with the screenshots as evidence; `stop` the driver.

Uninstall and reinstall are covered by `npm run smoke:installer` in CI and are not repeated on the rig.

## Rules

- Nothing runs against the real profile except during a sitting the owner has started.
- Never launch a game outside the DCS and iRacing phases, and never while the owner is not at the rig.
- The driver binds to 127.0.0.1 only. Its token stays out of chat and out of any file that leaves the PC. `stop` it when the sitting ends.
