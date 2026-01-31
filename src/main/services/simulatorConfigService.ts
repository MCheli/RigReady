/**
 * Simulator Config Service
 * Handles detection, parsing, and generation of simulator keybinding config files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  Simulator,
  SimulatorInstallation,
  SimulatorBinding,
  SimulatorVehicleConfig,
  SimulatorScanResult,
} from '../../shared/types';

// =============================================================================
// Simulator Paths and Detection
// =============================================================================

interface SimulatorPaths {
  possibleInstallPaths: string[];
  configPath: (installPath?: string) => string;
  vehicleConfigPath: (configPath: string) => string;
}

const SIMULATOR_PATHS: Record<Simulator, SimulatorPaths | null> = {
  dcs: {
    possibleInstallPaths: [
      'C:\\Program Files\\Eagle Dynamics\\DCS World',
      'C:\\Program Files\\Eagle Dynamics\\DCS World OpenBeta',
      'D:\\DCS World',
      'D:\\DCS World OpenBeta',
      'E:\\DCS World',
    ],
    configPath: () => path.join(os.homedir(), 'Saved Games', 'DCS', 'Config', 'Input'),
    vehicleConfigPath: (configPath: string) => configPath,
  },
  msfs: {
    possibleInstallPaths: [
      path.join(
        os.homedir(),
        'AppData',
        'Local',
        'Packages',
        'Microsoft.FlightSimulator_8wekyb3d8bbwe'
      ),
      path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft Flight Simulator'),
      'C:\\Program Files\\WindowsApps\\Microsoft.FlightSimulator_*',
    ],
    configPath: (installPath?: string) => {
      if (installPath?.includes('Packages')) {
        return path.join(installPath, 'LocalState', 'inputprofile');
      }
      return path.join(installPath || '', 'inputprofile');
    },
    vehicleConfigPath: (configPath: string) => configPath,
  },
  xplane: {
    possibleInstallPaths: [
      'C:\\X-Plane 12',
      'D:\\X-Plane 12',
      'C:\\X-Plane 11',
      'D:\\X-Plane 11',
      path.join(os.homedir(), 'Desktop', 'X-Plane 12'),
    ],
    configPath: (installPath?: string) =>
      path.join(installPath || '', 'Resources', 'joystick configs'),
    vehicleConfigPath: (configPath: string) => configPath,
  },
  il2: {
    possibleInstallPaths: [
      'C:\\Program Files\\1C Game Studios\\IL-2 Sturmovik Great Battles',
      'D:\\IL-2 Sturmovik Great Battles',
      'C:\\Games\\IL-2 Sturmovik Great Battles',
    ],
    configPath: (installPath?: string) => path.join(installPath || '', 'data', 'input'),
    vehicleConfigPath: (configPath: string) => configPath,
  },
  iracing: null,
  acc: null,
  other: null,
};

// =============================================================================
// Simulator Detection
// =============================================================================

function findInstallPath(paths: string[]): string | undefined {
  for (const p of paths) {
    // Handle wildcard paths
    if (p.includes('*')) {
      const dir = path.dirname(p);
      const pattern = path.basename(p).replace('*', '');
      if (fs.existsSync(dir)) {
        try {
          const entries = fs.readdirSync(dir);
          const match = entries.find((e) => e.startsWith(pattern));
          if (match) {
            return path.join(dir, match);
          }
        } catch {
          // Ignore permission errors
        }
      }
    } else if (fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

export function detectSimulatorInstallation(simulator: Simulator): SimulatorInstallation {
  const paths = SIMULATOR_PATHS[simulator];

  if (!paths) {
    return {
      simulator,
      name: getSimulatorName(simulator),
      installed: false,
    };
  }

  const installPath = findInstallPath(paths.possibleInstallPaths);
  const configPath = paths.configPath(installPath);
  const configExists = fs.existsSync(configPath);

  return {
    simulator,
    name: getSimulatorName(simulator),
    installed: installPath !== undefined || configExists,
    installPath,
    configPath: configExists ? configPath : undefined,
  };
}

export function detectAllSimulators(): SimulatorInstallation[] {
  const simulators: Simulator[] = ['dcs', 'msfs', 'xplane', 'il2'];
  return simulators.map(detectSimulatorInstallation);
}

function getSimulatorName(simulator: Simulator): string {
  const names: Record<Simulator, string> = {
    dcs: 'DCS World',
    msfs: 'Microsoft Flight Simulator',
    xplane: 'X-Plane',
    il2: 'IL-2 Sturmovik',
    iracing: 'iRacing',
    acc: 'Assetto Corsa Competizione',
    other: 'Other',
  };
  return names[simulator];
}

// =============================================================================
// DCS World Parser
// =============================================================================

function parseDCSConfig(configPath: string): SimulatorVehicleConfig[] {
  const vehicles: SimulatorVehicleConfig[] = [];

  if (!fs.existsSync(configPath)) {
    return vehicles;
  }

  try {
    // DCS structure: Config/Input/{aircraft}/joystick/{device-guid}.diff.lua
    const aircraftDirs = fs.readdirSync(configPath);

    for (const aircraft of aircraftDirs) {
      const aircraftPath = path.join(configPath, aircraft);
      if (!fs.statSync(aircraftPath).isDirectory()) continue;

      const joystickPath = path.join(aircraftPath, 'joystick');
      if (!fs.existsSync(joystickPath)) continue;

      const bindings: SimulatorBinding[] = [];
      const diffFiles = fs.readdirSync(joystickPath).filter((f) => f.endsWith('.diff.lua'));

      for (const diffFile of diffFiles) {
        const filePath = path.join(joystickPath, diffFile);
        const deviceGuid = diffFile.replace('.diff.lua', '');

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const parsed = parseDCSLuaBindings(content, deviceGuid);
          bindings.push(...parsed);
        } catch (err) {
          console.error(`Failed to parse DCS config ${filePath}:`, err);
        }
      }

      if (bindings.length > 0) {
        const stats = fs.statSync(joystickPath);
        vehicles.push({
          simulator: 'dcs',
          vehicleId: aircraft,
          vehicleName: formatDCSAircraftName(aircraft),
          configPath: joystickPath,
          bindings,
          lastModified: stats.mtimeMs,
        });
      }
    }
  } catch (err) {
    console.error('Failed to scan DCS configs:', err);
  }

  return vehicles;
}

function parseDCSLuaBindings(content: string, deviceGuid: string): SimulatorBinding[] {
  const bindings: SimulatorBinding[] = [];

  // DCS .diff.lua format:
  // local diff = {
  //   ["keyDiffs"] = {
  //     ["d3001pnilu3001cd8vd-1vpnilvu0"] = {
  //       ["added"] = {
  //         [1] = { ["key"] = "JOY_BTN5" },
  //       },
  //       ["name"] = "Weapon Release",
  //     },
  //   },
  //   ["axisDiffs"] = { ... },
  // }

  // Parse keyDiffs
  const keyDiffsMatch = content.match(/\["keyDiffs"\]\s*=\s*\{([\s\S]*?)\n\s*\}/);
  if (keyDiffsMatch) {
    const keyDiffs = keyDiffsMatch[1];
    const entryPattern =
      /\["([^"]+)"\]\s*=\s*\{[\s\S]*?\["name"\]\s*=\s*"([^"]+)"[\s\S]*?\["key"\]\s*=\s*"([^"]+)"/g;

    let match;
    while ((match = entryPattern.exec(keyDiffs)) !== null) {
      const [, controlId, name, key] = match;

      const binding: SimulatorBinding = {
        controlId,
        controlName: name,
        device: { name: deviceGuid, guid: deviceGuid },
        input: parseJoyInput(key),
      };
      bindings.push(binding);
    }
  }

  // Parse axisDiffs
  const axisDiffsMatch = content.match(/\["axisDiffs"\]\s*=\s*\{([\s\S]*?)\n\s*\}/);
  if (axisDiffsMatch) {
    const axisDiffs = axisDiffsMatch[1];
    const entryPattern =
      /\["([^"]+)"\]\s*=\s*\{[\s\S]*?\["name"\]\s*=\s*"([^"]+)"[\s\S]*?\["axis"\]\s*=\s*"([^"]+)"/g;

    let match;
    while ((match = entryPattern.exec(axisDiffs)) !== null) {
      const [, controlId, name, axis] = match;

      const binding: SimulatorBinding = {
        controlId,
        controlName: name,
        device: { name: deviceGuid, guid: deviceGuid },
        input: {
          type: 'axis',
          index: parseAxisIndex(axis),
        },
      };
      bindings.push(binding);
    }
  }

  return bindings;
}

function parseJoyInput(key: string): SimulatorBinding['input'] {
  // Parse JOY_BTN1, JOY_BTN_POV1_U, etc.
  if (key.startsWith('JOY_BTN_POV')) {
    const match = key.match(/JOY_BTN_POV(\d+)_([UDLR])/);
    if (match) {
      const hatIndex = parseInt(match[1], 10) - 1;
      const dirMap: Record<string, string> = {
        U: 'up',
        D: 'down',
        L: 'left',
        R: 'right',
      };
      return {
        type: 'hat',
        index: hatIndex,
        hatDirection: dirMap[match[2]],
      };
    }
  }

  if (key.startsWith('JOY_BTN')) {
    const num = parseInt(key.replace('JOY_BTN', ''), 10);
    return { type: 'button', index: num - 1 };
  }

  // Keyboard key
  return { type: 'key', key };
}

function parseAxisIndex(axis: string): number {
  // JOY_X, JOY_Y, JOY_Z, JOY_RX, JOY_RY, JOY_RZ, JOY_SLIDER1, JOY_SLIDER2
  const axisMap: Record<string, number> = {
    JOY_X: 0,
    JOY_Y: 1,
    JOY_Z: 2,
    JOY_RX: 3,
    JOY_RY: 4,
    JOY_RZ: 5,
    JOY_SLIDER1: 6,
    JOY_SLIDER2: 7,
  };
  return axisMap[axis] ?? 0;
}

function formatDCSAircraftName(id: string): string {
  // Convert IDs like "FA-18C_hornet" to "F/A-18C Hornet"
  return id
    .replace(/_/g, ' ')
    .replace(/FA-18C/g, 'F/A-18C')
    .replace(/A-10C 2/g, 'A-10C II')
    .replace(/hornet/gi, 'Hornet')
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

// =============================================================================
// MSFS Parser
// =============================================================================

function parseMSFSConfig(configPath: string): SimulatorVehicleConfig[] {
  const vehicles: SimulatorVehicleConfig[] = [];

  if (!fs.existsSync(configPath)) {
    return vehicles;
  }

  try {
    // MSFS stores input profiles as JSON files
    const files = fs.readdirSync(configPath).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(configPath, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const config = JSON.parse(content);
        const bindings = parseMSFSBindings(config);

        if (bindings.length > 0) {
          const stats = fs.statSync(filePath);
          vehicles.push({
            simulator: 'msfs',
            vehicleId: file.replace('.json', ''),
            vehicleName: config.FriendlyName || file.replace('.json', ''),
            configPath: filePath,
            bindings,
            lastModified: stats.mtimeMs,
          });
        }
      } catch (err) {
        console.error(`Failed to parse MSFS config ${filePath}:`, err);
      }
    }
  } catch (err) {
    console.error('Failed to scan MSFS configs:', err);
  }

  return vehicles;
}

function parseMSFSBindings(config: any): SimulatorBinding[] {
  const bindings: SimulatorBinding[] = [];

  if (!config.ControllerBinding) return bindings;

  const controllerBindings = config.ControllerBinding;

  for (const [controlId, binding] of Object.entries(controllerBindings)) {
    if (typeof binding !== 'object' || binding === null) continue;

    const b = binding as any;
    if (b.Primary) {
      const parsed = parseMSFSInput(b.Primary);
      if (parsed) {
        bindings.push({
          controlId,
          controlName: b.FriendlyName || controlId,
          category: b.Category,
          device: b.DeviceName ? { name: b.DeviceName } : undefined,
          input: parsed,
        });
      }
    }
  }

  return bindings;
}

function parseMSFSInput(input: any): SimulatorBinding['input'] | null {
  if (!input) return null;

  if (input.JoystickButton !== undefined) {
    return { type: 'button', index: input.JoystickButton };
  }

  if (input.JoystickAxis !== undefined) {
    return {
      type: 'axis',
      index: input.JoystickAxis,
      axisDirection: input.JoystickAxisDir === 1 ? 'negative' : 'positive',
    };
  }

  if (input.Key !== undefined) {
    return { type: 'key', key: input.Key };
  }

  return null;
}

// =============================================================================
// X-Plane Parser
// =============================================================================

function parseXPlaneConfig(configPath: string): SimulatorVehicleConfig[] {
  const vehicles: SimulatorVehicleConfig[] = [];

  if (!fs.existsSync(configPath)) {
    return vehicles;
  }

  try {
    // X-Plane uses .joy files (plain text format)
    const files = fs.readdirSync(configPath).filter((f) => f.endsWith('.joy'));

    for (const file of files) {
      const filePath = path.join(configPath, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const bindings = parseXPlaneBindings(content);

        if (bindings.length > 0) {
          const stats = fs.statSync(filePath);
          vehicles.push({
            simulator: 'xplane',
            vehicleId: file.replace('.joy', ''),
            vehicleName: file.replace('.joy', ''),
            configPath: filePath,
            bindings,
            lastModified: stats.mtimeMs,
          });
        }
      } catch (err) {
        console.error(`Failed to parse X-Plane config ${filePath}:`, err);
      }
    }
  } catch (err) {
    console.error('Failed to scan X-Plane configs:', err);
  }

  return vehicles;
}

function parseXPlaneBindings(content: string): SimulatorBinding[] {
  const bindings: SimulatorBinding[] = [];

  // X-Plane .joy format:
  // I
  // 1100 version
  // JOY
  // ... device info ...
  // _btn_X sim/command/name
  // _axis_X sim/command/name

  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Button binding: _btn_0 sim/flight_controls/flaps_down
    const btnMatch = trimmed.match(/^_btn_(\d+)\s+(.+)$/);
    if (btnMatch) {
      bindings.push({
        controlId: btnMatch[2],
        controlName: btnMatch[2].split('/').pop() || btnMatch[2],
        input: { type: 'button', index: parseInt(btnMatch[1], 10) },
      });
      continue;
    }

    // Axis binding: _axis_0 sim/joystick/axis_values[0]
    const axisMatch = trimmed.match(/^_axis_(\d+)\s+(.+)$/);
    if (axisMatch) {
      bindings.push({
        controlId: axisMatch[2],
        controlName: axisMatch[2].split('/').pop() || axisMatch[2],
        input: { type: 'axis', index: parseInt(axisMatch[1], 10) },
      });
    }
  }

  return bindings;
}

// =============================================================================
// IL-2 Parser
// =============================================================================

function parseIL2Config(configPath: string): SimulatorVehicleConfig[] {
  const vehicles: SimulatorVehicleConfig[] = [];

  if (!fs.existsSync(configPath)) {
    return vehicles;
  }

  try {
    // IL-2 uses .actions files
    const files = fs.readdirSync(configPath).filter((f) => f.endsWith('.actions'));

    for (const file of files) {
      const filePath = path.join(configPath, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const bindings = parseIL2Bindings(content);

        if (bindings.length > 0) {
          const stats = fs.statSync(filePath);
          vehicles.push({
            simulator: 'il2',
            vehicleId: file.replace('.actions', ''),
            vehicleName: file.replace('.actions', ''),
            configPath: filePath,
            bindings,
            lastModified: stats.mtimeMs,
          });
        }
      } catch (err) {
        console.error(`Failed to parse IL-2 config ${filePath}:`, err);
      }
    }
  } catch (err) {
    console.error('Failed to scan IL-2 configs:', err);
  }

  return vehicles;
}

function parseIL2Bindings(content: string): SimulatorBinding[] {
  const bindings: SimulatorBinding[] = [];

  // IL-2 .actions format (simplified):
  // [key_name]
  // joy_name = "Device Name"
  // joy_btn = 5
  // or
  // joy_axis = 2

  const sections = content.split(/\n\s*\[/);

  for (const section of sections) {
    const lines = section.split('\n');
    const controlId = lines[0]?.replace(/\].*/, '').trim();
    if (!controlId) continue;

    let deviceName: string | undefined;
    let buttonIndex: number | undefined;
    let axisIndex: number | undefined;

    for (const line of lines) {
      const joyNameMatch = line.match(/joy_name\s*=\s*"([^"]+)"/);
      if (joyNameMatch) deviceName = joyNameMatch[1];

      const joyBtnMatch = line.match(/joy_btn\s*=\s*(\d+)/);
      if (joyBtnMatch) buttonIndex = parseInt(joyBtnMatch[1], 10);

      const joyAxisMatch = line.match(/joy_axis\s*=\s*(\d+)/);
      if (joyAxisMatch) axisIndex = parseInt(joyAxisMatch[1], 10);
    }

    if (buttonIndex !== undefined) {
      bindings.push({
        controlId,
        controlName: controlId,
        device: deviceName ? { name: deviceName } : undefined,
        input: { type: 'button', index: buttonIndex },
      });
    } else if (axisIndex !== undefined) {
      bindings.push({
        controlId,
        controlName: controlId,
        device: deviceName ? { name: deviceName } : undefined,
        input: { type: 'axis', index: axisIndex },
      });
    }
  }

  return bindings;
}

