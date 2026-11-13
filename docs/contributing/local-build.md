# Build and run your own copy

Clone the repository, open Claude Code in it (`claude`), and say "build my own copy of RigReady": the `local-build` skill walks you through this page. Everything here also works by hand. A copy of your own is how you use a change before it is merged, or one you never send in.

You need Windows 10 or 11, [Git](https://git-scm.com/download/win) and [Node.js](https://nodejs.org/) 22.12 or newer. Every command below is run in the repository's folder, in PowerShell.

## 1. Get the code

```
git clone https://github.com/MCheli/rigready.git
cd rigready
npm ci
```

## 2. Try it on a recorded rig

```
npm run dev:scenario -- generic-fresh
```

This starts the app on a recorded PC with fake hardware, in a temp folder. Nothing on your PC is read or changed. Without a name, `npm run dev:scenario` lists the recorded rigs.

## 3. Run it on your PC, from the source

Once, for the small Python runtime that reads your controllers:

```
npm run setup:python
```

It downloads Python's embeddable runtime and one library file for the virtual controller into `resources/`, each checked against a fixed checksum. Then quit any RigReady that runs (right-click its icon in the tray, then **Quit**), and start yours with its data folder set first, in the same PowerShell window:

```powershell
$env:RIGREADY_HOME = "$env:USERPROFILE\.rigready-my-build"
npm run dev
```

`RIGREADY_HOME` gives your copy a data folder of its own. Without it, `npm run dev` uses `~/.rigready`, the same setups, settings, backups and Safety page as an installed RigReady. A run from the source never updates itself, and it keeps Ctrl+R (reload) and Ctrl+Shift+I (developer tools).

## 4. Build a program you can start on its own

```
npm run pack
```

This builds `release\win-unpacked\RigReady.exe`, the app as it would be installed, in a folder you can start it from. It needs step 3's `npm run setup:python` first and refuses to build without it. Start it with its own data folder:

```powershell
$env:RIGREADY_HOME = "$env:USERPROFILE\.rigready-my-build"
& .\release\win-unpacked\RigReady.exe
```

Or build an installer:

```
npm run dist
```

This makes `release\RigReady-Setup-<version>.exe`, unsigned, in a few minutes. Installing it replaces an installed RigReady (below). On the installer's last page, untick the box that starts RigReady: started from there, or from the Start menu or the desktop shortcut, it has no `RIGREADY_HOME` and uses `~/.rigready`. Start it from PowerShell instead, after setting `RIGREADY_HOME` as above: `& "$env:LOCALAPPDATA\Programs\RigReady\RigReady.exe"`, or the folder you chose in the installer.

Both commands pass `--publish never` to the packager: nothing is uploaded anywhere. `release\` is not tracked by Git. `docs/RELEASING.md` describes both.

## What a copy of your own means

- **Updates.** A packaged copy (`npm run pack` or `npm run dist`) checks RigReady's releases on GitHub like the official app, at start and once a day. When a version newer than your copy's (the `version` in `package.json`) is published, it downloads it in the background and installs it when you quit RigReady, and from then on you run the official version, not yours. To stay on your build, turn off **Settings > Updates > Check for updates automatically** in your copy the first time you start it. Nothing is then checked, downloaded or installed unless you press **Check now**. The switch is kept in the data folder, so in a shared data folder it is off for the installed RigReady too. A run from the source (`npm run dev`) never updates.
- **One RigReady to Windows.** The installer from `npm run dist` has the same app id as the official one. Installing it replaces an installed RigReady, and the official installer, or an update, replaces yours. To keep both, install the official one and run yours from `release\win-unpacked`.
- **One at a time.** Run one RigReady at a time: two would watch the same controllers and, with one data folder, write the same files. A packaged copy started while another RigReady runs only brings the running one forward. Quit the other one first: right-click RigReady's icon in the tray, then **Quit**.
- **Unsigned.** The official installer is signed; yours is not. Started on the PC that built it, it carries no mark of the web, so SmartScreen does not ask. Copied to another PC by a download, a chat or an email, it is marked: SmartScreen then shows "Windows protected your PC" with an unknown publisher (**More info**, then **Run anyway**). With Windows' Smart App Control on, an unsigned program can be blocked outright. If you give your build to someone, tell them it is your own build and not the official release.
- **The data folder.** Every copy uses `~/.rigready` unless `RIGREADY_HOME` says otherwise: the setups, the settings, the backups and the record of changes on the Safety page. With a folder of its own, a change your copy makes to a game's files is backed up into that folder and listed on your copy's Safety page, so Undo it there.

## Trying a build in a user folder of its own

The isolated launch gives the program a user folder of its own, in a temp folder. It is not a sandbox: RigReady still runs on the real Windows of this PC, and only what lives in your user folder is kept apart.

- **Kept apart:** your user folder, and so RigReady's data folder (setups, settings, backups, the Safety page), Documents, Saved Games, AppData and the Desktop. Settings and bindings a game keeps there (DCS's `Saved Games\DCS`, iRacing's `Documents\iRacing`) are not seen, and the temp folder starts empty.
- **Still the real ones:** Program Files and ProgramData, Steam and every Steam library (found through the real registry), so the games installed there and the files in their folders; the registry (read only); the programs running; the controllers, monitors and audio devices. RigReady reads them as usual, and a change you confirm in it to a file in those places is written there, with its backup in the temp folder. A monitor layout or a default audio device changes only when you apply one.

Open a PowerShell window for it alone, and close it afterwards, since the four variables stay set in that window:

```powershell
$try = Join-Path $env:TEMP "rigready-try"
New-Item -ItemType Directory -Force "$try\AppData\Roaming", "$try\AppData\Local", "$try\.rigready" | Out-Null
$env:USERPROFILE = $try
$env:APPDATA = "$try\AppData\Roaming"
$env:LOCALAPPDATA = "$try\AppData\Local"
$env:RIGREADY_HOME = "$try\.rigready"
& .\release\win-unpacked\RigReady.exe
```

## Keep your change, and take the updates

Keep your change on a branch of its own, so `main` stays as it is upstream:

```
git switch -c my-rig
git add <the files you changed>
git commit -m "What the change does"
```

To take the newest RigReady later:

```
git fetch origin
git merge origin/main
npm ci
npm run check
npm run pack
```

If you cloned your own fork instead, add the original once with `git remote add upstream https://github.com/MCheli/rigready.git`, then `git fetch upstream` and `git merge upstream/main`. When Git reports a conflict, your change is still on your branch: resolve it (Claude can do it with you), then run `npm run check` before you build.

## Before you rely on it

- `npm run check` passes: typecheck, lint, format, unit tests and the ledger.
- You ran the proof on your own rig ([Proof on your own rig](README.md#proof-on-your-own-rig)), the same as for a change that is sent in. A copy for yourself writes to the same game files.
- To send it in later, see [Sending it in](README.md#sending-it-in).
