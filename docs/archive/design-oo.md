# RigReady - Object-Oriented Design Document

## Overview

This document describes the object-oriented design for RigReady, including core entities, interfaces, relationships, and design patterns.

---

## Design Principles

1. **Separation of Concerns**: Each class has a single responsibility
2. **Open/Closed**: Open for extension (new games, new hardware), closed for modification
3. **Dependency Inversion**: Depend on abstractions (interfaces), not concrete implementations
4. **Composition over Inheritance**: Prefer composing behaviors rather than deep hierarchies

---

## Domain Areas

1. [Profile Management](#1-profile-management)
2. [Checklist System](#2-checklist-system)
3. [Device Management](#3-device-management)
4. [Game Integration](#4-game-integration)
5. [Keybinding Management](#5-keybinding-management)
6. [Configuration Backup](#6-configuration-backup)
7. [Display Management](#7-display-management)
8. [Script Integration](#8-script-integration)
9. [Event System](#9-event-system)

---

## 1. Profile Management

### ProfileManager

Manages the collection of all profiles.

```
┌─────────────────────────────────────────────────────────────┐
│ ProfileManager                                               │
├─────────────────────────────────────────────────────────────┤
│ - profiles: List<Profile>                                   │
│ - activeProfile: Profile                                    │
│ - lastUsedProfileId: string                                 │
│ - profileDirectory: string                                  │
├─────────────────────────────────────────────────────────────┤
│ + loadProfiles(): void                                      │
│ + saveProfile(profile: Profile): void                       │
│ + deleteProfile(profileId: string): void                    │
│ + cloneProfile(source: Profile, newName: string): Profile   │
│ + setActiveProfile(profileId: string): void                 │
│ + getActiveProfile(): Profile                               │
│ + importProfile(path: string): Profile                      │
│ + exportProfile(profile: Profile, path: string): void       │
│ + getProfileById(id: string): Profile | null                │
│ + listProfiles(): List<ProfileSummary>                      │
└─────────────────────────────────────────────────────────────┘
```

### Profile

The main container representing a "ready state" for a specific use case.

```
┌─────────────────────────────────────────────────────────────┐
│ Profile                                                      │
├─────────────────────────────────────────────────────────────┤
│ - id: string (UUID)                                         │
│ - name: string                                              │
│ - description: string                                       │
│ - createdAt: DateTime                                       │
│ - lastUsed: DateTime                                        │
│ - game: Game | null                                         │
│ - launchTarget: LaunchTarget                                │
│ - checklistItems: List<ChecklistItem>                       │
│ - trackedConfigurations: List<TrackedConfiguration>         │
├─────────────────────────────────────────────────────────────┤
│ + runAllChecks(): ChecklistResult                           │
│ + getFailedChecks(): List<ChecklistItem>                    │
│ + getWarningChecks(): List<ChecklistItem>                   │
│ + addChecklistItem(item: ChecklistItem): void               │
│ + removeChecklistItem(itemId: string): void                 │
│ + reorderChecklistItems(itemIds: List<string>): void        │
│ + copyItemsFrom(source: Profile, itemIds: List<string>): void│
│ + launch(): LaunchResult                                    │
│ + isReady(): boolean                                        │
│ + toYaml(): string                                          │
│ + fromYaml(yaml: string): Profile [static]                  │
└─────────────────────────────────────────────────────────────┘
```

### LaunchTarget

Configuration for launching the game.

```
┌─────────────────────────────────────────────────────────────┐
│ LaunchTarget                                                 │
├─────────────────────────────────────────────────────────────┤
│ - executablePath: string                                    │
│ - arguments: string                                         │
│ - workingDirectory: string                                  │
│ - runAsAdmin: boolean                                       │
│ - preLaunchScripts: List<ScriptAction>                      │
│ - postLaunchScripts: List<ScriptAction>                     │
├─────────────────────────────────────────────────────────────┤
│ + launch(): Process                                         │
│ + validatePath(): boolean                                   │
│ + executePreLaunchScripts(): List<ActionResult>             │
│ + executePostLaunchScripts(): List<ActionResult>            │
│ + resolvePath(variables: PathVariableResolver): string      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Checklist System

### ChecklistItem (Interface)

Abstract interface for all types of checks.

```
┌─────────────────────────────────────────────────────────────┐
│ <<interface>> ChecklistItem                                  │
├─────────────────────────────────────────────────────────────┤
│ + id: string                                                │
│ + name: string                                              │
│ + description: string                                       │
│ + isRequired: boolean                                       │
│ + category: CheckCategory                                   │
├─────────────────────────────────────────────────────────────┤
│ + check(): CheckResult                                      │
│ + getRemediation(): Remediation | null                      │
│ + getDisplayStatus(): DisplayStatus                         │
│ + toConfig(): object                                        │
└─────────────────────────────────────────────────────────────┘
```

### Check Implementations

```
┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
│ ProcessCheck      │    │ DeviceCheck       │    │ DisplayCheck      │
├───────────────────┤    ├───────────────────┤    ├───────────────────┤
│ - processName     │    │ - deviceSpec:     │    │ - expectedLayout: │
│ - windowTitle     │    │   DeviceSpec      │    │   DisplayLayout   │
│ - exePath         │    ├───────────────────┤    ├───────────────────┤
├───────────────────┤    │ + isConnected()   │    │ + checkLayout()   │
│ + isRunning()     │    │ + matchDevice()   │    │ + checkRotation() │
│ + getProcess()    │    │ + getDevice()     │    │ + checkPosition() │
│ + getPID()        │    └───────────────────┘    └───────────────────┘
└───────────────────┘

┌───────────────────┐    ┌───────────────────┐
│ ConfigCheck       │    │ ScriptCheck       │
├───────────────────┤    ├───────────────────┤
│ - configPath      │    │ - command         │
│ - validation      │    │ - arguments       │
│ - backupRef       │    │ - workingDir      │
├───────────────────┤    │ - timeout         │
│ + validate()      │    │ - successCodes    │
│ + fileExists()    │    ├───────────────────┤
│ + checkContent()  │    │ + execute()       │
└───────────────────┘    │ + parseExitCode() │
                         └───────────────────┘
```

### CheckResult

Result of running a check.

```
┌─────────────────────────────────────────────────────────────┐
│ CheckResult                                                  │
├─────────────────────────────────────────────────────────────┤
│ - status: CheckStatus                                       │
│ - message: string                                           │
│ - details: Map<string, any>                                 │
│ - timestamp: DateTime                                       │
│ - duration: number (ms)                                     │
│ - remediation: Remediation | null                           │
│ - output: string | null (for script checks)                 │
├─────────────────────────────────────────────────────────────┤
│ + isPassed(): boolean                                       │
│ + isFailed(): boolean                                       │
│ + isWarning(): boolean                                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ CheckStatus (enum)                                           │
├─────────────────────────────────────────────────────────────┤
│ PASSED    - Check succeeded                                 │
│ FAILED    - Check failed (required item)                    │
│ WARNING   - Check failed (optional item)                    │
│ UNKNOWN   - Check could not be completed                    │
│ RUNNING   - Check is in progress                            │
│ SKIPPED   - Check was skipped                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ CheckCategory (enum)                                         │
├─────────────────────────────────────────────────────────────┤
│ HARDWARE       - Device/hardware checks                     │
│ SOFTWARE       - Process/service checks                     │
│ DISPLAY        - Monitor configuration checks               │
│ CONFIGURATION  - Config file checks                         │
│ CUSTOM         - Script/custom checks                       │
└─────────────────────────────────────────────────────────────┘
```

### Remediation System

```
┌─────────────────────────────────────────────────────────────┐
│ <<interface>> Remediation                                    │
├─────────────────────────────────────────────────────────────┤
│ + label: string                                             │
│ + description: string                                       │
│ + canAutoFix: boolean                                       │
│ + requiresConfirmation: boolean                             │
├─────────────────────────────────────────────────────────────┤
│ + execute(): RemediationResult                              │
│ + preview(): string                                         │
└─────────────────────────────────────────────────────────────┘

┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
│ LaunchProcess      │  │ AutoFixDisplay     │  │ RestoreConfig      │
│ Remediation        │  │ Remediation        │  │ Remediation        │
├────────────────────┤  ├────────────────────┤  ├────────────────────┤
│ - exePath          │  │ - targetLayout     │  │ - backupRef        │
│ - arguments        │  │ - monitor          │  │ - targetPath       │
│ - waitForStart     │  │ - rotation         │  │ - overwrite        │
├────────────────────┤  │ - position         │  ├────────────────────┤
│ canAutoFix: true   │  ├────────────────────┤  │ canAutoFix: true   │
└────────────────────┘  │ canAutoFix: true   │  └────────────────────┘
                        └────────────────────┘

┌────────────────────┐  ┌────────────────────┐
│ NotifyUser         │  │ ScriptRemediation  │
│ Remediation        │  │                    │
├────────────────────┤  ├────────────────────┤
│ - message          │  │ - command          │
│ - instructions     │  │ - arguments        │
│ - helpUrl          │  │ - workingDir       │
├────────────────────┤  │ - timeout          │
│ canAutoFix: false  │  ├────────────────────┤
└────────────────────┘  │ canAutoFix: true   │
                        └────────────────────┘
```

---

## 3. Device Management

### DeviceManager

Manages hardware device detection and monitoring.

```
┌─────────────────────────────────────────────────────────────┐
│ DeviceManager                                                │
├─────────────────────────────────────────────────────────────┤
│ - connectedDevices: List<Device>                            │
│ - knownDevices: List<DeviceSpec>                            │
│ - deviceListeners: List<DeviceEventListener>                │
├─────────────────────────────────────────────────────────────┤
│ + scanDevices(): List<Device>                               │
│ + getConnectedDevices(): List<Device>                       │
│ + findDevice(spec: DeviceSpec): Device | null               │
│ + matchDevice(device: Device, spec: DeviceSpec): MatchResult│
│ + onDeviceConnected(listener: DeviceEventListener): void    │
│ + onDeviceDisconnected(listener: DeviceEventListener): void │
│ + startInputCapture(device: Device): InputCaptureSession    │
│ + saveKnownDevice(device: Device, friendlyName: string): void│
└─────────────────────────────────────────────────────────────┘
```

### Device

Represents a physical hardware device.

```
┌─────────────────────────────────────────────────────────────┐
│ Device                                                       │
├─────────────────────────────────────────────────────────────┤
│ - vendorId: string (VID, e.g., "0x044F")                    │
│ - productId: string (PID, e.g., "0xB10A")                   │
│ - instancePath: string (Windows device instance)            │
│ - guid: string (DirectInput GUID - port specific)           │
│ - name: string (from driver)                                │
│ - friendlyName: string (user-assigned)                      │
│ - manufacturer: string                                      │
│ - type: DeviceType                                          │
│ - inputs: List<Input>                                       │
│ - isConnected: boolean                                      │
├─────────────────────────────────────────────────────────────┤
│ + getIdentifier(): string (VID:PID format)                  │
│ + matchesSpec(spec: DeviceSpec): boolean                    │
│ + getInput(index: number, type: InputType): Input           │
│ + getAllInputs(): List<Input>                               │
│ + toSpec(): DeviceSpec                                      │
│ + getDisplayName(): string                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ DeviceSpec                                                   │
│ (Portable specification - what profiles store)               │
├─────────────────────────────────────────────────────────────┤
│ - vendorId: string                                          │
│ - productId: string                                         │
│ - name: string (for display/matching fallback)              │
│ - friendlyName: string                                      │
│ - serialNumber: string | null (if available)                │
├─────────────────────────────────────────────────────────────┤
│ + matches(device: Device): MatchResult                      │
│ + getMatchScore(device: Device): number                     │
│ + getDisplayName(): string                                  │
└─────────────────────────────────────────────────────────────┘

Note: DeviceSpec uses VID/PID (stable across USB ports)
      Device.guid changes when plugged into different ports
```

### DeviceType

```
┌─────────────────────────────────────────────────────────────┐
│ DeviceType (enum)                                            │
├─────────────────────────────────────────────────────────────┤
│ JOYSTICK                                                    │
│ THROTTLE                                                    │
│ PEDALS                                                      │
│ WHEEL                                                       │
│ BUTTON_BOX                                                  │
│ MFD_PANEL                                                   │
│ KEYBOARD                                                    │
│ MOUSE                                                       │
│ HEADTRACKER                                                 │
│ OTHER                                                       │
└─────────────────────────────────────────────────────────────┘
```

### Input and Input Testing

```
┌─────────────────────────────────────────────────────────────┐
│ Input                                                        │
├─────────────────────────────────────────────────────────────┤
│ - index: number                                             │
│ - type: InputType                                           │
│ - name: string (e.g., "Button 3", "X Axis")                 │
│ - friendlyName: string | null (user-assigned)               │
│ - currentValue: number                                      │
│ - minValue: number                                          │
│ - maxValue: number                                          │
├─────────────────────────────────────────────────────────────┤
│ + getValue(): number                                        │
│ + isPressed(): boolean (for buttons)                        │
│ + getNormalizedValue(): number (0.0 to 1.0)                 │
│ + getDisplayName(): string                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ InputType (enum)                                             │
├─────────────────────────────────────────────────────────────┤
│ BUTTON                                                      │
│ AXIS                                                        │
│ HAT                                                         │
│ ROTARY                                                      │
│ SLIDER                                                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ InputCaptureSession                                          │
├─────────────────────────────────────────────────────────────┤
│ - device: Device                                            │
│ - isActive: boolean                                         │
│ - capturedInputs: List<CapturedInput>                       │
│ - listeners: List<InputEventListener>                       │
├─────────────────────────────────────────────────────────────┤
│ + start(): void                                             │
│ + stop(): void                                              │
│ + onInput(listener: InputEventListener): Subscription       │
│ + waitForInput(timeout: ms): CapturedInput                  │
│ + getLastInput(): CapturedInput                             │
│ + clearCaptured(): void                                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ CapturedInput                                                │
├─────────────────────────────────────────────────────────────┤
│ - device: Device                                            │
│ - input: Input                                              │
│ - value: number                                             │
│ - timestamp: DateTime                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Game Integration

### Game Interface

```
┌─────────────────────────────────────────────────────────────┐
│ <<interface>> Game                                           │
├─────────────────────────────────────────────────────────────┤
│ + id: string                                                │
│ + name: string                                              │
│ + icon: Image                                               │
├─────────────────────────────────────────────────────────────┤
│ + detectInstallation(): InstallationInfo | null             │
│ + getConfigPaths(): List<ConfigPath>                        │
│ + getDefaultLaunchTarget(): LaunchTarget                    │
│ + getBindingManager(): BindingManager | null                │
│ + getSpecializedChecks(): List<ChecklistItem>               │
│ + supportsFeature(feature: GameFeature): boolean            │
│ + resolvePathVariables(): Map<string, string>               │
└─────────────────────────────────────────────────────────────┘
```

### Game Implementations

```
┌─────────────────────────────────────────────────────────────┐
│ GenericGame implements Game                                  │
├─────────────────────────────────────────────────────────────┤
│ - userProvidedPaths: Map<string, string>                    │
│ - userProvidedExe: string                                   │
├─────────────────────────────────────────────────────────────┤
│ User provides all paths manually.                           │
│ No keybinding integration.                                  │
│ Basic process check support.                                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ DCSWorld implements Game                                     │
├─────────────────────────────────────────────────────────────┤
│ - variant: DCSVariant (Stable | OpenBeta | Steam)           │
│ - installPath: string                                       │
│ - savedGamesPath: string                                    │
├─────────────────────────────────────────────────────────────┤
│ + detectInstallation(): auto-detect from registry/paths     │
│ + getConfigPaths(): knows Saved Games/DCS structure         │
│ + getBindingManager(): returns DCSBindingManager            │
│ + parseMonitorSetup(): read/write MonitorSetup.lua          │
│ + parseOptions(): read options.lua                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ IRacing implements Game                                      │
├─────────────────────────────────────────────────────────────┤
│ + detectInstallation(): auto-detect                         │
│ + getConfigPaths(): Documents/iRacing/                      │
│ + parseJoyCalib(): read joyCalib.yaml                       │
│ + parseAppIni(): read app.ini for FFB settings              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ MSFS2024 implements Game                                     │
├─────────────────────────────────────────────────────────────┤
│ - installType: InstallType (Store | Steam)                  │
├─────────────────────────────────────────────────────────────┤
│ + detectInstallation(): detect Store vs Steam               │
│ + getConfigPaths(): version-specific paths                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ BeamNG implements Game                                       │
├─────────────────────────────────────────────────────────────┤
│ - version: string                                           │
├─────────────────────────────────────────────────────────────┤
│ + detectInstallation(): auto-detect                         │
│ + getConfigPaths(): versioned folder structure              │
│ + getCurrentVersion(): detect active version folder         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ LeMansUltimate implements Game                               │
├─────────────────────────────────────────────────────────────┤
│ + detectInstallation(): auto-detect via Steam               │
│ + getConfigPaths(): UserData/player/ structure              │
└─────────────────────────────────────────────────────────────┘
```

### Supporting Types

```
┌─────────────────────────────────────────────────────────────┐
│ GameFeature (enum)                                           │
├─────────────────────────────────────────────────────────────┤
│ KEYBINDING_MANAGEMENT   - Can read/write keybindings        │
│ PER_VEHICLE_BINDINGS    - Supports per-aircraft/car bindings│
│ MONITOR_CONFIGURATION   - Has monitor setup files           │
│ FFB_CONFIGURATION       - Has force feedback settings       │
│ CLOUD_SYNC              - Syncs settings to cloud           │
│ PROFILE_DETECTION       - Can detect active profile         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ InstallationInfo                                             │
├─────────────────────────────────────────────────────────────┤
│ - installPath: string                                       │
│ - version: string                                           │
│ - variant: string (e.g., "Steam", "Standalone")             │
│ - userDataPath: string                                      │
│ - isValid: boolean                                          │
├─────────────────────────────────────────────────────────────┤
│ + validate(): ValidationResult                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ConfigPath                                                   │
├─────────────────────────────────────────────────────────────┤
│ - path: string (with variable tokens)                       │
│ - description: string                                       │
│ - category: ConfigCategory                                  │
│ - isRequired: boolean                                       │
│ - supportsBackup: boolean                                   │
├─────────────────────────────────────────────────────────────┤
│ + resolve(variables: Map<string, string>): string           │
│ + exists(): boolean                                         │
│ + getFiles(): List<string>                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Keybinding Management

### BindingManager Interface

```
┌─────────────────────────────────────────────────────────────┐
│ <<interface>> BindingManager                                 │
├─────────────────────────────────────────────────────────────┤
│ + game: Game                                                │
├─────────────────────────────────────────────────────────────┤
│ + loadBindings(scope: BindingScope): BindingSet             │
│ + saveBindings(bindings: BindingSet): void                  │
│ + getDevicesWithBindings(): List<DeviceSpec>                │
│ + getBindingsForDevice(device: DeviceSpec): List<Binding>   │
│ + findDuplicateBindings(): List<DuplicateBinding>           │
│ + clearBindingsForDevice(device: DeviceSpec): void          │
│ + migrateDeviceId(oldId: string, newId: string): MigrateResult│
│ + createSnapshot(name: string): BindingSnapshot             │
│ + restoreSnapshot(snapshot: BindingSnapshot): void          │
│ + listSnapshots(): List<BindingSnapshot>                    │
└─────────────────────────────────────────────────────────────┘
```

### DCS Binding Manager

```
┌─────────────────────────────────────────────────────────────┐
│ DCSBindingManager implements BindingManager                  │
├─────────────────────────────────────────────────────────────┤
│ - savedGamesPath: string                                    │
│ - inputPath: string                                         │
├─────────────────────────────────────────────────────────────┤
│ + loadBindings(aircraft: string): BindingSet                │
│ + listAircraft(): List<string>                              │
│ + parseDiffLua(path: string): List<Binding>                 │
│ + writeDiffLua(bindings: List<Binding>, path: string): void │
│ + migrateUUID(oldUUID: string, newUUID: string): void       │
│ + findDuplicates(aircraft: string): List<DuplicateBinding>  │
│ + getDeviceUUIDs(): Map<string, string> (name → UUID)       │
└─────────────────────────────────────────────────────────────┘
```

### Binding Types

```
┌─────────────────────────────────────────────────────────────┐
│ BindingSet                                                   │
├─────────────────────────────────────────────────────────────┤
│ - game: Game                                                │
│ - scope: BindingScope                                       │
│ - scopeId: string | null (e.g., "FA-18C_hornet")            │
│ - bindings: List<Binding>                                   │
│ - devices: List<DeviceSpec>                                 │
├─────────────────────────────────────────────────────────────┤
│ + getBindingsForAction(action: string): List<Binding>       │
│ + getBindingsForInput(device, input): List<Binding>         │
│ + addBinding(binding: Binding): void                        │
│ + removeBinding(bindingId: string): void                    │
│ + findDuplicates(): List<DuplicateBinding>                  │
│ + getActions(): List<Action>                                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Binding                                                      │
├─────────────────────────────────────────────────────────────┤
│ - id: string                                                │
│ - action: Action                                            │
│ - device: DeviceSpec                                        │
│ - input: InputSpec                                          │
│ - modifiers: List<Modifier>                                 │
├─────────────────────────────────────────────────────────────┤
│ + matches(device: Device, input: Input): boolean            │
│ + getDisplayString(): string (e.g., "Ctrl+Button 3")        │
│ + hasModifiers(): boolean                                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Action                                                       │
├─────────────────────────────────────────────────────────────┤
│ - id: string (game-specific action ID)                      │
│ - name: string (display name)                               │
│ - category: string                                          │
│ - description: string                                       │
│ - inputType: InputType (BUTTON | AXIS)                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Modifier (enum)                                              │
├─────────────────────────────────────────────────────────────┤
│ LCTRL, RCTRL                                                │
│ LSHIFT, RSHIFT                                              │
│ LALT, RALT                                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ DuplicateBinding                                             │
├─────────────────────────────────────────────────────────────┤
│ - action: Action                                            │
│ - bindings: List<Binding>                                   │
│ - conflictType: ConflictType                                │
├─────────────────────────────────────────────────────────────┤
│ + getRecommendedResolution(): Binding                       │
│ + getDevicesInvolved(): List<DeviceSpec>                    │
│ + isIntentional(): boolean (modifier differences)           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ BindingSnapshot                                              │
├─────────────────────────────────────────────────────────────┤
│ - id: string                                                │
│ - name: string                                              │
│ - createdAt: DateTime                                       │
│ - game: Game                                                │
│ - scope: BindingScope                                       │
│ - scopeId: string | null                                    │
│ - bindingSets: List<BindingSet>                             │
│ - rawFiles: Map<string, bytes>                              │
├─────────────────────────────────────────────────────────────┤
│ + restore(): RestoreResult                                  │
│ + getFileCount(): number                                    │
│ + getSize(): number                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Configuration Backup

### BackupManager

```
┌─────────────────────────────────────────────────────────────┐
│ BackupManager                                                │
├─────────────────────────────────────────────────────────────┤
│ - backupLocation: string                                    │
│ - backups: List<Backup>                                     │
├─────────────────────────────────────────────────────────────┤
│ + createBackup(options: BackupOptions): Backup              │
│ + restoreBackup(backup: Backup, options: RestoreOptions): RestoreResult│
│ + listBackups(): List<Backup>                               │
│ + deleteBackup(backupId: string): void                      │
│ + exportBackup(backup: Backup, path: string): void          │
│ + importBackup(path: string): Backup                        │
│ + validateBackup(backup: Backup): ValidationResult          │
│ + getBackupSize(backup: Backup): number                     │
└─────────────────────────────────────────────────────────────┘
```

### Backup Types

```
┌─────────────────────────────────────────────────────────────┐
│ Backup                                                       │
├─────────────────────────────────────────────────────────────┤
│ - id: string                                                │
│ - name: string                                              │
│ - description: string                                       │
│ - createdAt: DateTime                                       │
│ - sourceMachine: MachineInfo                                │
│ - rigReadyVersion: string                                   │
│ - profiles: List<ProfileSnapshot>                           │
│ - configurations: List<ConfigurationSnapshot>               │
│ - bindingSnapshots: List<BindingSnapshot>                   │
│ - metadata: Map<string, any>                                │
├─────────────────────────────────────────────────────────────┤
│ + getContents(): BackupContents                             │
│ + getSize(): number                                         │
│ + isCompatibleWith(machine: MachineInfo): CompatibilityResult│
│ + getRequiredGames(): List<Game>                            │
│ + getRequiredDevices(): List<DeviceSpec>                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ TrackedConfiguration                                         │
├─────────────────────────────────────────────────────────────┤
│ - id: string                                                │
│ - name: string                                              │
│ - description: string                                       │
│ - game: Game | null                                         │
│ - paths: List<ConfigPath>                                   │
│ - includePatterns: List<string>                             │
│ - excludePatterns: List<string>                             │
├─────────────────────────────────────────────────────────────┤
│ + snapshot(): ConfigurationSnapshot                         │
│ + validate(): ValidationResult                              │
│ + getFiles(): List<TrackedFile>                             │
│ + hasChangedSince(snapshot): boolean                        │
│ + getSize(): number                                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ConfigurationSnapshot                                        │
├─────────────────────────────────────────────────────────────┤
│ - id: string                                                │
│ - configuration: TrackedConfiguration                       │
│ - createdAt: DateTime                                       │
│ - files: List<FileSnapshot>                                 │
│ - checksum: string                                          │
├─────────────────────────────────────────────────────────────┤
│ + restore(targetPath: string): RestoreResult                │
│ + getFile(relativePath: string): FileSnapshot               │
│ + getFileCount(): number                                    │
└─────────────────────────────────────────────────────────────┘
```

### Path Variable Resolution

```
┌─────────────────────────────────────────────────────────────┐
│ PathVariableResolver                                         │
├─────────────────────────────────────────────────────────────┤
│ - variables: Map<string, string>                            │
│ - gameVariables: Map<Game, Map<string, string>>             │
├─────────────────────────────────────────────────────────────┤
│ + resolve(path: string): string                             │
│ + resolveForGame(path: string, game: Game): string          │
│ + addVariable(name: string, value: string): void            │
│ + getStandardVariables(): Map<string, string>               │
│ + tokenize(path: string): string (convert to portable)      │
└─────────────────────────────────────────────────────────────┘

Standard Variables:
  {USER}           → C:\Users\<username>
  {APPDATA}        → C:\Users\<username>\AppData\Roaming
  {LOCALAPPDATA}   → C:\Users\<username>\AppData\Local
  {DOCUMENTS}      → C:\Users\<username>\Documents
  {STEAM}          → C:\Program Files (x86)\Steam
  {DCS_USER}       → C:\Users\<username>\Saved Games\DCS
  {IRACING}        → C:\Users\<username>\Documents\iRacing
  {RIGREADY_HOME}  → C:\Users\<username>\.rigready
  {RIGREADY_SCRIPTS} → C:\Users\<username>\.rigready\scripts
```

---

## 7. Display Management

### DisplayManager

```
┌─────────────────────────────────────────────────────────────┐
│ DisplayManager                                               │
├─────────────────────────────────────────────────────────────┤
│ - monitors: List<Monitor>                                   │
│ - savedLayouts: List<DisplayLayout>                         │
├─────────────────────────────────────────────────────────────┤
│ + getConnectedMonitors(): List<Monitor>                     │
│ + getDisplayLayout(): DisplayLayout                         │
│ + setDisplayLayout(layout: DisplayLayout): void             │
│ + matchesLayout(expected: DisplayLayout): LayoutMatchResult │
│ + setRotation(monitor: Monitor, rotation: Rotation): void   │
│ + setPosition(monitor: Monitor, x: int, y: int): void       │
│ + setResolution(monitor: Monitor, res: Resolution): void    │
│ + setPrimary(monitor: Monitor): void                        │
│ + saveCurrentLayout(name: string): DisplayLayout            │
│ + applyLayout(layout: DisplayLayout): ApplyResult           │
└─────────────────────────────────────────────────────────────┘
```

### Display Types

```
┌─────────────────────────────────────────────────────────────┐
│ Monitor                                                      │
├─────────────────────────────────────────────────────────────┤
│ - id: string                                                │
│ - deviceName: string (e.g., "\\.\DISPLAY1")                 │
│ - name: string (model name)                                 │
│ - friendlyName: string (user-assigned)                      │
│ - resolution: Resolution                                    │
│ - position: Point                                           │
│ - rotation: Rotation                                        │
│ - refreshRate: number                                       │
│ - isPrimary: boolean                                        │
│ - isConnected: boolean                                      │
├─────────────────────────────────────────────────────────────┤
│ + setRotation(rotation: Rotation): void                     │
│ + setPosition(x: int, y: int): void                         │
│ + setResolution(res: Resolution): void                      │
│ + getDisplayName(): string                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ DisplayLayout                                                │
├─────────────────────────────────────────────────────────────┤
│ - id: string                                                │
│ - name: string                                              │
│ - monitors: List<MonitorSpec>                               │
│ - createdAt: DateTime                                       │
├─────────────────────────────────────────────────────────────┤
│ + matches(current: List<Monitor>): LayoutMatchResult        │
│ + apply(): ApplyResult                                      │
│ + getDifferences(current: List<Monitor>): List<Difference>  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ MonitorSpec                                                  │
│ (What gets saved in profiles - portable)                     │
├─────────────────────────────────────────────────────────────┤
│ - name: string (for matching)                               │
│ - friendlyName: string                                      │
│ - expectedResolution: Resolution                            │
│ - expectedPosition: Point                                   │
│ - expectedRotation: Rotation                                │
│ - isRequired: boolean                                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Rotation (enum)                                              │
├─────────────────────────────────────────────────────────────┤
│ LANDSCAPE (0°)                                              │
│ PORTRAIT (90°)                                              │
│ LANDSCAPE_FLIPPED (180°)                                    │
│ PORTRAIT_FLIPPED (270°)                                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ LayoutMatchResult                                            │
├─────────────────────────────────────────────────────────────┤
│ - isMatch: boolean                                          │
│ - differences: List<LayoutDifference>                       │
│ - missingMonitors: List<MonitorSpec>                        │
│ - extraMonitors: List<Monitor>                              │
├─────────────────────────────────────────────────────────────┤
│ + canAutoFix(): boolean                                     │
│ + getFixableIssues(): List<LayoutDifference>                │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Script Integration

### Script Types

```
┌─────────────────────────────────────────────────────────────┐
│ ScriptCheck extends ChecklistItem                            │
├─────────────────────────────────────────────────────────────┤
│ - command: string                                           │
│ - arguments: string                                         │
│ - workingDirectory: string                                  │
│ - timeout: number (ms)                                      │
│ - successExitCodes: List<number>                            │
│ - captureOutput: boolean                                    │
│ - environmentVariables: Map<string, string>                 │
├─────────────────────────────────────────────────────────────┤
│ + check(): CheckResult                                      │
│ + getRemediation(): ScriptRemediation | null                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ScriptRemediation extends Remediation                        │
├─────────────────────────────────────────────────────────────┤
│ - command: string                                           │
│ - arguments: string                                         │
│ - workingDirectory: string                                  │
│ - timeout: number (ms)                                      │
│ - requiresConfirmation: boolean                             │
├─────────────────────────────────────────────────────────────┤
│ + execute(): RemediationResult                              │
│ + preview(): string                                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ScriptAction                                                 │
│ (For pre/post launch scripts)                                │
├─────────────────────────────────────────────────────────────┤
│ - name: string                                              │
│ - command: string                                           │
│ - arguments: string                                         │
│ - workingDirectory: string                                  │
│ - timeout: number (ms)                                      │
│ - continueOnError: boolean                                  │
│ - waitForCompletion: boolean                                │
│ - runHidden: boolean                                        │
├─────────────────────────────────────────────────────────────┤
│ + execute(): ActionResult                                   │
│ + getEnvironmentVariables(): Map<string, string>            │
└─────────────────────────────────────────────────────────────┘
```

### Script Environment

```
Environment Variables Injected:
┌──────────────────────────┬─────────────────────────────────┐
│ Variable                 │ Description                     │
├──────────────────────────┼─────────────────────────────────┤
│ RIGREADY_PROFILE_NAME    │ Current profile name            │
│ RIGREADY_PROFILE_ID      │ Profile unique ID               │
│ RIGREADY_GAME_NAME       │ Game name                       │
│ RIGREADY_GAME_PATH       │ Game install path               │
│ RIGREADY_USER_DATA       │ Game user data path             │
│ RIGREADY_SCRIPTS_DIR     │ Default scripts folder          │
│ RIGREADY_HOME            │ RigReady data directory         │
└──────────────────────────┴─────────────────────────────────┘
```

---

## 9. Event System

### EventBus

```
┌─────────────────────────────────────────────────────────────┐
│ EventBus                                                     │
├─────────────────────────────────────────────────────────────┤
│ - subscribers: Map<EventType, List<EventHandler>>           │
├─────────────────────────────────────────────────────────────┤
│ + subscribe<T>(eventType: Class<T>, handler: EventHandler<T>): Subscription│
│ + publish<T>(event: T): void                                │
│ + unsubscribe(subscription: Subscription): void             │
│ + clear(): void                                             │
└─────────────────────────────────────────────────────────────┘
```

### Event Types

```
┌─────────────────────────────────────────────────────────────┐
│ Events                                                       │
├─────────────────────────────────────────────────────────────┤
│ DeviceConnectedEvent                                        │
│   - device: Device                                          │
│                                                             │
│ DeviceDisconnectedEvent                                     │
│   - device: Device                                          │
│                                                             │
│ CheckCompletedEvent                                         │
│   - check: ChecklistItem                                    │
│   - result: CheckResult                                     │
│                                                             │
│ ProfileChangedEvent                                         │
│   - oldProfile: Profile                                     │
│   - newProfile: Profile                                     │
│                                                             │
│ ProfileSavedEvent                                           │
│   - profile: Profile                                        │
│                                                             │
│ BackupCreatedEvent                                          │
│   - backup: Backup                                          │
│                                                             │
│ ConfigurationChangedEvent                                   │
│   - configuration: TrackedConfiguration                     │
│   - changeType: ChangeType                                  │
│                                                             │
│ InputCapturedEvent                                          │
│   - device: Device                                          │
│   - input: Input                                            │
│   - value: number                                           │
│                                                             │
│ LaunchEvent                                                 │
│   - profile: Profile                                        │
│   - phase: LaunchPhase (PRE | LAUNCHING | POST)             │
└─────────────────────────────────────────────────────────────┘
```

---

## Design Patterns Used

| Pattern | Where Used | Purpose |
|---------|------------|---------|
| **Interface/Abstract** | ChecklistItem, Remediation, Game, BindingManager | Enable polymorphism and extensibility |
| **Strategy** | Different check types, remediation types | Interchangeable algorithms |
| **Factory** | Creating checks from YAML config | Decouple creation from usage |
| **Observer** | EventBus, InputCaptureSession | Loose coupling for events |
| **Composite** | Profile containing ChecklistItems | Tree structures |
| **Template Method** | Game implementations | Common algorithm with variations |
| **Singleton** | DeviceManager, DisplayManager, EventBus | Global access points |
| **Builder** | Profile, Backup creation | Complex object construction |

---

*Document Version: 1.0*
