import * as HID from 'node-hid';

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
  buttons: boolean[]; // Parsed button states
  timestamp: number;
}

// Known vendor names
const VENDOR_NAMES: Record<number, string> = {
  0x4098: 'WinWing',
  0x044f: 'Thrustmaster',
  0x3344: 'Virpil',
  0x0fd9: 'Elgato',
  0x1189: 'NaturalPoint',
  0x231d: 'VKB',
  0x03eb: 'VKB (Atmel)',
  0x1038: 'SteelSeries',
  0x046d: 'Logitech',
  0x0738: 'MadCatz/Saitek',
  0x06a3: 'Saitek',
};

// Vendor IDs we care about for sim hardware
const SIM_VENDOR_IDS = [
  0x4098, // WinWing
  0x044f, // Thrustmaster
  0x3344, // Virpil
  0x231d, // VKB
  0x03eb, // VKB (Atmel)
  0x0738, // MadCatz/Saitek
  0x06a3, // Saitek
];

export class HIDManager {
  private openDevices: Map<string, HID.HID> = new Map();
  private deviceStates: Map<string, HIDInputState> = new Map();
  private deviceInfoCache: Map<string, HIDDeviceInfo> = new Map(); // Cache device info to avoid re-enumeration
  private pollingInterval: NodeJS.Timeout | null = null;
  private inputCallback: ((states: HIDInputState[]) => void) | null = null;
  private lastCallbackTime: number = 0;
  private callbackThrottleMs: number = 50; // Only send updates every 50ms max (20 fps)
  private pendingCallback: boolean = false;

  constructor() {
    console.log('HID Manager initialized');
  }

  /**
   * Get all HID devices (optionally filtered to sim hardware vendors)
   */
  getAllDevices(simOnly: boolean = false): HIDDeviceInfo[] {
    try {
      const devices = HID.devices();

      let filtered = devices;
      if (simOnly) {
        filtered = devices.filter((d) => SIM_VENDOR_IDS.includes(d.vendorId));
      }

      return filtered.map((d) => ({
        vendorId: d.vendorId,
        productId: d.productId,
        path: d.path || '',
        serialNumber: d.serialNumber || '',
        manufacturer: d.manufacturer || VENDOR_NAMES[d.vendorId] || 'Unknown',
        product: d.product || `Device ${d.productId.toString(16).toUpperCase()}`,
        release: d.release,
        interface: d.interface,
        usagePage: d.usagePage,
        usage: d.usage,
      }));
    } catch (error) {
      console.error('Failed to enumerate HID devices:', error);
      return [];
    }
  }

  /**
   * Get sim hardware devices only
   */
  getSimDevices(): HIDDeviceInfo[] {
    return this.getAllDevices(true);
  }

  /**
   * Open a device for reading inputs
   */
  openDevice(path: string): boolean {
    if (this.openDevices.has(path)) {
      return true; // Already open
    }

    try {
      // Cache device info BEFORE opening to avoid re-enumeration during data events
      if (!this.deviceInfoCache.has(path)) {
        const devices = this.getAllDevices();
        const deviceInfo = devices.find((d) => d.path === path);
        if (deviceInfo) {
          this.deviceInfoCache.set(path, deviceInfo);
        }
      }

      const device = new HID.HID(path);
      device.on('data', (data: Buffer) => {
        this.handleDeviceData(path, data);
      });
      device.on('error', (err: Error) => {
        console.error(`HID device error (${path}):`, err.message);
        this.closeDevice(path);
      });
      this.openDevices.set(path, device);
      console.log(`Opened HID device: ${path}`);
      return true;
    } catch (error: any) {
      console.error(`Failed to open HID device (${path}):`, error.message);
      return false;
    }
  }

  /**
   * Close a device
   */
  closeDevice(path: string): void {
    const device = this.openDevices.get(path);
    if (device) {
      try {
        device.close();
      } catch {
        // Ignore close errors
      }
      this.openDevices.delete(path);
      this.deviceStates.delete(path);
      this.deviceInfoCache.delete(path); // Clear cached device info
      console.log(`Closed HID device: ${path}`);
    }
  }

  /**
   * Close all open devices
   */
  closeAllDevices(): void {
    for (const path of this.openDevices.keys()) {
      this.closeDevice(path);
    }
  }

  /**
   * Handle incoming data from a device
   */
  private handleDeviceData(path: string, data: Buffer): void {
    // Use cached device info instead of re-enumerating all devices on every data event
    const deviceInfo = this.deviceInfoCache.get(path);

    // Parse buttons from raw bytes (skip first byte which is usually report ID)
    // Each bit in bytes 1+ represents a button
    const buttons: boolean[] = [];
    for (let byteIdx = 1; byteIdx < data.length; byteIdx++) {
      const byte = data[byteIdx];
      for (let bit = 0; bit < 8; bit++) {
        buttons.push((byte & (1 << bit)) !== 0);
      }
    }

    const state: HIDInputState = {
      vendorId: deviceInfo?.vendorId || 0,
      productId: deviceInfo?.productId || 0,
      path,
      productName: deviceInfo?.product || 'Unknown',
      data: Array.from(data),
      buttons,
      timestamp: Date.now(),
    };

    this.deviceStates.set(path, state);

    // Throttle callback to prevent overwhelming the renderer
    this.scheduleCallback();
  }

  private scheduleCallback(): void {
    if (!this.inputCallback || this.pendingCallback) return;

    const now = Date.now();
    const timeSinceLastCallback = now - this.lastCallbackTime;

    if (timeSinceLastCallback >= this.callbackThrottleMs) {
      // Send immediately
      this.lastCallbackTime = now;
      this.inputCallback(Array.from(this.deviceStates.values()));
    } else {
      // Schedule for later
      this.pendingCallback = true;
      setTimeout(() => {
        this.pendingCallback = false;
        if (this.inputCallback) {
          this.lastCallbackTime = Date.now();
          this.inputCallback(Array.from(this.deviceStates.values()));
        }
      }, this.callbackThrottleMs - timeSinceLastCallback);
    }
  }

  /**
   * Start polling/monitoring all sim devices
   */
  startMonitoring(callback: (states: HIDInputState[]) => void): void {
    this.inputCallback = callback;

    // Get all sim devices
    const simDevices = this.getSimDevices();
    console.log(`Found ${simDevices.length} sim devices to monitor`);

    // Open each device
    for (const device of simDevices) {
      if (device.path) {
        // Only open devices with usage page 1 (generic desktop) to avoid conflicts
        // Usage 4 = Joystick, Usage 5 = Game Pad
        const usagePage = device.usagePage || 0;
        const usage = device.usage || 0;
        if (usagePage === 1 && (usage === 4 || usage === 5)) {
          console.log(
            `Opening HID device: ${device.product} (${device.vendorId.toString(16)}:${device.productId.toString(16)}) usagePage=${usagePage} usage=${usage}`
          );
          this.openDevice(device.path);
        } else {
          console.log(
            `Skipping HID device: ${device.product} (${device.vendorId.toString(16)}:${device.productId.toString(16)}) usagePage=${usagePage} usage=${usage}`
          );
        }
      }
    }

    console.log(`Monitoring ${this.openDevices.size} HID devices`);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    this.inputCallback = null;
    this.closeAllDevices();
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Get current states of all monitored devices
   */
  getCurrentStates(): HIDInputState[] {
    return Array.from(this.deviceStates.values());
  }
}
