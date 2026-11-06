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

1. On `main`, with a clean tree: set `version` in `package.json` (and `package-lock.json`: `npm version <version> --no-git-tag-version`), and in `CHANGELOG.md` replace "(not released)" in the version's heading with the date.
2. `npm run check`, `npm run test:e2e`.
3. On the rig (a PC with controllers, not a CI runner), from a normal (not elevated) terminal:
   - `npm run rig:smoke`
   - `npm run smoke:packaged`
   - `npm run smoke:installer`
4. Commit, tag `v<version>`, push the tag. The Release workflow runs the checks again, builds the installer (`npm run dist`, which never publishes; signed when the repository holds the signing configuration, see "Code signing" below), verifies the signatures of a signed build, and creates a **draft** GitHub release with the installer, the block map and the feed file.
5. Work through the checklist below against the installer from the draft.
6. Publish the draft. From that moment installed apps on the channel find it, and rigready.io rebuilds itself: its download buttons and `/download/latest` point at the new installer within a few minutes (`.github/workflows/site.yml`, `site/README.md`).

To withdraw a release: delete it (or mark it as a draft again) on GitHub. Installed apps then see the previous one, which is not newer than what they run, and do nothing. An app that already updated stays on the withdrawn version until a newer one is published; there is no downgrade.

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

## What the tools do and do not do

- `npm run pack` builds the unpacked app in `release/win-unpacked` (what `smoke:packaged` runs). `npm run dist` (`scripts/dist.ts`) builds the installer in `release/`. Both pass `--publish never`: electron-builder uploads nothing, ever. The only upload is the workflow's release step.
- `npm run dist` signs the installer when the signing configuration is in the environment and builds it unsigned when none of it is ("Code signing" below). `npm run pack` and the installer smoke's test variant never sign.
- `npm run smoke:installer` builds a variant called "RigReady Test" (`scripts/build-test-installer.mjs`): another app id, name, shortcut, install folder, update cache and data folder (`%USERPROFILE%\.rigready-installer-test`), so it can be installed and removed on a PC that has a real RigReady without touching it. The test checks that the real install, its shortcuts, its uninstall entry, its data folder and the Windows startup list are byte for byte the same afterwards.
- The update feed can be pointed at a folder served on the same PC with `RIGREADY_UPDATE_FEED=http://127.0.0.1:<port>/` (the smoke tests do). Any other address is ignored: an environment variable cannot make the app download from somewhere else.
- A silent uninstall keeps the data: `"Uninstall RigReady.exe" /S`. To remove it too: `"Uninstall RigReady.exe" /S --remove-data`. Only a folder that has RigReady's log in it is ever removed.
- CI (`.github/workflows/ci.yml`) runs the checks, the scenario end-to-end tests and the packaged smoke on `windows-latest`. A runner has no game controller and no desktop session of a user, so the tests that need those skip themselves there; they run on the rig.
- RigReady is built for Windows only (the build configuration has no other target), and the app refuses to start anywhere else with a message that says so.

## Code signing

