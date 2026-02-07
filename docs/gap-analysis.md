# RigReady - Gap Analysis

## Overview

This document compares the existing RigReady implementation against the new requirements defined in our brainstorming sessions. It identifies what's already implemented, what needs to be added, and what architectural changes may be required.

---

## Current Implementation Summary

**Technology Stack:**
- Electron 40.1.0 + Vue 3 + Vuetify 3 + TypeScript
- Node.js backend with service-oriented architecture
- Dual input handling: HID (node-hid) + DirectInput (Python/pygame)
- Data stored as JSON in `~/.rigready/`

**Current Features:**
- Device detection and management (USB, HID, DirectInput)
- Input tester with real-time visualization
- Display configuration save/restore
- Keybinding profiles (two systems: legacy backup + new unified)
- Game launch with pre-flight checks
- Stream Deck integration
- Simulator detection (DCS, MSFS, X-Plane, IL-2, iRacing, ACC)
- Settings and auto-update

---

## Gap Analysis by Requirement Area

### FR1: Profile Management

| Requirement | Status | Notes |
|-------------|--------|-------|
| FR1.1.1 Create profile | ⚠️ Partial | "Game profiles" exist but aren't the unified "RigReady Profile" concept |
| FR1.1.2 Edit profile | ⚠️ Partial | Can edit game launch profiles, not unified profiles |
| FR1.1.3 Delete profile | ⚠️ Partial | Game profiles only |
| FR1.1.4 Clone profile | ❌ Missing | Not implemented |
| FR1.1.5 Copy items between profiles | ❌ Missing | Not implemented |
| FR1.2.1 Remember last used profile | ❌ Missing | No unified profile selection |
| FR1.2.2 Quick profile switching | ❌ Missing | No unified profile concept |
| FR1.2.3 Last used timestamp | ❌ Missing | Not tracked |
| FR1.3.1 YAML/JSON storage | ✅ Exists | Uses JSON files |
| FR1.3.2 User-accessible location | ✅ Exists | `~/.rigready/` |
| FR1.3.3 Direct file editing | ✅ Exists | JSON is editable |

**Gap Summary**: The biggest gap is the **unified Profile concept**. Current implementation has separate game profiles, keybinding profiles, device configs, and display configs - but no single "Profile" that ties them all together as designed in our brainstorming.

**Architecture Change Required**:
- Introduce `Profile` as a first-class entity that contains references to checklist items, configurations, and launch target
- Create `ProfileManager` service

---

### FR2: Pre-flight Check System

| Requirement | Status | Notes |
|-------------|--------|-------|
| FR2.1.1 Run all checks | ✅ Exists | `preflightService` runs checks |
| FR2.1.2 Status display | ✅ Exists | Shows pass/fail |
| FR2.1.3 Check categories | ⚠️ Partial | Has device/display/process, not full set |
| FR2.1.4 Failed required = red | ⚠️ Partial | Basic styling exists |
| FR2.1.5 Failed optional = yellow | ❌ Missing | No required vs optional distinction |
| FR2.1.6 Run checks individually | ❌ Missing | All-or-nothing currently |
| FR2.1.7 Overall readiness status | ✅ Exists | Shows ready/not ready |
| FR2.2.1 Process Check | ✅ Exists | `processService` |
| FR2.2.2 Device Check | ✅ Exists | `deviceManager` |
| FR2.2.3 Display Check | ✅ Exists | `displayManager` |
| FR2.2.4 Config Check | ❌ Missing | No config file validation |
| FR2.2.5 Script Check | ❌ Missing | Not implemented |
| FR2.3.1 Remediation actions | ⚠️ Partial | Can launch processes |
| FR2.3.2 Launch Process | ✅ Exists | Can start processes |
| FR2.3.3 Auto-fix Display | ❌ Missing | Only checks, doesn't fix |
| FR2.3.4 Restore Config | ❌ Missing | Not implemented |
| FR2.3.5 Notify User | ⚠️ Partial | Toast notifications exist |
| FR2.3.6 Run Script | ❌ Missing | Script support not implemented |
| FR2.4.1 Launch target | ✅ Exists | Game profiles have exe/args |
| FR2.4.4 Pre-launch scripts | ❌ Missing | Has pre-launch process checks, not scripts |
| FR2.4.5 Post-launch scripts | ❌ Missing | Not implemented |

