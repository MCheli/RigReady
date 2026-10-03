# src/legacy — reference material, not part of the app

Code from the 1.1.0 app, parked for feature work to mine. Nothing here is compiled,
linted, tested or bundled, and nothing may import from it (ESLint enforces that).
Copy the logic you need into your feature's `core/`, port it to the ports in
`src/core/ports`, give it tests, then delete the file from here.

| File | Why it is kept |
|---|---|
| `dcsKeybindingService.ts`, `keybindingProfileService.ts`, `keybindingManager.ts`, `bindingAnalysisService.ts`, `dcsUuidMigrationService.ts` | Binding scan, duplicate detection, per-device views, snapshot/restore and device-GUID migration logic. |
| `dcsTypes.ts` | Types those services share. The Lua parser they import was replaced by `src/core/lua` and removed from here. |
| `streamDeckService.ts`, `streamDeckTypes.ts` | Stream Deck profile backup/restore and install detection. |
| `dcsMonitorSetupService.ts` | Reading and writing DCS MonitorSetup Lua. |
| `simulatorConfigService.ts`, `gameLaunchService.ts`, `beamngIntegration.ts`, `lmuIntegration.ts` | Per-game install detection, config paths and launch details (inputs for `GameModule`s). |
| `tests/` | The old Jest tests for the files above; useful as specifications. They do not run. |

Everything else from 1.1.0 (old IPC, views, PowerShell device scripts, bundle/privacy
services) was deleted and is in git history at commit `e6b224c`.
