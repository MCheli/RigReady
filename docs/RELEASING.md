# Releasing RigReady

How a version gets from the repository to the people who use it, and the checklist that is worked through before it does. Nothing here is automatic past the draft: a person publishes the release.

## What a release is

- A git tag `v<version>` on `main`, where `<version>` is the `version` in `package.json`.
- A GitHub release for that tag with three files: the installer `RigReady-Setup-<version>.exe`, its block map `RigReady-Setup-<version>.exe.blockmap`, and the update feed file (`latest.yml` for a release, `beta.yml` for a beta).
- The installed app reads that feed. Without the `.yml` file a release is invisible to the updater.

## Channels and version numbers

| Version | Tag | Feed file | Who gets it |
|---|---|---|---|
| `2.1.0` | `v2.1.0` | `latest.yml` | Everyone: the stable channel, and beta users too |
| `2.2.0-beta.1` | `v2.2.0-beta.1` | `beta.yml` | Only people who chose the beta channel in Settings > Updates |
| `2.2.0-dev.3`, `-alpha.1`, `-rc.1` | do not tag | | Nobody: the app refuses these on every channel |

Rules the app applies (`src/features/updates/core/version.ts`): never a downgrade, never the same version, pre-releases only on the beta channel and only `-beta.N`. A beta user is moved on to the release of the same version when it appears.

The version in the repository between releases is a `-dev.N` version. It is older than its own release, so a development build would update to the release; it never updates to anything else.

## How updating works for the user

- Checks: a few seconds after the start and once a day, on the chosen channel. Settings > Updates has the switch, the channel and "Check now"; Settings > About shows the version and channel.
- A newer version downloads in the background. Nothing is installed during the session by itself.
- It is installed when the user presses "Restart to install", or silently when RigReady quits. Never while a game is running (any game module's program, or the program a setup launches): the button says which game, and the quit leaves the update for next time.
- With automatic checks off, nothing is checked, downloaded or installed on quit. "Check now" and "Restart to install" still work.
- The update is the same per-user installer run silently. It needs no administrator rights and keeps the data folder, the shortcuts and the Start with Windows entry.

## Steps

1. On `main`, with a clean tree: set `version` in `package.json` (and `package-lock.json`: `npm version <version> --no-git-tag-version`).
2. `npm run check`, `npm run test:e2e`.
3. On the rig (a PC with controllers, not a CI runner), from a normal (not elevated) terminal:
   - `npm run rig:smoke`
   - `npm run smoke:packaged`
   - `npm run smoke:installer`
4. Commit, tag `v<version>`, push the tag. The Release workflow runs the checks again, builds the installer (`npm run dist`, which never publishes) and creates a **draft** GitHub release with the installer, the block map and the feed file.
5. Work through the checklist below against the installer from the draft.
6. Publish the draft. From that moment installed apps on the channel find it.

To withdraw a release: delete it (or mark it as a draft again) on GitHub. Installed apps then see the previous one, which is not newer than what they run, and do nothing. An app that already updated stays on the withdrawn version until a newer one is published; there is no downgrade.

## Checklist

Copy this into the release's description or the pull request and fill it in. A release is not published with an empty box.

### Automated, on the rig

| Check | Command | Result (date, numbers) |
|---|---|---|
| Unit, lint, types, ledger | `npm run check` | |
| Scenario end-to-end | `npm run test:e2e` | |
| Real hardware, read-only | `npm run rig:smoke` | |
| Packaged app: enumeration, scenario, live input, input reader failure, updater against a local feed, start with Windows | `npm run smoke:packaged` | Fly screen usable after ____ ms (limit 2000) |
| Memory idle in the tray, ten minutes | `RIGREADY_MEMORY_SETTLE_SECONDS=600 npx playwright test --config playwright.packaged.config.ts -g "memory"` | ____ MB (limit 250) |
| Installer: install without elevation, start, update on quit, uninstall keeps or removes data | `npm run smoke:installer` | |

### By hand, with the installer from the draft release

Windows 11 (the rig):

- [ ] Installs by double-click with no UAC prompt, into `%LOCALAPPDATA%\Programs\RigReady`; the installer never asks "for all users".
- [ ] Start menu entry and desktop shortcut start it; the Fly screen shows the last setup.
- [ ] Installing over the previous version keeps setups, backups and settings (`%USERPROFILE%\.rigready`).
- [ ] The previous version, left running, finds this release after it is published (or point it at the draft's files with a local feed), downloads it, and installs it on quit.
- [ ] "Restart to install" while a sim is running is refused with the sim's name.
- [ ] Uninstall from Windows Settings: asks whether to remove the data, default No; the Start with Windows entry is gone; the data folder is still there after No.

Windows 10 22H2 (a second PC or a virtual machine; a standard user account, not an administrator):

- [ ] Installs with no UAC prompt and starts.
- [ ] Configure > Devices lists the PC's USB devices; Monitors lists its displays; Audio lists its devices.
- [ ] The input tester shows a connected controller and reacts to a button.
- [ ] A setup made with "capture" checks green, and a monitor layout applies and reverts.
- [ ] Uninstalls cleanly.

Record for each Windows version: the build number (`winver`), the date, and who did it.

| Windows | Build | Date | By | Result |
|---|---|---|---|---|
| 11 | | | | |
| 10 22H2 | | | | |

## What the tools do and do not do

- `npm run pack` builds the unpacked app in `release/win-unpacked` (what `smoke:packaged` runs). `npm run dist` builds the installer in `release/`. Both pass `--publish never`: electron-builder uploads nothing, ever. The only upload is the workflow's release step.
- The installer is not code signed. Windows SmartScreen will warn on first run until it is; signing needs a certificate and is a separate decision.
- `npm run smoke:installer` builds a variant called "RigReady Test" (`scripts/build-test-installer.mjs`): another app id, name, shortcut, install folder, update cache and data folder (`%USERPROFILE%\.rigready-installer-test`), so it can be installed and removed on a PC that has a real RigReady without touching it. The test checks that the real install, its shortcuts, its uninstall entry, its data folder and the Windows startup list are byte for byte the same afterwards.
- The update feed can be pointed at a folder served on the same PC with `RIGREADY_UPDATE_FEED=http://127.0.0.1:<port>/` (the smoke tests do). Any other address is ignored: an environment variable cannot make the app download from somewhere else.
- A silent uninstall keeps the data: `"Uninstall RigReady.exe" /S`. To remove it too: `"Uninstall RigReady.exe" /S --remove-data`. Only a folder that has RigReady's log in it is ever removed.
- CI (`.github/workflows/ci.yml`) runs the checks, the scenario end-to-end tests and the packaged smoke on `windows-latest`. A runner has no game controller and no desktop session of a user, so the tests that need those skip themselves there; they run on the rig.
- RigReady is built for Windows only (the build configuration has no other target), and the app refuses to start anywhere else with a message that says so.