**Gap Summary**: Pre-flight exists but needs:
- Required vs optional distinction
- Config file validation check type
- Script check type
- Auto-fix remediation for displays
- Script-based remediation
- Pre/post launch scripts (not just process checks)

**Architecture Change Required**:
- Refactor `PreflightCheck` to match our `ChecklistItem` interface
- Add `Remediation` abstraction with multiple implementations
- Add `ScriptCheck` and `ConfigCheck` types
- Implement display auto-fix using Windows APIs

---

### FR3: Device Management

| Requirement | Status | Notes |
|-------------|--------|-------|
| FR3.1.1 Enumerate USB HID | ✅ Exists | node-hid + PowerShell |
| FR3.1.2 VID/PID identification | ✅ Exists | Used for matching |
| FR3.1.3 Display friendly name | ✅ Exists | Device database exists |
| FR3.1.4 User-assigned names | ❌ Missing | Not implemented |
| FR3.1.5 Connect/disconnect events | ✅ Exists | pygame:devicesChanged |
| FR3.2.1 VID/PID in profiles | ✅ Exists | `expectedDeviceConfig` uses VID/PID |
| FR3.3.1 Input tester | ✅ Exists | `InputTesterView` |
| FR3.3.2 Show all inputs | ✅ Exists | Buttons and axes |
| FR3.3.3 Real-time feedback | ✅ Exists | 50ms polling |
| FR3.3.4 Raw input values | ✅ Exists | Displayed |
| FR3.3.5 "Press any button" mode | ❌ Missing | Not implemented |
| FR3.4.1 Binding inspector | ❌ Missing | Not implemented |

**Gap Summary**: Device management is well-implemented. Missing:
- User-assigned friendly names
- "Press any button to identify" mode
- Binding inspector (show what button is bound to in game)

**Architecture Change**: Minor - add friendly name storage and identify mode

---

### FR4: Configuration Backup & Restore

| Requirement | Status | Notes |
|-------------|--------|-------|
| FR4.1.1 Define tracked configs | ❌ Missing | Not user-configurable |
| FR4.2.1 Backup all | ⚠️ Partial | Keybinding backups exist |
| FR4.2.2 Backup single profile | ⚠️ Partial | Not unified profile concept |
| FR4.2.5 Portable bundle format | ❌ Missing | Uses timestamped folders |
| FR4.3.1 Restore from backup | ✅ Exists | For keybindings |
| FR4.3.3 Conflict detection | ❌ Missing | Not implemented |
| FR4.4.1 Quick snapshots | ⚠️ Partial | Timestamped backups |
| FR4.4.2 Named snapshots | ❌ Missing | Only timestamped |

**Gap Summary**: Backup system exists for keybindings but needs:
- Unified backup that includes all profile data
- `.rigready` portable bundle format
- Conflict detection and resolution
- Named snapshots
- User-defined tracked configurations

**Architecture Change Required**:
- Introduce `BackupManager` with `Backup`, `TrackedConfiguration`, `ConfigurationSnapshot` entities
- Define portable bundle format
- Add path variable resolution for portability

---

### FR5: Keybinding Management

| Requirement | Status | Notes |
|-------------|--------|-------|
| FR5.1.1 Backup keybinding files | ✅ Exists | Legacy system |
| FR5.1.2 Restore keybindings | ✅ Exists | Legacy system |
| FR5.2.1 Parse DCS .diff.lua | ⚠️ Partial | `dcsKeybindingService` referenced but unclear |
| FR5.2.2 Display bindings for device | ❌ Missing | Not implemented |
| FR5.2.3 Detect duplicates | ❌ Missing | Not implemented |
| FR5.2.4 Clear device bindings | ❌ Missing | Not implemented |
| FR5.2.5 Migrate UUID | ❌ Missing | Not implemented |
| FR5.3.1 Named snapshots | ❌ Missing | Only timestamped |

