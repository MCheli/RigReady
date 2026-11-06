# Releasing RigReady

How a version gets from the repository to the people who use it, the checklist that is worked through before it does, and the runbook for 2.0.0, the first release of the rebuilt app. Nothing here is automatic past the draft: a person publishes the release.

## What a release is

- A git tag `v<version>` on `main`, where `<version>` is the `version` in `package.json`.
- A GitHub release for that tag with three files: the installer `RigReady-Setup-<version>.exe`, its block map `RigReady-Setup-<version>.exe.blockmap`, and `latest.yml`, the update feed file (version, file name, size, SHA-512).
- The installed app reads that feed. Without `latest.yml` a release is invisible to the updater; without the `.exe` it is invisible to the website.
- The release's description is the version's section of `CHANGELOG.md`, written by `scripts/release-notes.mjs`. The installed app shows its first line when it offers the update.

The feed file is called `latest.yml` for every version, betas included: when the publish provider is GitHub, electron-builder names it after the publish configuration's channel, never after the version. A beta is told apart by GitHub's pre-release flag, which the workflow sets for any tag with a `-` in it.

## Channels and version numbers

| Version | Tag | GitHub release | Who gets it |
|---|---|---|---|
| `2.1.0` | `v2.1.0` | a release, marked "Latest" | Everyone: the stable channel, and beta users too |
| `2.2.0-beta.1` | `v2.2.0-beta.1` | a pre-release | Only people who chose the beta channel in Settings > Updates |
| `2.2.0-dev.3`, `-alpha.1`, `-rc.1` | do not tag | | Nobody: the app refuses these on every channel |

