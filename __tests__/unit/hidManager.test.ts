/**
 * Unit tests for HIDManager
 */

import { HIDManager } from '../../src/main/devices/hidManager';

// Create mock instance that will be returned by the HID constructor
const mockHIDInstance = {
  on: jest.fn().mockReturnThis(),
  close: jest.fn(),
};

// Mock node-hid before importing
jest.mock('node-hid', () => ({
  devices: jest.fn(),
  HID: jest.fn().mockImplementation(() => mockHIDInstance),
}));

// Import after mocking
import * as HID from 'node-hid';

const mockedDevices = HID.devices as jest.MockedFunction<typeof HID.devices>;
const MockedHID = HID.HID as jest.MockedClass<typeof HID.HID>;

describe('HIDManager', () => {
  let hidManager: HIDManager;

  const mockDeviceList: Partial<HID.Device>[] = [
    {
      vendorId: 0x4098,
      productId: 0xbea8,
      path: '\\\\?\\hid#device1',
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
      path: '\\\\?\\hid#device2',
      serialNumber: 'SN002',
      manufacturer: 'Thrustmaster',
      product: 'T-Rudder',
      release: 0x0100,
      interface: 0,
      usagePage: 1,
      usage: 4,
    },
    {
      vendorId: 0x1234,
      productId: 0x5678,
      path: '\\\\?\\hid#device3',
      serialNumber: 'SN003',
      manufacturer: 'Generic',
      product: 'Mouse',
      release: 0x0100,
      interface: 0,
      usagePage: 1,
      usage: 2, // Not a joystick
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockedDevices.mockReturnValue(mockDeviceList as HID.Device[]);
    mockHIDInstance.on.mockReturnThis();
    mockHIDInstance.close.mockClear();
    hidManager = new HIDManager();
  });

  describe('getAllDevices', () => {
    it('should return all HID devices', () => {
      const devices = hidManager.getAllDevices();

      expect(devices).toHaveLength(3);
      expect(mockedDevices).toHaveBeenCalled();
    });

    it('should map device properties correctly', () => {
      const devices = hidManager.getAllDevices();

      expect(devices[0]).toMatchObject({
        vendorId: 0x4098,
        productId: 0xbea8,
        path: '\\\\?\\hid#device1',
        manufacturer: 'WinWing',
        product: 'Orion Joystick',
      });
    });

    it('should handle empty device list', () => {
      mockedDevices.mockReturnValue([]);

      const devices = hidManager.getAllDevices();

      expect(devices).toHaveLength(0);
    });

    it('should handle devices() throwing an error', () => {
      mockedDevices.mockImplementation(() => {
        throw new Error('HID enumeration failed');
      });

      const devices = hidManager.getAllDevices();

      expect(devices).toHaveLength(0);
    });
  });

  describe('getSimDevices', () => {
    it('should return only sim hardware vendor devices', () => {
      const devices = hidManager.getSimDevices();

      // Should include WinWing (0x4098) and Thrustmaster (0x044F)
      // Should exclude Generic (0x1234)
      expect(devices).toHaveLength(2);
      expect(devices.every((d) => [0x4098, 0x044f].includes(d.vendorId))).toBe(true);
    });
  });

  describe('openDevice', () => {
    it('should open a device by path', () => {
      const result = hidManager.openDevice('\\\\?\\hid#device1');

      expect(result).toBe(true);
      expect(MockedHID).toHaveBeenCalledWith('\\\\?\\hid#device1');
    });

    it('should register data and error handlers', () => {
      hidManager.openDevice('\\\\?\\hid#device1');

      expect(mockHIDInstance.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockHIDInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should return true if device already open', () => {
      hidManager.openDevice('\\\\?\\hid#device1');
      MockedHID.mockClear();

      // Open same device again
      const result = hidManager.openDevice('\\\\?\\hid#device1');

      expect(result).toBe(true);
      // Should not be called again
      expect(MockedHID).not.toHaveBeenCalled();
    });

    it('should return false if device fails to open', () => {
      MockedHID.mockImplementation(() => {
        throw new Error('Device in use');
      });

      const result = hidManager.openDevice('\\\\?\\hid#device1');

      expect(result).toBe(false);
    });

    it('should cache device info before opening', () => {
      hidManager.openDevice('\\\\?\\hid#device1');

      // Verify devices() was called to cache info
      expect(mockedDevices).toHaveBeenCalled();
    });
  });

  describe('closeDevice', () => {
    beforeEach(() => {
      // Reset mock to default behavior
      MockedHID.mockImplementation(() => mockHIDInstance as unknown as HID.HID);
    });

    it('should close an open device', () => {
      hidManager.openDevice('\\\\?\\hid#device1');
      hidManager.closeDevice('\\\\?\\hid#device1');

      expect(mockHIDInstance.close).toHaveBeenCalled();
    });

    it('should handle closing a device that is not open', () => {
      // Should not throw
      expect(() => {
        hidManager.closeDevice('\\\\?\\hid#nonexistent');
      }).not.toThrow();
    });

    it('should allow reopening a closed device', () => {
      hidManager.openDevice('\\\\?\\hid#device1');
      hidManager.closeDevice('\\\\?\\hid#device1');
      MockedHID.mockClear();

      hidManager.openDevice('\\\\?\\hid#device1');

      expect(MockedHID).toHaveBeenCalledTimes(1);
    });
  });

  describe('closeAllDevices', () => {
    beforeEach(() => {
      MockedHID.mockImplementation(() => mockHIDInstance as unknown as HID.HID);
    });

    it('should close all open devices', () => {
      hidManager.openDevice('\\\\?\\hid#device1');
      hidManager.openDevice('\\\\?\\hid#device2');
      mockHIDInstance.close.mockClear();

      hidManager.closeAllDevices();

      // close() should be called for each device
      expect(mockHIDInstance.close).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCurrentStates', () => {
    it('should return empty array when no devices are monitored', () => {
      const states = hidManager.getCurrentStates();

      expect(states).toEqual([]);
    });
  });

  describe('device info caching (performance fix)', () => {
    let dataCallback: ((data: Buffer) => void) | null = null;

    beforeEach(() => {
      dataCallback = null;
      mockHIDInstance.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') {
          dataCallback = cb;
        }
        return mockHIDInstance;
      });
      MockedHID.mockImplementation(() => mockHIDInstance as unknown as HID.HID);
    });

    it('should not call devices() on every data event', () => {
      hidManager.openDevice('\\\\?\\hid#device1');

      // Clear the call count from openDevice
      mockedDevices.mockClear();

      // Simulate multiple data events
      const testData = Buffer.from([0x01, 0x00, 0x00]);
      if (dataCallback) {
        dataCallback(testData);
        dataCallback(testData);
        dataCallback(testData);
      }

      // devices() should NOT be called on data events (this was the performance bug)
      expect(mockedDevices).not.toHaveBeenCalled();
    });
  });
});