**Gap Summary**: Keybinding has two systems:
1. Legacy: backup/restore entire folders (exists)
2. Unified: abstract common actions → vehicle bindings (exists, sophisticated)

Missing DCS-specific features:
- Duplicate detection
- Device binding clear
- UUID migration (critical pain point)
- Per-device binding view

**Architecture Change Required**:
- Implement `DCSBindingManager` with full Lua parsing
- Add duplicate detection algorithm
- Add UUID migration tool

---

### FR6: Display Management

| Requirement | Status | Notes |
|-------------|--------|-------|
| FR6.1.1 Enumerate monitors | ✅ Exists | PowerShell `get-displays.ps1` |
| FR6.1.2 Read layout | ✅ Exists | Position, resolution |
| FR6.2.1 Save layout | ✅ Exists | `display-configurations/` |
| FR6.2.2 Define expected layout | ✅ Exists | Saved configs |
| FR6.2.3 Compare layouts | ✅ Exists | Pre-flight check |
| FR6.3.1 Programmatic rotation | ❌ Missing | Only reads, doesn't write |
| FR6.3.2 Programmatic position | ❌ Missing | Only reads, doesn't write |
| FR6.3.5 Apply layout one-click | ❌ Missing | Can compare but not apply |
| FR6.4.1 Read MonitorSetup.lua | ❌ Missing | Not implemented |
| FR6.4.2 Edit MonitorSetup.lua | ❌ Missing | Not implemented |

**Gap Summary**: Display management reads well but **cannot write**. Critical missing:
- Programmatic display modification (rotation, position)
- DCS MonitorSetup.lua integration

**Architecture Change Required**:
- Add Windows display API calls (ChangeDisplaySettingsEx)
- Implement DCS MonitorSetup.lua parser/writer

---

### FR7: Game Integration

| Requirement | Status | Notes |
|-------------|--------|-------|
| FR7.1.1 Auto-detect installation | ✅ Exists | `simulatorConfigService` |
| FR7.1.2 Steam/Standalone support | ✅ Exists | Scans Steam library |
| FR7.3.1 DCS detection | ✅ Exists | |
| FR7.3.3 Parse DCS keybindings | ⚠️ Partial | Basic parsing exists |
| FR7.3.5 MonitorSetup.lua | ❌ Missing | Not implemented |
| FR7.4.1 iRacing detection | ✅ Exists | |
| FR7.5.1 MSFS detection | ✅ Exists | |
| FR7.6.1 BeamNG detection | ❌ Missing | Not in current simulators |
| FR7.7.1 LMU detection | ❌ Missing | Not in current simulators |

**Gap Summary**: Good simulator support but missing:
- BeamNG integration
- Le Mans Ultimate integration
- Deep DCS MonitorSetup integration
- Deep keybinding parsing for all games

**Architecture Change**:
- Add BeamNG and LMU to `Simulator` enum and detection
- Implement game-specific `BindingManager` implementations

---

### FR8: Script Integration

| Requirement | Status | Notes |
|-------------|--------|-------|
| FR8.1.1 Execute commands | ❌ Missing | Not implemented |
| FR8.1.2 Scripts anywhere | ❌ Missing | Not implemented |
| FR8.1.3 Timeout | ❌ Missing | Not implemented |
| FR8.2.1 Script as check | ❌ Missing | Not implemented |
| FR8.2.2 Script remediation | ❌ Missing | Not implemented |
| FR8.3.1 Pre-launch scripts | ❌ Missing | Only process checks |
| FR8.3.2 Post-launch scripts | ❌ Missing | Not implemented |
| FR8.4.1 Scripts excluded from share | N/A | Sharing not implemented |

**Gap Summary**: **Script integration is entirely missing**. This is a new feature area.