The Release workflow signs the installer through Azure Artifact Signing (Microsoft's signing service, called Trusted Signing until 2025; the PowerShell module and some portal pages still carry that name) when the repository holds the signing configuration, and builds the plain unsigned installer when it holds none of it. `npm run dist` (`scripts/dist.ts`, with the decision in `scripts/lib/signing.ts`) reads the configuration from the environment, writes the electron-builder configuration it composed to `release/electron-builder.config.json`, prints `code signing: off` or `code signing: on (<publisher>, <account>/<profile>)`, and after the build reads the feed file inside the package (`release/win-unpacked/resources/app-update.yml`): a signed build must name the publisher there and an unsigned build must not, or the build fails. `npm run pack` and the installer smoke's test variant never sign, whatever the environment holds.

### The configuration

Repository variables (Settings > Secrets and variables > Actions) and secrets, with exactly these names:

| Name | Kind | Value |
|---|---|---|
| `RIGREADY_SIGN_ENDPOINT` | variable | The account's endpoint, `https://<region>.codesigning.azure.net` (East US: `https://eus.codesigning.azure.net`) |
| `RIGREADY_SIGN_ACCOUNT` | variable | The Artifact Signing account's name |
| `RIGREADY_SIGN_PROFILE` | variable | The certificate profile's name |
| `RIGREADY_SIGN_PUBLISHER` | variable | The certificate's subject CN: the legal name the identity validation verified, exactly as the certificate carries it |
| `AZURE_TENANT_ID` | secret | The Entra directory (tenant) id |
| `AZURE_CLIENT_ID` | secret | The app registration's application (client) id |
| `AZURE_CLIENT_SECRET` | secret | The app registration's client secret |

Either all seven are set or none of them. With all seven the build is signed; with none it is unsigned; with anything in between `npm run dist` stops with a message naming what is set and what is not, so a release meant to be signed is never built unsigned by accident and a signing attempt never starts half configured. The workflow passes the seven to the "Build installer" step and to no other. The three secrets are what the TrustedSigning PowerShell module reads to sign in (Azure.Identity's environment credential); electron-builder installs that module on the runner and runs `Invoke-TrustedSigning` on each file it signs (`win.azureSignOptions` in the composed configuration), and nothing else needs installing there.

### What signing does, and what it does not

- The installer, `RigReady.exe` and `Uninstall RigReady.exe` carry a signature with a timestamp, chained to a Microsoft root. Windows shows the certificate's subject as the publisher: in SmartScreen's dialog, in the file's properties and in the uninstall prompt. For an individual's certificate that is the person's verified legal name, not "RigReady".
- The installed app verifies every update before it is installed. electron-updater reads the publisher from `resources/app-update.yml` (electron-builder writes it there for a signed build), runs `Get-AuthenticodeSignature` on the downloaded installer and requires a valid signature whose subject CN is that name (`NsisUpdater.verifySignature` and `windowsExecutableCodeSignatureVerifier.js` in electron-updater). Anything else, an unsigned file or another name, is refused with `ERR_UPDATER_INVALID_SIGNATURE` and deleted; Settings > Updates shows the error, the log has it, and the next check tries again. An installed copy with no publisher in its feed file (every build from before signing) verifies nothing and takes a signed update like any other.
- SmartScreen is not satisfied by the signature alone. Reputation accrues to the certificate's identity and to each file as people download and run it; a signed installer from a new identity can still get "Windows protected your PC" for a while, now with the publisher's name in the dialog instead of "Unknown publisher". The service's certificates are short-lived and renewed by itself; Microsoft states that reputation follows the validated identity from one certificate to the next.
- Who can sign: whoever holds the app registration's secret and the Certificate Profile Signer role on the account. The secret lives only in the repository's secrets, and a signed build runs only in the Release workflow, on a `v*` tag. A client secret expires (two years at most): make a new one in Azure and in the repository before then, or the next release build fails at signing.

### The rule that never changes: a signed release is never followed by an unsigned one

An installed signed copy carries the publisher in its feed file and refuses every update that is not signed under that name. If a release were ever published unsigned after signed ones, every installed copy would download it, refuse it, and keep refusing until a signed release appeared; the only way forward for a user would be to download and install by hand. So, from the first signed release on:

- The seven values are never removed from the repository, and the variables keep their values. A new certificate profile or account is fine as long as the certificate's subject stays the same name. A change of the name (a company instead of the person, say) needs a release signed under the old name whose feed file accepts both names first, which is work not done yet.
- A withdrawn release is withdrawn, not replaced by an unsigned build.
- The other direction is free: an unsigned install (every copy from before signing) takes a signed update.

### Setup in Azure, for an individual

Microsoft's own pages are the source for the current screens; this is the shape of it.

1. A subscription: pay-as-you-go, created with a billing account of type Individual. Identity validation checks the subscription's billing profile against the ID, so the billing account has to be an individual one in the same legal name, not an organization's.
2. Register the resource provider `Microsoft.CodeSigning` on the subscription (the subscription's Resource providers page).
3. Create an Artifact Signing (Trusted Signing) account: a resource group, a region that offers the service (East US gives the endpoint `https://eus.codesigning.azure.net`; each region has its own `<region>.codesigning.azure.net`), the Basic SKU. The account name is `RIGREADY_SIGN_ACCOUNT`.
4. On the account's Access control (IAM), give yourself the Artifact Signing Identity Verifier role (the subscription's Owner does not have it by default; the portal may still list it under the Trusted Signing name).
5. Identity validation: Public Trust, Individual. The legal name and address as on the government ID, a contact e-mail, then Microsoft's identity check (a photo of the ID and a face check, on a phone). It can take days, and Microsoft may ask for more. The name it verifies is the certificate's subject: `RIGREADY_SIGN_PUBLISHER`, exactly as the completed validation shows it.
6. A certificate profile: type Public Trust, bound to the validation. Its name is `RIGREADY_SIGN_PROFILE`.
7. An app registration (Microsoft Entra ID > App registrations > New registration; single tenant, no redirect). Note its Application (client) ID and the Directory (tenant) ID; under Certificates & secrets make a client secret and note its value and expiry. On the signing account's IAM, give the app's service principal the Artifact Signing Certificate Profile Signer role.
8. In the GitHub repository, the four variables and the three secrets. Then tag a release: the build step prints `code signing: on (...)` and the "Verify the signatures" step runs.

### Verifying a draft

- The workflow's "Verify the signatures" step runs after a signed build (`scripts/verify-signed-installer.ps1`): `signtool verify /pa /v` and `Get-AuthenticodeSignature` (status Valid, subject CN equal to the publisher, compared the way electron-updater compares them) on the installer; a silent install into a temporary folder; the same checks on `RigReady.exe` and `Uninstall RigReady.exe` there and the publisher in `resources\app-update.yml` there; a silent uninstall. No draft is made when it fails.
- By hand, on the installer downloaded from the draft: `signtool verify /pa /v RigReady-Setup-<version>.exe` (signtool comes with the Windows SDK, under `C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64`), or the file's Properties > Digital Signatures. The script does the same with `pwsh scripts/verify-signed-installer.ps1 -Installer <file> -Publisher "<the name>" -SignaturesOnly`; without `-SignaturesOnly` it installs and uninstalls the real RigReady for the account that runs it, and it refuses to do that on a PC where RigReady is installed.
- On the rig: the previous version, left running, updates to the draft through a local feed (the checklist above), and the log has no `ERR_UPDATER_INVALID_SIGNATURE`.

### When the first signed release goes out

- Say so in `CHANGELOG.md` and in the release notes, with the name the dialogs show.
- `site/build.mjs`, the download card: it says SmartScreen may warn until the installer has earned a reputation, which is true before and after signing. Once SmartScreen stops warning on a fresh PC, drop the sentence; until then it can also name the publisher so people know what to expect in the dialog.
- The user guide has no SmartScreen or installation troubleshooting page today. If one is written, it should say which name the dialog shows and that "Unknown publisher" on a RigReady installer means a download that is not from GitHub Releases or rigready.io, or a version from before signing.
