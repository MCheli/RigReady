# The guided rig sitting

How a release candidate is tested on the owner's real rig with as little of the owner's time as possible. Claude drives RigReady; the owner only does what needs hands: pressing controls, moving a cable, clicking a Windows prompt, looking inside a game.

## The driver

`scripts/rig-driver.mjs` launches an installed (or unpacked) RigReady with Playwright and serves a small JSON API on `http://127.0.0.1:47123`, local only:

| Action | Body | Does |
|---|---|---|
| `launch` | `{exe, outDir, env?, args?}` | Starts the app; screenshots go to `outDir` (required; the sitting uses `Desktop\rigready-test`) |
| `page` | `{}` | Lists the visible headings, buttons and `data-testid`s: what is on screen, in words |
| `click`, `fill`, `wait`, `text` | `{testid}` or `{role, name}` or `{text}` or `{selector}`, plus `nth`, `value`, `timeout` | Acts on or reads one element |
| `press` | `{key}` | Presses a key |
| `goto` | `{hash}` | Opens a route, for example `#/configure/devices` |
| `shot` | `{name, full?}` | Saves `<outDir>/<name>.png` |
| `windows`, `close` | `{}` | Lists windows; closes the app |

Run it with `node scripts/rig-driver.mjs` (from the repository, so Playwright resolves), then for example:

```
curl -s -X POST -d '{"exe":"C:\\Users\\Owner\\AppData\\Local\\Programs\\RigReady\\RigReady.exe","outDir":"C:\\Users\\Owner\\Desktop\\rigready-test"}' http://127.0.0.1:47123/launch
curl -s -X POST -d '{}' http://127.0.0.1:47123/page
curl -s -X POST -d '{"testid":"mode-configure"}' http://127.0.0.1:47123/click
curl -s -X POST -d '{"name":"05-setups"}' http://127.0.0.1:47123/shot
```

With no `env`, the app uses the real profile and data folder: that is the point of a sitting, and the reason the data folder is copied first. To try the driver without touching anything real, pass `env` with `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` and `RIGREADY_HOME` pointed at a temporary folder (the isolated launch in `ARCHITECTURE.md`); reading devices, monitors and audio still shows the real hardware, read only.

The production build has no test hooks, so the driver works through the UI and its `data-testid`s only, as a person would.

## The sitting, phase by phase

The owner answers each prompt in chat with "done" or one word. About 25 to 30 minutes of attention, in phases that can be paused between.

0. **Before (Claude).** Copy `C:\Users\Owner\.rigready` to `Desktop\rigready-test\data-before`. Check SimAppPro, DCS and iRacing are not running. Download the draft's installer, check its signature and its SHA-512 against `latest.yml`, put it on the Desktop.
1. **Install (owner, 2 min).** Quit SimAppPro if it runs. Run the installer: the dialog names the publisher (Mark Cheli) when signed. Claude then checks the installed version and signature, launches it through the driver, and screenshots About, Setups (RigReady 1 files listed apart), Play and Settings; turns on Start with Windows.
2. **Setup and monitors (owner, 3 min).** Claude creates a setup from the rig, saves a monitor layout, presses Identify; the owner says whether the numbers match. Claude applies the layout with its preview, keeps it, and reads back the refresh rate.
3. **Drawings and input (owner, 6 min).** Claude opens the cheat sheet for the stick and asks for one control at a time; after each press it reads which label lit and compares it with the expected control. Same for the throttle. Kneeboard export. Find a device (one press on the pedals). Input tester (sweep stick, throttle, pedals, wheel, one prompt each). A trainer round, with Claude reading each prompt aloud in chat.
4. **DCS (owner, 10 min).** Claude writes one binding, sets up the DCS screens, runs Make ready and launch. The owner checks the binding in Options > Controls, the three MFD screens in a hot-start mission, and the bound button; quits DCS. Claude runs Stand down and checks the monitors went back.
5. **iRacing repair (owner, 5 min, optional).** The owner moves the wheel base's USB cable. Claude finds the new ID and runs the repair (files shown first). The owner tries a Test Drive without calibrating.
6. **AI assistant (owner, one click).** Claude turns the MCP server on, pairs, and calls it directly over HTTP: a read needs no question; Make ready raises one in RigReady's window, which the owner allows. Claude checks the Safety page names the assistant, forgets the pairing, turns the server off.
7. **Wrap-up (Claude).** Diagnostics export; compare the data folder with `data-before`; write `Desktop\rigready-test\results.md`; turn every failure into a fix PR; record verified requirements in the ledger with the screenshots as evidence.

Uninstall and reinstall are covered by `npm run smoke:installer` in CI and are not repeated on the rig.

## Rules

- Nothing runs against the real profile except during a sitting the owner has started.
- Never launch a game outside the DCS and iRacing phases, and never while the owner is not at the rig.
- The driver binds to 127.0.0.1 only. Stop it (close the app, end the process) when the sitting ends.
