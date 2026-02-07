/**
 * Shared types used by both main and renderer processes
 */

// =============================================================================
// Device Types
// =============================================================================

export interface HIDDeviceInfo {
  vendorId: number;
  productId: number;
  path: string;
  serialNumber: string;
  manufacturer: string;
  product: string;
  release: number;
  interface: number;
  usagePage: number | undefined;
  usage: number | undefined;
}

export interface HIDInputState {
  vendorId: number;
  productId: number;
  path: string;
  productName: string;
  data: number[];
  buttons: boolean[];
  timestamp: number;
}

export interface PygameDevice {
  index: number;
  name: string;
  numAxes: number;
  numButtons: number;
  numHats: number;
}

export interface PygameInputState {
  index: number;
  name: string;
  axes: number[];
  buttons: boolean[];
  hats: [number, number][];
  timestamp: number;
}

export interface UnifiedDevice {
  type: 'pygame' | 'hid';
  id: string; // 'pygame:N' or 'hid:<path>'
  displayName: string;
  // Pygame-specific
  pygameIndex?: number;
  numAxes?: number;
  numButtons?: number;
  numHats?: number;
  // HID-specific
  hidPath?: string;
  vendorId?: number;
  productId?: number;
}

export interface USBDevice {
  vendorId: string;
  productId: string;
  vendorName: string;
  productName: string;
  type: string;
  status: 'connected' | 'disconnected';
}

// =============================================================================
// Display Types
// =============================================================================

export interface DisplayInfo {
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  isPrimary: boolean;
}

export interface DisplayConfiguration {
  name: string;
  displays: DisplayInfo[];
  timestamp: number;
}

// =============================================================================
// Keybinding Types
// =============================================================================

export interface SimulatorInfo {
  name: string;
  installed: boolean;
  keybindingsPath: string;
  profiles: string[];
}

export interface KeybindingBackup {
  name: string;
  simulator: string;
  timestamp: number;
  path: string;
}

// =============================================================================
// Common Actions / Unified Keybinding Types
// =============================================================================

/**
 * Physical input on a hardware device
 */
export interface PhysicalInput {
  deviceId: string; // VID:PID format (e.g., "4098:bead") or device name
  deviceName?: string; // Human-readable device name
  inputType: 'button' | 'axis' | 'hat';
  inputIndex: number; // Button number, axis number, or hat number
  hatDirection?:
    | 'up'
    | 'down'
    | 'left'
    | 'right'
    | 'up-left'
    | 'up-right'
    | 'down-left'
    | 'down-right';
  axisDirection?: 'positive' | 'negative' | 'full';
  modifiers?: string[]; // e.g., ['shift', 'ctrl']
}

/**
 * Action categories for organization
 */
export type ActionCategory =
  | 'flight-controls'
  | 'weapons'
  | 'systems'
  | 'views'
  | 'communications'
  | 'autopilot'
  | 'countermeasures'
  | 'lights'
  | 'engine'
  | 'navigation'
  | 'custom';

/**
 * Abstract action that can be reused across aircraft/vehicles
 * Represents what you want to do, independent of specific sim bindings
 */
export interface CommonAction {
  id: string;
  name: string; // e.g., "Weapon Release", "Flaps Up", "Gear Toggle"
  category: ActionCategory;
  description?: string;
  physicalInput: PhysicalInput;
  isAxisAction?: boolean; // True if this action uses an axis
}

/**
 * Supported simulators
 */
export type Simulator =
  | 'dcs'
  | 'msfs'
  | 'xplane'
  | 'il2'
  | 'iracing'
  | 'acc'
  | 'beamng'
  | 'lmu'
  | 'other';

export const SIMULATORS: Simulator[] = [
  'dcs',
  'msfs',
  'xplane',
  'il2',
  'iracing',
  'acc',
  'beamng',
  'lmu',
];

export const SIMULATOR_DISPLAY_NAMES: Record<Simulator, string> = {
  dcs: 'DCS World',
  msfs: 'Microsoft Flight Simulator',
  xplane: 'X-Plane',
  il2: 'IL-2 Sturmovik',
  iracing: 'iRacing',
  acc: 'Assetto Corsa Competizione',
  beamng: 'BeamNG.drive',
  lmu: 'Le Mans Ultimate',
  other: 'Other',
};

/**
 * Mapping from a common action to a specific aircraft/vehicle's control in a simulator
 */
export interface VehicleBinding {
  vehicleId: string; // e.g., "FA-18C", "A-10C_2", "F1 2024 Generic"
  vehicleName: string; // Human-readable name
  simulator: Simulator;
  commonActionId: string; // References CommonAction.id
  gameControlName: string; // The actual control name in the sim's config
  gameControlId?: string; // Internal ID if available (for DCS, etc.)
}

/**
 * Complete keybinding profile
 */