**Architecture Change Required**:
- Add `ScriptCheck` checklist item type
- Add `ScriptRemediation` remediation type
- Add `ScriptAction` for pre/post launch
- Implement Node.js child_process execution with timeout

---

### FR9: Sharing & Portability

| Requirement | Status | Notes |
|-------------|--------|-------|
| FR9.1.1 Export profile | ❌ Missing | Keybinding export exists, not profiles |
| FR9.1.3 Path normalization | ❌ Missing | Not implemented |
| FR9.2.1 Import profile | ❌ Missing | Not implemented |
| FR9.3.1 Path variables | ❌ Missing | Hardcoded paths |

**Gap Summary**: **Sharing/portability is largely missing**. Keybinding profiles can be exported as JSON but:
- No unified profile export
- No path variable system
- No import with compatibility analysis

**Architecture Change Required**:
- Implement `PathVariableResolver`
- Add export/import workflow with compatibility checking
- Define `.rigready` bundle format

---

## Summary: What's Well-Implemented

| Feature Area | Status |
|--------------|--------|
| Device Detection (HID + DirectInput) | ✅ Strong |
| Input Testing | ✅ Strong |
| Display Detection | ✅ Strong (read-only) |
| Process Detection | ✅ Strong |
| Simulator Detection | ✅ Good |
| Game Launch Profiles | ✅ Good |
| Keybinding Profiles (unified system) | ✅ Good |
| Stream Deck Integration | ✅ Good |
| UI Framework | ✅ Strong |
| IPC Architecture | ✅ Strong |
| Testing Infrastructure | ✅ Good |

## Summary: What's Missing or Needs Work

| Feature Area | Gap Level | Key Missing Items |
|--------------|-----------|-------------------|
| Unified Profile Concept | 🔴 Major | Single profile containing checks, configs, launch |
| Script Integration | 🔴 Major | Entirely new feature |
| Display Write Operations | 🔴 Major | Can read but not modify displays |
| DCS MonitorSetup | 🔴 Major | Not implemented |
| UUID Migration | 🔴 Major | Critical pain point not addressed |
| Sharing/Export/Import | 🔴 Major | Mostly missing |
| Config Check Type | 🟡 Medium | New check type needed |
| Remediation System | 🟡 Medium | Needs abstraction and more types |
| Path Variables | 🟡 Medium | For portability |
| Backup Bundle Format | 🟡 Medium | For sharing |
| BeamNG/LMU Support | 🟡 Medium | New games |
| Duplicate Binding Detection | 🟡 Medium | DCS-specific |
| Required vs Optional Checks | 🟢 Minor | Simple addition |
| Named Snapshots | 🟢 Minor | Simple addition |
| User-Assigned Device Names | 🟢 Minor | Simple addition |

---

## Recommended Architecture Changes

### 1. Introduce Unified Profile Entity

**Current State**: Separate concepts (game profiles, keybinding profiles, device configs, display configs)

**Required Change**: Create `Profile` as the central entity

```typescript
interface Profile {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  lastUsed: number;
  game: SimulatorType | null;
  launchTarget: LaunchTarget;
  checklistItems: ChecklistItem[];
  trackedConfigurations: TrackedConfiguration[];
}
```

**Files to Create/Modify**:
- `src/shared/profileTypes.ts` - Profile type definitions
- `src/main/services/profileService.ts` - Profile CRUD operations
- `src/main/services/profileManager.ts` - Active profile management
- `src/renderer/views/ProfilesView.vue` - Profile management UI
- Update `LaunchView.vue` to work with unified profiles

### 2. Refactor Checklist System

**Current State**: `PreflightCheck` with limited types

**Required Change**: Abstract `ChecklistItem` interface with multiple implementations

```typescript
interface ChecklistItem {
  id: string;
  name: string;
  description: string;
  isRequired: boolean;
  category: CheckCategory;
  check(): Promise<CheckResult>;
  getRemediation(): Remediation | null;
}

// Implementations
class ProcessCheck implements ChecklistItem { ... }
class DeviceCheck implements ChecklistItem { ... }
class DisplayCheck implements ChecklistItem { ... }
class ConfigCheck implements ChecklistItem { ... }  // NEW
class ScriptCheck implements ChecklistItem { ... }  // NEW
```