How the installed app finds them (`src/platform/electron/updater.ts`, electron-updater's GitHub provider):

- Stable channel: GitHub's "latest" release (`/releases/latest`: never a pre-release, never a draft), then its `latest.yml`.
- Beta channel: the newest entry of the releases feed whose tag is a release or a `-beta.N` (a `-dev`, `-alpha` or `-rc` tag is skipped), then its `beta.yml` if there is one and its `latest.yml` otherwise.

Rules the app applies to what it finds (`src/features/updates/core/version.ts`): never a downgrade, never the same version, pre-releases only on the beta channel and only `-beta.N`. A beta user is moved on to the release of the same version when it appears.

The version in the repository between releases is a `-dev.N` version (`2.0.0-dev.0` until 2.0.0 is out). It is older than its own release, so a development build updates to the release and to nothing else, and nothing ever goes back to 1.1.0: `2.0.0-dev.0 -> 2.0.0` is taken, `2.0.0 -> 1.1.0` and `2.0.0-dev.0 -> 1.1.0` are refused as not newer (`src/features/updates/core/updates.test.ts`).

## How updating works for the user

- Checks: a few seconds after the start and once a day, on the chosen channel. Settings > Updates has the switch, the channel and "Check now"; Settings > About shows the version and channel.
- A newer version downloads in the background. Nothing is installed during the session by itself.
- It is installed when the user presses "Restart to install", or silently when RigReady quits. Never while a game is running (any game module's program, or the program a setup launches): the button says which game, and the quit leaves the update for next time.
- With automatic checks off, nothing is checked, downloaded or installed on quit. "Check now" and "Restart to install" still work.
- The update is the same per-user installer run silently. It needs no administrator rights and keeps the data folder, the shortcuts and the Start with Windows entry. Started by the app rather than from a browser, it carries no mark of the web, so SmartScreen does not ask (see Code signing).

## Steps, for any release

1. A pull request to `main` that
   - sets the version in `package.json` and `package-lock.json` together: `npm version <version> --no-git-tag-version`;
   - dates the changelog: `## <version> (not released)` becomes `## <version> (<YYYY-MM-DD>)`;
   - previews the release's description: `node scripts/release-notes.mjs <version> artifacts/release-notes.md`;
   - passes `npm run check`.

   A pull request, not a push: `main` is protected by the `protect-default-branch` ruleset (no deletion, no force push, the three CI jobs are required checks, nobody bypasses), and CI runs only on pull requests and on `main`, so a commit can only arrive there through a pull request whose checks passed. Tags are not covered by the ruleset.
2. Merge it. On the rig, on `main` at that commit, from a normal (not elevated) terminal: `npm run test:e2e`, `npm run rig:smoke`, `npm run smoke:packaged`, `npm run smoke:installer`. Fill in the table below.
3. Tag the merge commit and push the tag:
   ```
   git checkout main && git pull --ff-only
   node -p "require('./package.json').version"      # must print <version>
   git tag -a v<version> -m "RigReady <version>"
   git push origin v<version>
   ```
4. The Release workflow (`.github/workflows/release.yml`, about 45 minutes on GitHub's Windows runner) checks the tag against `package.json`, makes the release notes, runs `npm run check`, `npm run test:e2e` and `npm run smoke:packaged`, builds the installer (`npm run dist`, which never publishes) and creates a **draft** GitHub release with the three files. Follow it with `gh run list --repo MCheli/RigReady --workflow release.yml` and `gh run watch`. If it fails: fix on `main` through a pull request, delete the tag (`git push --delete origin v<version>`, `git tag -d v<version>`) and tag the fixed commit. A draft it had already created is deleted by hand on GitHub.
5. Verify the draft (next section) and work through the checklist against its installer.
6. Publish the draft: on its GitHub page, Edit, make sure "Set as the latest release" is ticked and "Set as a pre-release" is not (for a beta the other way round), Publish release. Or `gh release edit v<version> --repo MCheli/RigReady --draft=false --latest`. From that moment installed apps on the channel find it, and rigready.io rebuilds itself: the release event starts a build of `main` (`.github/workflows/site.yml`), which reads the published releases, so the download buttons, the changelog's link and `/download/latest/` point at the new installer within a few minutes (`site/README.md`).
7. Afterwards, a pull request that moves `main` to the next development version: `npm version <next>-dev.0 --no-git-tag-version` (`2.1.0-dev.0` after 2.0.0; `2.0.1-dev.0` if the next one will be a patch). The changelog gets its `## <next> (not released)` heading with the first change that lands, not before: the website shows the changelog's first section open.

To withdraw a release: delete it (or mark it as a draft again) on GitHub. GitHub's "latest" then falls back to the previous release, whose version is not newer than what installed apps run, so they do nothing. An app that already updated stays on the withdrawn version until a newer one is published; there is no downgrade.

### Verifying the draft

```
gh release view v<version> --repo MCheli/RigReady --json isDraft,isPrerelease,name,assets,body
```

- `isDraft` is true; `isPrerelease` is false for a release and true for a beta.
- Exactly three assets: `RigReady-Setup-<version>.exe` (about 130 MB), `RigReady-Setup-<version>.exe.blockmap` (about 140 KB), `latest.yml` (under 1 KB).
- The body is the changelog section, nothing else.

Then download the installer and the feed file and check that they describe each other (PowerShell; `gh` finds a draft when it is logged in as the owner):

```
gh release download v<version> --repo MCheli/RigReady --dir "$env:TEMP\rigready-<version>"
Get-Content "$env:TEMP\rigready-<version>\latest.yml"
$sha = [Security.Cryptography.SHA512]::Create()
$stream = [IO.File]::OpenRead("$env:TEMP\rigready-<version>\RigReady-Setup-<version>.exe")
[Convert]::ToBase64String($sha.ComputeHash($stream)); $stream.Dispose()
Get-AuthenticodeSignature "$env:TEMP\rigready-<version>\RigReady-Setup-<version>.exe"
```

`version:` in `latest.yml` is `<version>` (not `-dev`), `path:` and `url:` name the installer, `size:` is the file's size, and the base64 string printed equals both `sha512:` lines. The signature status is `NotSigned`: expected, see Code signing.

## Checklist

Copy this into the release's description or the pull request and fill it in. A release is not published with an empty box.

### Automated, on the rig

| Check | Command | Result (date, numbers) |
|---|---|---|
| Unit, lint, types, ledger | `npm run check` | |
| Scenario end-to-end | `npm run test:e2e` | |
| Real hardware, read-only | `npm run rig:smoke` | |
| Packaged app: enumeration, scenario, live input, input reader failure, updater against a local feed, start with Windows | `npm run smoke:packaged` | Play screen usable after ____ ms (limit 2000) |
| Memory idle in the tray, ten minutes | `RIGREADY_MEMORY_SETTLE_SECONDS=600 npx playwright test --config playwright.packaged.config.ts -g "memory"` | ____ MB (limit 250) |
| Installer: install without elevation, start, update on quit, uninstall keeps or removes data | `npm run smoke:installer` | |

### By hand, with the installer from the draft release

Windows 11 (the rig):

- [ ] Installs by double-click with no UAC prompt, into `%LOCALAPPDATA%\Programs\RigReady`; the installer never asks "for all users".
- [ ] Start menu entry and desktop shortcut start it; the Play screen shows the last setup.
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

## Release 2.0.0: the runbook

The release path has never been exercised: 2.0.0 is the first tag since the rebuild and the first run of the Release workflow. The facts it rests on, as of 2026-11-06:

- `main` has the ruleset described in step 1 above. The repository's default workflow token is read-only; `release.yml` asks for `contents: write` itself, which is all a draft needs. The Pages environment deploys from `main` only, which is what the site workflow's release job dispatches.
- GitHub Releases holds v1.1.0 (marked Latest, February 2026) and v1.0.1, each with an installer and a `latest.yml`. They stay: the website ignores 1.x (it shows the newest release of the major version in `package.json`), and a 2.0.0 install never goes back to them.
- Installing 2.0.0 over 1.1.0, and what 1.1.0 installs do when 2.0.0 is out, are worked out under "Upgrading from 1.1.0" below. Short version: 1.1.0 is replaced in place, its data folder is kept, and 1.1.0 copies do not update themselves.
- On 2026-11-06 CI on `main` failed (#19's push run) with five unit tests timing out at 30 s on the runner, the suite having taken 694 s; the same commit had passed as a pull request. The check job now switches the runner's virus scanner off like the other jobs, and the Release workflow does too. If a job times out anyway, re-run it before looking for a bug.
- The build here on 2026-11-06, `npm ci && npm run setup:python && npm run dist` on a worktree of `main`: `release/RigReady-Setup-2.0.0-dev.0.exe` 133,461,160 bytes, `.exe.blockmap` 139,841 bytes, `latest.yml` 363 bytes naming the installer, its size and SHA-512; about six minutes in all, unsigned, built by electron-builder 26.18.1 with Electron 44.10.1.

The release day is the `<date>` below. Everything before "Part C" can be done ahead of it, as long as the changelog carries the day the draft will be published.

### Part A: automated (CI, the Release workflow, the website)

1. The release pull request, on a branch `release/2.0.0` from `main`:
   ```
   git checkout main && git pull --ff-only && git checkout -b release/2.0.0
   npm version 2.0.0 --no-git-tag-version
   ```
   `CHANGELOG.md`: `## 2.0.0 (not released)` becomes `## 2.0.0 (<date>)`, and the sentence "Version 2.0.0 has not been published; there is no installer to download yet." is removed from the paragraph under it.

   `README.md`, the "Status" section, becomes:
   > Version 2.0.0, released <date>, is a rebuild from the ground up; the installer is on [rigready.io/download](https://rigready.io/download/). `docs/requirements/ledger.yaml` lists every requirement with its status and the evidence for it; `CHANGELOG.md` summarises what 2.0.0 contains and what is still open.

   Then:
   ```
   node scripts/release-notes.mjs 2.0.0 artifacts/release-notes.md    # read the file: it is the release's description
   npm run check
   git commit -am "Release 2.0.0"
   git push -u origin release/2.0.0
   gh pr create --repo MCheli/RigReady --fill
   ```
   CI runs the three checks on the pull request (about 35 minutes: the check job, then the end-to-end and packaged jobs side by side). Merge when they are green. The merge rebuilds the website (package.json changed), which still says 2.0 is coming: there is no release yet.
2. After Part B's runs on the merge commit, the tag:
   ```
   git checkout main && git pull --ff-only
   node -p "require('./package.json').version"      # 2.0.0
   git tag -a v2.0.0 -m "RigReady 2.0.0"
   git push origin v2.0.0
   gh run list --repo MCheli/RigReady --workflow release.yml --limit 1
   gh run watch --repo MCheli/RigReady
   ```
   The Release workflow: tag check, release notes, `npm run check`, `npm run test:e2e`, `npm run setup:python`, `npm run smoke:packaged`, `npm run dist`, draft release with `RigReady-Setup-2.0.0.exe`, `RigReady-Setup-2.0.0.exe.blockmap`, `latest.yml`, and the changelog section as its description. About 45 minutes.
3. Verify the draft as described above. Nothing is published yet: a 2.0.0 install from the draft's installer that checks for updates sees v1.1.0 as GitHub's latest release and says it is up to date.
4. After the owner publishes (Part C): `gh run list --repo MCheli/RigReady --workflow site.yml --limit 3` shows the release event's run and the build of `main` it started. A few minutes later https://rigready.io/download/ shows "RigReady 2.0.0" with the installer's size and date, the home page's button says "Download for Windows", https://rigready.io/download/latest/ lands on `RigReady-Setup-2.0.0.exe` on GitHub, and the changelog's 2.0.0 entry links to the release. Nothing on the site is edited by hand.
5. The day after: a pull request with `npm version 2.1.0-dev.0 --no-git-tag-version` (or `2.0.1-dev.0`).

### Part B: done by the coordinator on the rig

On `main` at the release commit (after step A1 merged, before the tag), from a normal (not elevated) terminal, while no other RigReady test is using the desktop:

```
npm ci
npm run check
npm run test:e2e
npm run rig:smoke
npm run setup:python
npm run smoke:packaged
RIGREADY_MEMORY_SETTLE_SECONDS=600 npx playwright test --config playwright.packaged.config.ts -g "memory"
npm run smoke:installer
```

Fill in the "Automated, on the rig" table with the date and the numbers. `smoke:installer` installs and removes the "RigReady Test" variant only; the real 1.1.0 install is checked byte for byte afterwards.

After the draft exists: verify it (commands above), leave the downloaded installer in `%TEMP%\rigready-2.0.0` for the owner, and copy the filled-in checklist into the draft's description under the changelog section (keep the section; the app shows its first line).

The coordinator does not run the real installer, touch `%LOCALAPPDATA%\Programs\RigReady`, `%USERPROFILE%\.rigready` or the installed 1.1.0, or publish.

### Part C: needs the owner at the PC

1. Install 2.0.0 over 1.1.0 on the rig: quit RigReady 1.1.0 from its tray icon (the installer would otherwise ask to close it, and close it). Double-click `%TEMP%\rigready-2.0.0\RigReady-Setup-2.0.0.exe`. Windows shows "Windows protected your PC": More info, Run anyway. No UAC prompt, no "for all users" page; the destination offered is the existing `%LOCALAPPDATA%\Programs\RigReady`. Finish starts 2.0.0. Expect the Play screen without a setup and, on the Setups page, the version 1 setup files listed apart; `%USERPROFILE%\.rigready` is still there with everything version 1 wrote.
2. Work through the Windows 11 checklist above. "Installing over the previous version" is this install; "the previous version, left running, finds this release" is skipped for 2.0.0 (1.1.0 does not download updates, see below) and ticked for the `smoke:installer` proof instead. Note `winver`.
3. Windows 10 22H2 on a second PC or a virtual machine, with a standard user account: that part of the checklist.
4. Publish the draft (step 6 of "Steps, for any release"). Then, on the rig, Settings > Updates > Check now says the app is up to date: 2.0.0 is not newer than 2.0.0.
5. Tell the people who have 1.1.0: it does not update itself, the download page has the installer, and version 1 setups are not carried over.

## Upgrading from 1.1.0

What the 2.0.0 installer does on a PC that has 1.1.0, from electron-builder's NSIS scripts (`node_modules/app-builder-lib/templates/nsis`) and `build/installer.nsh`. 1.1.0 was built by electron-builder 26.4.0 with the same settings that matter here: `appId` `io.rigready.app`, product name `RigReady`, per-user, assisted (not one-click), a choosable folder, no custom installer script.

- Both are per-user installs with the same app id, so 1.1.0's registry entries are found under `HKCU` (`Software\io.rigready.app` and the Uninstall key of the same name): the install folder is read from them and offered as the destination, `%LOCALAPPDATA%\Programs\RigReady` unless 1.1.0 was put elsewhere.
- A running `RigReady.exe` is noticed: the installer asks to close it and ends it.
- 1.1.0's own uninstaller is copied out of the folder and run silently (`/S /KEEP_APP_DATA /currentuser --updated`) before anything is copied. It removes 1.1.0's files, its desktop and Start menu shortcuts and its uninstall entry. It keeps `%APPDATA%\RigReady` (Electron's own folder) and never looks at `%USERPROFILE%\.rigready`: the setups, settings and logs of version 1 stay where they are.
- 2.0.0's files are then written into the same folder, the uninstall entry says 2.0.0, and the two shortcuts are created again. `build/installer.nsh` only runs on an uninstall that is not an update, so it plays no part in this.
- 2.0.0 does not read version 1's data. Its `settings.json` gets defaults for what the new one lacks and unknown fields do no harm (`tests/unit/settingsInventory.test.ts`); the version 1 setup files are listed apart on the Setups page, where they can be deleted.

Will 1.1.0 installs update themselves to 2.0.0 once it is published? No. 1.1.0's updater (`src/main/services/updateService.ts` at tag `v1.1.0`) read the same GitHub feed (`publish: github, MCheli/RigReady`, so `/releases/latest` and its `latest.yml`), but it only checked on start when its "Check for updates" setting was on (off by default), it never downloaded by itself (`autoDownload = false`, and nothing in its interface called the download), and all it ever showed was "Update available: v2.0.0" on its Settings page after a check. So a 1.1.0 copy with the check on sees that line, and nothing else happens; the person installs 2.0.0 from the download page, as above. That is acceptable: 2.0.0 does not migrate version 1 data, so an unattended update would gain nobody anything, and a deliberate install is the right moment to read that the setups are not carried over.

## Code signing

The installer and the app are not signed; there is no certificate. What that means today, on Windows 11 and 10:

- An installer downloaded by a browser carries the mark of the web. Starting it shows Microsoft Defender SmartScreen's blue dialog, "Windows protected your PC": "Microsoft Defender SmartScreen prevented an unrecognized app from starting", app `RigReady-Setup-<version>.exe`, publisher Unknown. "Run anyway" appears only after "More info". Edge and Chrome may also hold the download ("isn't commonly downloaded", "may be dangerous"): Keep, then Keep anyway.
- The update the installed app downloads is started by the app, not from a browser, so it carries no mark of the web, SmartScreen does not ask, and it installs silently.
- SmartScreen's reputation builds up as more people run the very same file; every new installer starts over.
- The download page says so (`site/pages/download.html` and the download card in `site/build.mjs`), so nobody reads the dialog as a verdict on the app.

Signing needs a certificate (an OV or EV code-signing certificate, or Azure Trusted Signing) and the signing step in `npm run dist`; it is a separate decision, and nothing in the workflow is prepared for it.

## What the tools do and do not do

- `npm run pack` builds the unpacked app in `release/win-unpacked` (what `smoke:packaged` runs). `npm run dist` builds the installer, its block map and `latest.yml` in `release/`. Both pass `--publish never`: electron-builder uploads nothing, ever. The only upload is the workflow's release step, and it makes a draft.
- `scripts/release-notes.mjs <version> <file>` writes the version's changelog section to a file, and refuses a heading that still says "(not released)". The Release workflow runs it before the tests.
- `npm run smoke:installer` builds a variant called "RigReady Test" (`scripts/build-test-installer.mjs`): another app id, name, shortcut, install folder, update cache and data folder (`%USERPROFILE%\.rigready-installer-test`), so it can be installed and removed on a PC that has a real RigReady without touching it. The test checks that the real install, its shortcuts, its uninstall entry, its data folder and the Windows startup list are byte for byte the same afterwards.
- The update feed can be pointed at a folder served on the same PC with `RIGREADY_UPDATE_FEED=http://127.0.0.1:<port>/` (the smoke tests do). Any other address is ignored: an environment variable cannot make the app download from somewhere else.
- A silent uninstall keeps the data: `"Uninstall RigReady.exe" /S`. To remove it too: `"Uninstall RigReady.exe" /S --remove-data`. Only a folder that has RigReady's log in it is ever removed.
- CI (`.github/workflows/ci.yml`) runs the checks, the scenario end-to-end tests and the packaged smoke on `windows-latest`, on pull requests and on `main`. A runner has no game controller and no desktop session of a user, so the tests that need those skip themselves there; they run on the rig.
- RigReady is built for Windows only (the build configuration has no other target), and the app refuses to start anywhere else with a message that says so.