export interface KeybindingProfile {
  id: string;
  name: string; // e.g., "My Flight Setup", "VR Profile"
  description?: string;
  commonActions: CommonAction[];
  vehicleBindings: VehicleBinding[];
  created: number;
  modified: number;
}

/**
 * Default common actions that come pre-configured
 */
export const DEFAULT_ACTION_CATEGORIES: Record<ActionCategory, string> = {
  'flight-controls': 'Flight Controls',
  weapons: 'Weapons',
  systems: 'Systems',
  views: 'Views',
  communications: 'Communications',
  autopilot: 'Autopilot',
  countermeasures: 'Countermeasures',
  lights: 'Lights',
  engine: 'Engine',
  navigation: 'Navigation',
  custom: 'Custom',
};

// =============================================================================
// Simulator Config Types
// =============================================================================

/**
 * Simulator installation info
 */
export interface SimulatorInstallation {
  simulator: Simulator;
  name: string;
  installed: boolean;
  installPath?: string;
  configPath?: string;
  version?: string;
}

/**
 * Parsed keybinding from a simulator config file
 */
export interface SimulatorBinding {
  controlId: string; // Internal control ID in the simulator
  controlName: string; // Human-readable name
  category?: string; // Category within the sim
  device?: {
    name: string;
    guid?: string;
    vendorId?: number;
    productId?: number;
  };
  input: {
    type: 'button' | 'axis' | 'key' | 'hat';
    index?: number;
    key?: string;
    modifiers?: string[];
    axisDirection?: 'positive' | 'negative' | 'full';
    hatDirection?: string;
  };
}

/**
 * Parsed aircraft/vehicle config from a simulator
 */
export interface SimulatorVehicleConfig {
  simulator: Simulator;
  vehicleId: string; // e.g., "FA-18C_hornet", "Airbus_A320_Neo"
  vehicleName: string;
  configPath: string;
  bindings: SimulatorBinding[];
  lastModified: number;
}

/**
 * Result of scanning a simulator for configs
 */
export interface SimulatorScanResult {
  simulator: Simulator;
  installation: SimulatorInstallation;
  vehicles: SimulatorVehicleConfig[];
  errors: string[];
}

/**
 * User-configured simulator path settings
 */
export interface SimulatorPath {
  simulator: Simulator;
  installPath?: string;
  configPath?: string;
  isAutoDetected: boolean;
  lastVerified?: number;
}

/**
 * Application settings
 */
export interface AppSettings {
  version: number;
  simulatorPaths: SimulatorPath[];
  autoScanOnStartup: boolean;
  theme: 'dark' | 'light';
  minimizeToTray: boolean;
  startWithWindows: boolean;
  checkForUpdates: boolean;
}

// =============================================================================
// Process Types
// =============================================================================

export interface ProcessInfo {
  name: string;
  pid: number;
  windowTitle?: string;
}

export interface ProcessCheckResult {
  processName: string;
  displayName: string;
  running: boolean;
  pid?: number;
}

// =============================================================================
// Game Launch Types
// =============================================================================

export interface GameProfile {
  id: string;
  name: string;
  executablePath: string;
  arguments: string[];
  workingDirectory?: string;
  icon?: string;
  preLaunchProcesses: string[];
  autoStartProcesses: AutoStartProcess[];
}

export interface AutoStartProcess {
  name: string;
  executablePath: string;
  arguments: string[];
  waitSeconds: number;
}

export interface LaunchResult {
  success: boolean;
  message: string;
  missingProcesses?: string[];
  startedProcesses?: string[];
}

export interface DetectedGame {
  name: string;
  path: string;
}

// =============================================================================
// Pre-Flight Types
// =============================================================================

export type PreflightCheckType = 'devices' | 'displays' | 'process';

export interface PreflightCheck {
  id: string;
  type: PreflightCheckType;
  name: string;
  enabled: boolean;
  config: DeviceCheckConfig | DisplayCheckConfig | ProcessCheckConfig;
}

export interface DeviceCheckConfig {
  deviceIds: string[];
}

export interface DisplayCheckConfig {
  profileName: string;
}

export interface ProcessCheckConfig {
  processName: string;
  displayName: string;
}

export interface PreflightResult {
  checkId: string;
  passed: boolean;
  message: string;
  timestamp: number;
}

// =============================================================================
// Update Types
// =============================================================================

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateDownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateStatus {
  state: UpdateState;
  version: string;
  availableVersion?: string;
  releaseNotes?: string;
  downloadProgress?: UpdateDownloadProgress;
  error?: string;
}

// =============================================================================
// IPC Types (Future - for type-safe IPC)
// =============================================================================

// When we implement type-safe IPC, channel definitions will go here
// export interface IpcChannels {
//   'devices:getAll': { args: []; return: USBDevice[] };
//   'devices:getUnifiedInputDevices': { args: []; return: UnifiedDevice[] };
//   ...
// }
