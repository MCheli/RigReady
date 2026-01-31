/**
 * Mock for node-hid module
 * Used in Jest tests to simulate HID device interactions
 */

export interface MockHIDDevice {
  vendorId: number;
  productId: number;
  path: string;
  serialNumber: string;
  manufacturer: string;
  product: string;
  release: number;
  interface: number;
  usagePage: number;
  usage: number;
}

// Sample mock devices for testing
export const mockDevices: MockHIDDevice[] = [
  {
    vendorId: 0x4098,
    productId: 0xbea8,
    path: '\\\\?\\hid#mock_device_1',
    serialNumber: 'SN001',
    manufacturer: 'WinWing',
    product: 'Orion Joystick',
    release: 0x0100,
    interface: 0,
    usagePage: 1,
    usage: 4,
  },
  {
    vendorId: 0x044f,
    productId: 0xb68f,
    path: '\\\\?\\hid#mock_device_2',
    serialNumber: 'SN002',
    manufacturer: 'Thrustmaster',
    product: 'T-Pendular-Rudder',
    release: 0x0100,
    interface: 0,
    usagePage: 1,
    usage: 4,
  },
];

// Mock HID device instance
export class HID {
  private path: string;
  private dataCallback: ((data: Buffer) => void) | null = null;
  private errorCallback: ((err: Error) => void) | null = null;

  constructor(path: string) {
    this.path = path;
  }

  on(event: string, callback: (data: any) => void) {
    if (event === 'data') {
      this.dataCallback = callback;
    } else if (event === 'error') {
      this.errorCallback = callback;
    }
    return this;
  }

  close() {
    this.dataCallback = null;
    this.errorCallback = null;
  }

  // Helper for tests to simulate data
  simulateData(data: Buffer) {
    if (this.dataCallback) {
      this.dataCallback(data);
    }
  }

  // Helper for tests to simulate error
  simulateError(err: Error) {
    if (this.errorCallback) {
      this.errorCallback(err);
    }
  }
}

// Mock devices() function
export const devices = jest.fn().mockReturnValue(mockDevices);

export default {
  HID,
  devices,
};