// =============================================================================
// Main Service Functions
// =============================================================================

export function scanSimulator(simulator: Simulator): SimulatorScanResult {
  const installation = detectSimulatorInstallation(simulator);
  const errors: string[] = [];
  let vehicles: SimulatorVehicleConfig[] = [];

  if (!installation.installed || !installation.configPath) {
    return { simulator, installation, vehicles: [], errors };
  }

  try {
    switch (simulator) {
      case 'dcs':
        vehicles = parseDCSConfig(installation.configPath);
        break;
      case 'msfs':
        vehicles = parseMSFSConfig(installation.configPath);
        break;
      case 'xplane':
        vehicles = parseXPlaneConfig(installation.configPath);
        break;
      case 'il2':
        vehicles = parseIL2Config(installation.configPath);
        break;
      default:
        errors.push(`Parser not implemented for ${simulator}`);
    }
  } catch (err) {
    errors.push(`Failed to scan ${simulator}: ${err}`);
  }

  return { simulator, installation, vehicles, errors };
}

export function scanAllSimulators(): SimulatorScanResult[] {
  const simulators: Simulator[] = ['dcs', 'msfs', 'xplane', 'il2'];
  return simulators.map(scanSimulator);
}

// =============================================================================
// Singleton Instance
// =============================================================================