**Files to Create/Modify**:
- `src/shared/checklistTypes.ts` - Checklist interfaces
- `src/main/checks/` - Check implementations
- `src/main/remediations/` - Remediation implementations
- Update `preflightService.ts` to use new system

### 3. Add Display Write Capability

**Current State**: PowerShell reads display info

**Required Change**: Add Windows API calls for display modification

```typescript
// displayManager.ts additions
async setRotation(deviceName: string, rotation: number): Promise<void>;
async setPosition(deviceName: string, x: number, y: number): Promise<void>;
async applyLayout(layout: DisplayLayout): Promise<void>;
```

**Implementation Options**:
1. PowerShell with .NET System.Windows.Forms
2. Native Node addon with Win32 API
3. FFI library (ffi-napi) calling user32.dll

### 4. Add Script Execution Service

**Current State**: None

**Required Change**: New service for script execution

```typescript
// src/main/services/scriptService.ts
interface ScriptService {
  execute(command: string, options: ScriptOptions): Promise<ScriptResult>;
  executeWithTimeout(command: string, timeout: number): Promise<ScriptResult>;
}
```

### 5. Add DCS MonitorSetup Integration

**Current State**: None

**Required Change**: Lua file parser/writer

```typescript
// src/main/games/dcs/monitorSetupService.ts
interface MonitorSetupService {
  parse(luaPath: string): MonitorSetup;
  generate(config: MonitorSetupConfig): string;
  apply(config: MonitorSetupConfig, path: string): Promise<void>;
}
```

### 6. Add Path Variable System

**Current State**: Hardcoded paths

**Required Change**: Variable substitution system

```typescript
// src/main/services/pathVariableService.ts
interface PathVariableService {
  resolve(path: string): string;
  tokenize(absolutePath: string): string;
  getVariables(): Map<string, string>;
}
```

### 7. Add Backup Bundle Format

**Current State**: Timestamped folders

**Required Change**: Portable `.rigready` format

```typescript
// .rigready bundle structure (ZIP with manifest)
manifest.json        // Bundle metadata
profiles/            // Profile definitions
configurations/      // Config file snapshots
keybindings/         // Keybinding snapshots
```

---

## Migration Strategy

### Phase 1: Foundation (Non-Breaking)
1. Add `Profile` entity alongside existing game profiles
2. Add new check types (ConfigCheck, ScriptCheck)
3. Add remediation abstraction
4. Add path variable service

### Phase 2: Display Enhancement
1. Add display write capability
2. Add auto-fix remediation
3. Add DCS MonitorSetup integration

### Phase 3: Keybinding Enhancement
1. Add DCS UUID migration tool
2. Add duplicate binding detection
3. Add per-device binding view

### Phase 4: Script Integration
1. Add ScriptCheck type
2. Add ScriptRemediation
3. Add pre/post launch scripts

### Phase 5: Sharing & Export
1. Define bundle format
2. Add export workflow
3. Add import with compatibility
4. Add privacy review

### Phase 6: New Games
1. Add BeamNG integration
2. Add Le Mans Ultimate integration

---

## Conclusion

The existing RigReady implementation provides a **strong foundation**:
- Solid Electron architecture with type-safe IPC
- Good device detection (dual HID + DirectInput approach)
- Reasonable simulator detection
- Working pre-flight check system
- Modern Vue 3 + Vuetify UI

**Key gaps to address**:
1. **Unified Profile concept** - The central organizing entity is missing
2. **Display write capability** - Can detect but not fix display issues
3. **Script integration** - Entirely new feature
4. **DCS-specific features** - MonitorSetup, UUID migration, duplicate detection
5. **Sharing/portability** - Path variables, bundle format, export/import

The architecture is sound and can be extended without major rewrites. The recommended approach is incremental enhancement in phases.

---

*Document Version: 1.0*
