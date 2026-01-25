import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

// Known vendor IDs for sim hardware
const KNOWN_VENDORS: Record<string, string> = {
  '4098': 'WinWing',
  '044F': 'Thrustmaster',
  '3344': 'Virpil',
  '0FD9': 'Elgato',
  '1189': 'NaturalPoint',
  '231D': 'VKB',
  '03EB': 'VKB (Atmel)',
  '1038': 'SteelSeries',
  '046D': 'Logitech',
  '0738': 'MadCatz/Saitek',
  '06A3': 'Saitek',
};

// Known product IDs (to be expanded as we identify devices)
const KNOWN_PRODUCTS: Record<string, Record<string, string>> = {
  '4098': {
    // WinWing devices - identified from user's rig
    'BE03': 'WinWing Device',
    'BEA8': 'Orion Joystick Base 2 + F-16 Grip',
    'BEE0': 'WinWing Device',
    'BEDE': 'WinWing Device',
    'BEE1': 'WinWing Device',
    'BEE2': 'WinWing Device',
    'BF05': 'WinWing Device',
    'BF06': 'WinWing Device',
    'BD26': 'Throttle Base1 + F-15EX Handles',
  },
  '044F': {
    'B68F': 'T-Pendular-Rudder (TPR)',
    'B10A': 'T.16000M Joystick',
    'B679': 'T.Flight Rudder Pedals',
    'B67B': 'TPR Rudder Pedals',
    'B351': 'Warthog Throttle',
    'B352': 'Warthog Joystick',
    'B687': 'TWCS Throttle',
  },
  '3344': {
    'C259': 'VPC Panel #1',
    '412B': 'VPC Constellation Alpha',
    '8194': 'VPC MongoosT-50CM3',
    '0194': 'VPC Throttle',
  },
  '0FD9': {
    '008F': 'Stream Deck MK.2',
    '0060': 'Stream Deck',
    '0063': 'Stream Deck Mini',
    '006C': 'Stream Deck XL',
    '0080': 'Stream Deck +',
  },
  '1189': {
    '8890': 'TrackIR 5',
    '8200': 'TrackIR 4',
  },
};

export interface Device {
  vendorId: string;
  productId: string;
  vendorName: string;
  productName: string;
  instanceId: string;
  friendlyName: string;
  status: 'connected' | 'disconnected' | 'unknown';
  type: 'joystick' | 'throttle' | 'pedals' | 'panel' | 'headtracker' | 'streamdeck' | 'other';
}

export interface DeviceStatus {
  connected: Device[];
  missing: Device[];
  unexpected: Device[];
  allExpectedConnected: boolean;
}

export interface GamepadState {
  index: number;
  id: string;
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
  timestamp: number;
}

export class DeviceManager {
  private configPath: string;
  private expectedDevices: Device[] = [];
  private pollingInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.configPath = path.join(
      process.env.USERPROFILE || '',
      '.sim-manager',
      'devices.json'
    );
    this.loadExpectedDevices();
  }

  private loadExpectedDevices(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        this.expectedDevices = JSON.parse(data);
      }
    } catch (error) {
      console.error('Failed to load expected devices:', error);
      this.expectedDevices = [];
    }
  }

  private saveExpectedDevices(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.expectedDevices, null, 2)
      );
    } catch (error) {
      console.error('Failed to save expected devices:', error);
    }
  }

  async getAllDevices(): Promise<Device[]> {
    // Use script file to avoid escaping issues
    const scriptPath = path.join(__dirname, 'get-devices.ps1');

    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
        { maxBuffer: 10 * 1024 * 1024 }
      );

      if (!stdout.trim()) {
        return [];
      }

      const rawDevices = JSON.parse(stdout);
      const devices: Device[] = (Array.isArray(rawDevices) ? rawDevices : [rawDevices])
        .filter((d: any) => d.VendorId)
        .map((d: any) => this.parseDevice(d));

      // Deduplicate by vendorId + productId (keep first occurrence)
      const seen = new Set<string>();
      return devices.filter((d) => {
        const key = `${d.vendorId}:${d.productId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } catch (error) {
      console.error('Failed to get devices:', error);
      return [];
    }
  }

  private parseDevice(raw: any): Device {
    const vendorId = raw.VendorId.toUpperCase();
    const productId = raw.ProductId.toUpperCase();
    const vendorName = KNOWN_VENDORS[vendorId] || `Unknown (${vendorId})`;
    const productName =
      KNOWN_PRODUCTS[vendorId]?.[productId] || `Unknown Device (${productId})`;

    return {
      vendorId,
      productId,
      vendorName,
      productName,
      instanceId: raw.InstanceId,
      friendlyName: raw.FriendlyName,
      status: 'connected',
      type: this.inferDeviceType(vendorId, productId, raw.FriendlyName),
    };
  }

  private inferDeviceType(
    vendorId: string,
    productId: string,
    friendlyName: string
  ): Device['type'] {
    const name = friendlyName.toLowerCase();

    // By vendor
    if (vendorId === '1189') return 'headtracker';
    if (vendorId === '0FD9') return 'streamdeck';

    // By product name patterns
    if (name.includes('throttle')) return 'throttle';
    if (name.includes('rudder') || name.includes('pedal')) return 'pedals';
    if (name.includes('joystick') || name.includes('stick')) return 'joystick';
    if (name.includes('panel') || name.includes('button box')) return 'panel';

    // Default to 'other' for game controllers we can't identify
    if (name.includes('game controller')) return 'joystick';

    return 'other';
  }

  getExpectedDevices(): Device[] {
    return this.expectedDevices;
  }

  async saveCurrentAsExpected(): Promise<boolean> {
    try {
      this.expectedDevices = await this.getAllDevices();
      this.saveExpectedDevices();
      return true;
    } catch (error) {
      console.error('Failed to save current as expected:', error);
      return false;
    }
  }

  async checkDeviceStatus(): Promise<DeviceStatus> {
    const connected = await this.getAllDevices();
    const connectedKeys = new Set(
      connected.map((d) => `${d.vendorId}:${d.productId}`)
    );
    const expectedKeys = new Set(
      this.expectedDevices.map((d) => `${d.vendorId}:${d.productId}`)
    );

    const missing = this.expectedDevices.filter(
      (d) => !connectedKeys.has(`${d.vendorId}:${d.productId}`)
    );

    const unexpected = connected.filter(
      (d) => !expectedKeys.has(`${d.vendorId}:${d.productId}`)
    );

    return {
      connected,
      missing: missing.map((d) => ({ ...d, status: 'disconnected' })),
      unexpected,
      allExpectedConnected: missing.length === 0,
    };
  }

  startGamepadPolling(callback: (state: GamepadState[]) => void): void {
    // Note: In Electron main process, we can't use the Gamepad API directly
    // We'll use a renderer-side implementation instead
    // This is a placeholder for the IPC handler
  }

  stopGamepadPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}