class SimulatorConfigService {
  private cachedInstallations: Map<Simulator, SimulatorInstallation> = new Map();
  private cachedScans: Map<Simulator, SimulatorScanResult> = new Map();

  detectSimulators(): SimulatorInstallation[] {
    const installations = detectAllSimulators();
    for (const inst of installations) {
      this.cachedInstallations.set(inst.simulator, inst);
    }
    return installations;
  }

  getInstallation(simulator: Simulator): SimulatorInstallation {
    if (!this.cachedInstallations.has(simulator)) {
      const inst = detectSimulatorInstallation(simulator);
      this.cachedInstallations.set(simulator, inst);
    }
    return this.cachedInstallations.get(simulator)!;
  }

  scanSimulator(simulator: Simulator, forceRefresh = false): SimulatorScanResult {
    if (!forceRefresh && this.cachedScans.has(simulator)) {
      return this.cachedScans.get(simulator)!;
    }

    const result = scanSimulator(simulator);
    this.cachedScans.set(simulator, result);
    return result;
  }

  scanAllSimulators(forceRefresh = false): SimulatorScanResult[] {
    const simulators: Simulator[] = ['dcs', 'msfs', 'xplane', 'il2'];
    return simulators.map((s) => this.scanSimulator(s, forceRefresh));
  }

  clearCache(): void {
    this.cachedInstallations.clear();
    this.cachedScans.clear();
  }
}

export const simulatorConfigService = new SimulatorConfigService();
