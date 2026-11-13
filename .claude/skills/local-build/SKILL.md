---
name: local-build
description: Walks someone through building and running their own copy of RigReady from this repository, for themselves, without contributing it back - running it from the source, npm run pack to release/win-unpacked, or an unsigned installer with npm run dist; keeping its data apart from an installed RigReady; what updates, signing and SmartScreen mean for a copy of their own; and keeping a change on a branch while taking the newest RigReady. Use when the user says things like "build RigReady from source", "make an installer of my version", "use my change without a pull request", "run my build next to the installed RigReady", "update my fork with main", or "why does Windows warn about my build". Not for installing the official release, which is on the download page.
---

# Build and run your own copy of RigReady

You are helping someone build RigReady for their own use. The human version of this procedure is `docs/contributing/local-build.md`; keep to it, and use only the scripts in `package.json` and the steps in `docs/RELEASING.md`. Do not invent a script, a flag or a setting.

## How you work

- **One step at a time.** Start each message with "Step N: <name>", say in one plain sentence what it is for, run what you can run, and say exactly what the user should do and see. Wait for their answer before the next step.
- **Their data stays theirs.** Your build runs with `RIGREADY_HOME` pointed at a folder of its own unless the user chooses to share `~/.rigready`, after you have said what sharing means (below). Never start any RigReady on the real data folder without that choice, and never write to `~/.rigready` yourself.
- **Ask before** you commit, merge, or change anything outside the repository's folder. You do not push or open pull requests here; the `open-pull-request` skill does that, if the user later wants to send the change in.
- `CLAUDE.md`'s "This machine" section describes the maintainer's own PC; unless the user says they are the maintainer, its paths do not apply.

## Step 1: what they want

Ask which of these they want, and from which branch (their own change, or `main` as it is):

1. Run it from the source (`npm run dev`): quickest, for trying a change.
2. A program folder they can start any time (`npm run pack`, to `release\win-unpacked\RigReady.exe`).
3. An installer (`npm run dist`, to `release\RigReady-Setup-<version>.exe`, unsigned).

## Step 2: get ready

Check `git --version`, `node --version` (22.12 or newer) and `git status` (which branch; anything not committed). Run `npm ci`. Then `npm run setup:python` once (it downloads Python's embeddable runtime and one library file, each checked against a fixed checksum; `pack` and `dist` refuse to build without it). Offer `npm run dev:scenario -- generic-fresh` first: the app on a recorded PC with fake hardware, which touches nothing real.

Before they trust a build of a change: `npm run check` passes. Say so if it does not, and what failed.

## Step 3: build (a program folder or an installer only)

For `pack` or `dist`, run it, and tell them it takes a few minutes and uploads nothing (`--publish never`). A run from the source has nothing to build here: do not start `npm run dev` in this step, because nothing has set its data folder yet. Step 4 starts every choice.

## Step 4: start it, apart from their real data

Nothing starts before these two things, in this order, whichever of the three they chose:

1. The user quits every RigReady that runs (tray icon, right-click, **Quit**). A packaged copy started while another runs only brings that one forward, and two copies would share the controllers and the files.
2. The data folder is set in the same PowerShell window, in the repository's folder, before the start command: `$env:RIGREADY_HOME = "$env:USERPROFILE\.rigready-my-build"`. Check it with `$env:RIGREADY_HOME` before going on.

Then the start command in that same window:

- From the source: `npm run dev`.
- The program folder: `& .\release\win-unpacked\RigReady.exe`.
- The installer: it replaces an installed RigReady (say so first, step 5). On its last page the user unticks the box that starts RigReady, since a start from there has no `RIGREADY_HOME` and opens `~/.rigready`. Then start the installed program from the same window: `& "$env:LOCALAPPDATA\Programs\RigReady\RigReady.exe"`, or the folder they chose in the installer. A start from the Start menu or the desktop shortcut also uses `~/.rigready`.

If you start it yourself in the background instead, set `RIGREADY_HOME` on that command, never after it. For a first look that also keeps the user folder apart, the isolated launch in `docs/contributing/local-build.md` ("Trying a build in a user folder of its own"), with what it does and does not keep apart.

## Step 5: what a copy of their own means

Tell them, one point per line, and check that each is understood:

- **Updates.** A packaged copy checks RigReady's releases on GitHub like the official app. When a newer version than its own is published, it downloads it and installs it on quit, and they then run the official version, not theirs. To stay on their build: **Settings > Updates > Check for updates automatically** off, in their copy, at its first start. The switch lives in the data folder, so in a shared folder it is off for the installed RigReady too. `npm run dev` never updates.
- **One RigReady to Windows.** The installer has the official app id: it replaces an installed RigReady, and the official installer or an update replaces it. To keep both, they install the official one and run theirs from `release\win-unpacked`.
- **Unsigned.** On the PC that built it, SmartScreen does not ask. Copied to another PC by a download, a chat or an email, SmartScreen says "Windows protected your PC" (**More info**, **Run anyway**), and Smart App Control can block it outright. If they give it to someone, they say it is their own build.
- **The data folder.** Every copy uses `~/.rigready` unless `RIGREADY_HOME` says otherwise. With a folder of its own, changes their copy makes to game files are backed up in that folder and undone on their copy's Safety page.

If they ask to make their build install beside the official one under another name: the repository has no supported way to do that; the unpacked folder is the way to keep both.

## Step 6: keep the change, take the updates

Their change stays on a branch of its own (`git switch -c my-rig`, then commit only the files they changed). To take the newest RigReady: `git fetch origin`, `git merge origin/main`, `npm ci`, `npm run check`, and build again. From a fork: `git remote add upstream https://github.com/MCheli/rigready.git` once, then `git fetch upstream` and `git merge upstream/main`. A conflict is resolved with them, file by file, and `npm run check` runs before the next build.

## Step 7: before they rely on it

A change that writes game files gets the proof on their own rig before they use it for real: `docs/contributing/README.md`, "Proof on your own rig". A copy for themselves writes the same files a merged change would.
