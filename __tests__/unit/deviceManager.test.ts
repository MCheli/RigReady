import { DeviceManager } from '../../src/main/devices/deviceManager';
import * as fs from 'fs';
import * as path from 'path';

// Mock the fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

describe('DeviceManager', () => {
  let deviceManager: DeviceManager;
  const _testConfigDir = 'C:\\Users\\Test\\.rigready';
  const _testConfigPath = path.join(_testConfigDir, 'devices.json');

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock USERPROFILE
    process.env.USERPROFILE = 'C:\\Users\\Test';
    mockFs.existsSync.mockReturnValue(false);
    deviceManager = new DeviceManager();
  });

  describe('constructor', () => {
    it('should initialize with empty expected devices if config does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      const manager = new DeviceManager();
      expect(manager.getExpectedDevices()).toEqual([]);
    });

    it('should load expected devices from config file if it exists', () => {
      const mockDevices = [
        {
          vendorId: '4098',
          productId: 'BE03',
          vendorName: 'WinWing',
          productName: 'Combat Panel II',
          instanceId: 'test-instance',
          friendlyName: 'Test Device',
          status: 'connected',
          type: 'panel',
        },
      ];
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockDevices));

      const manager = new DeviceManager();
      expect(manager.getExpectedDevices()).toEqual(mockDevices);
    });

    it('should handle invalid JSON in config file gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

      // Should not throw, should return empty array
      const manager = new DeviceManager();
      expect(manager.getExpectedDevices()).toEqual([]);
    });
  });

  describe('getExpectedDevices', () => {
    it('should return the expected devices array', () => {
      const devices = deviceManager.getExpectedDevices();
      expect(Array.isArray(devices)).toBe(true);
    });
  });

  describe('device type inference', () => {
    // We need to test the private inferDeviceType method indirectly
    // by mocking getAllDevices or by making the method accessible

    it('should identify NaturalPoint devices as headtracker', () => {
      // VendorId 1189 is NaturalPoint
      const mockRawDevice = {
        VendorId: '1189',
        ProductId: '8890',
        InstanceId: 'test',
        FriendlyName: 'TrackIR 5',
      };

      // Access private method via prototype
      const parseDevice = (
        DeviceManager.prototype as unknown as {
          parseDevice: (raw: typeof mockRawDevice) => {
            type: string;
            vendorName: string;
            productName: string;
          };
        }
      ).parseDevice;

      // Bind to a new instance
      const result = parseDevice.call(deviceManager, mockRawDevice);
      expect(result.type).toBe('headtracker');
      expect(result.vendorName).toBe('NaturalPoint');
    });

    it('should identify Elgato devices as streamdeck', () => {
      const mockRawDevice = {
        VendorId: '0FD9',
        ProductId: '008F',
        InstanceId: 'test',
        FriendlyName: 'Stream Deck MK.2',
      };

      const parseDevice = (
        DeviceManager.prototype as unknown as {
          parseDevice: (raw: typeof mockRawDevice) => { type: string };
        }
      ).parseDevice;

      const result = parseDevice.call(deviceManager, mockRawDevice);
      expect(result.type).toBe('streamdeck');
    });

    it('should identify throttle devices by name', () => {
      const mockRawDevice = {
        VendorId: '044F',
        ProductId: 'B351',
        InstanceId: 'test',
        FriendlyName: 'Warthog Throttle',
      };

      const parseDevice = (
        DeviceManager.prototype as unknown as {
          parseDevice: (raw: typeof mockRawDevice) => { type: string };
        }
      ).parseDevice;

      const result = parseDevice.call(deviceManager, mockRawDevice);
      expect(result.type).toBe('throttle');
    });

    it('should identify rudder pedals by name', () => {
      const mockRawDevice = {
        VendorId: '044F',
        ProductId: 'B67B',
        InstanceId: 'test',
        FriendlyName: 'TPR Rudder Pedals',
      };

      const parseDevice = (
        DeviceManager.prototype as unknown as {
          parseDevice: (raw: typeof mockRawDevice) => { type: string };
        }
      ).parseDevice;

      const result = parseDevice.call(deviceManager, mockRawDevice);
      expect(result.type).toBe('pedals');
    });

    it('should identify panels by name', () => {
      const mockRawDevice = {
        VendorId: '4098',
        ProductId: 'BEDE',
        InstanceId: 'test',
        FriendlyName: 'MFD Panel Left',
      };

      const parseDevice = (
        DeviceManager.prototype as unknown as {
          parseDevice: (raw: typeof mockRawDevice) => { type: string };
        }
      ).parseDevice;

      const result = parseDevice.call(deviceManager, mockRawDevice);
      expect(result.type).toBe('panel');
    });

    it('should identify joysticks by name', () => {
      const mockRawDevice = {
        VendorId: '044F',
        ProductId: 'B352',
        InstanceId: 'test',
        FriendlyName: 'Warthog Joystick',
      };

      const parseDevice = (
        DeviceManager.prototype as unknown as {
          parseDevice: (raw: typeof mockRawDevice) => { type: string };
        }
      ).parseDevice;

      const result = parseDevice.call(deviceManager, mockRawDevice);
      expect(result.type).toBe('joystick');
    });

    it('should default to other for unknown devices', () => {
      const mockRawDevice = {
        VendorId: '1234',
        ProductId: '5678',
        InstanceId: 'test',
        FriendlyName: 'Unknown Device',
      };

      const parseDevice = (
        DeviceManager.prototype as unknown as {
          parseDevice: (raw: typeof mockRawDevice) => { type: string };
        }
      ).parseDevice;

      const result = parseDevice.call(deviceManager, mockRawDevice);
      expect(result.type).toBe('other');
    });
  });

  describe('parseDevice', () => {
    it('should correctly parse known WinWing devices', () => {
      const mockRawDevice = {
        VendorId: '4098',
        ProductId: 'BE03',
        InstanceId: 'USB\\VID_4098&PID_BE03',
        FriendlyName: 'Combat Panel II',
      };

      const parseDevice = (
        DeviceManager.prototype as unknown as {
          parseDevice: (raw: typeof mockRawDevice) => {
            vendorId: string;
            productId: string;
            vendorName: string;
            productName: string;
            status: string;
          };
        }
      ).parseDevice;

      const result = parseDevice.call(deviceManager, mockRawDevice);

      expect(result.vendorId).toBe('4098');
      expect(result.productId).toBe('BE03');
      expect(result.vendorName).toBe('WinWing');
      expect(result.productName).toBe('Combat Panel II');
      expect(result.status).toBe('connected');
    });

    it('should handle unknown vendors gracefully', () => {
      const mockRawDevice = {
        VendorId: 'ABCD',
        ProductId: '1234',
        InstanceId: 'USB\\VID_ABCD&PID_1234',
        FriendlyName: 'Unknown Device',
      };

      const parseDevice = (
        DeviceManager.prototype as unknown as {
          parseDevice: (raw: typeof mockRawDevice) => {
            vendorName: string;
            productName: string;
          };
        }
      ).parseDevice;

      const result = parseDevice.call(deviceManager, mockRawDevice);

      expect(result.vendorName).toBe('Unknown (ABCD)');
      expect(result.productName).toBe('Unknown Device (1234)');
    });

    it('should uppercase vendorId and productId', () => {
      const mockRawDevice = {
        VendorId: 'abcd',
        ProductId: 'ef01',
        InstanceId: 'test',
        FriendlyName: 'Test Device',
      };

      const parseDevice = (
        DeviceManager.prototype as unknown as {
          parseDevice: (raw: typeof mockRawDevice) => {
            vendorId: string;
            productId: string;
          };
        }
      ).parseDevice;

      const result = parseDevice.call(deviceManager, mockRawDevice);

      expect(result.vendorId).toBe('ABCD');
      expect(result.productId).toBe('EF01');
    });
  });

  describe('known vendors', () => {
    it('should have WinWing in known vendors', () => {
      const mockRawDevice = {
        VendorId: '4098',
        ProductId: '0000',
        InstanceId: 'test',
        FriendlyName: 'Test',
      };

      const parseDevice = (
        DeviceManager.prototype as unknown as {
          parseDevice: (raw: typeof mockRawDevice) => { vendorName: string };
        }
      ).parseDevice;

      const result = parseDevice.call(deviceManager, mockRawDevice);
      expect(result.vendorName).toBe('WinWing');
    });

    it('should have Thrustmaster in known vendors', () => {
      const mockRawDevice = {
        VendorId: '044F',
        ProductId: '0000',
        InstanceId: 'test',
        FriendlyName: 'Test',
      };

      const parseDevice = (
        DeviceManager.prototype as unknown as {
          parseDevice: (raw: typeof mockRawDevice) => { vendorName: string };
        }
      ).parseDevice;

      const result = parseDevice.call(deviceManager, mockRawDevice);
      expect(result.vendorName).toBe('Thrustmaster');
    });

    it('should have Virpil in known vendors', () => {
      const mockRawDevice = {
        VendorId: '3344',
        ProductId: '0000',
        InstanceId: 'test',
        FriendlyName: 'Test',
      };

      const parseDevice = (
        DeviceManager.prototype as unknown as {
          parseDevice: (raw: typeof mockRawDevice) => { vendorName: string };
        }
      ).parseDevice;

      const result = parseDevice.call(deviceManager, mockRawDevice);
      expect(result.vendorName).toBe('Virpil');
    });

    it('should have VKB in known vendors', () => {
      const mockRawDevice = {
        VendorId: '231D',
        ProductId: '0000',
        InstanceId: 'test',
        FriendlyName: 'Test',
      };

      const parseDevice = (
        DeviceManager.prototype as unknown as {
          parseDevice: (raw: typeof mockRawDevice) => { vendorName: string };
        }
      ).parseDevice;

      const result = parseDevice.call(deviceManager, mockRawDevice);
      expect(result.vendorName).toBe('VKB');
    });

    it('should have Logitech in known vendors', () => {
      const mockRawDevice = {
        VendorId: '046D',
        ProductId: '0000',
        InstanceId: 'test',
        FriendlyName: 'Test',
      };

      const parseDevice = (
        DeviceManager.prototype as unknown as {
          parseDevice: (raw: typeof mockRawDevice) => { vendorName: string };
        }
      ).parseDevice;

      const result = parseDevice.call(deviceManager, mockRawDevice);
      expect(result.vendorName).toBe('Logitech');
    });
  });
});
