// Mock dcsKeybindingService before importing
jest.mock('../../src/main/services/dcsKeybindingService', () => ({
  dcsKeybindingService: {
    getModuleBindings: jest.fn(),
    scanModules: jest.fn(),
  },
}));

import { bindingAnalysisService } from '../../src/main/services/bindingAnalysisService';
import { dcsKeybindingService } from '../../src/main/services/dcsKeybindingService';
import type { DCSDeviceBindings } from '../../src/shared/dcsTypes';

const mockDcsService = dcsKeybindingService as jest.Mocked<typeof dcsKeybindingService>;

function makeDeviceBindings(overrides: Partial<DCSDeviceBindings> = {}): DCSDeviceBindings {
  return {
    deviceName: 'Test Joystick',
    deviceGuid: 'test-guid-123',
    filePath: 'C:\\test\\file.diff.lua',
    module: 'FA-18C',
    axisBindings: [],
    keyBindings: [],
    ...overrides,
  };
}

describe('BindingAnalysisService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findDuplicatesInModule', () => {
    it('should detect key duplicates', () => {
      mockDcsService.getModuleBindings.mockReturnValue([
        makeDeviceBindings({
          keyBindings: [
            { id: 'action1', name: 'Fire Gun', key: 'JOY_BTN1' },
            { id: 'action2', name: 'Drop Bomb', key: 'JOY_BTN1' },
          ],
        }),
      ]);

      const results = bindingAnalysisService.findDuplicatesInModule('FA-18C');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].duplicates.length).toBe(2);
      expect(results[0].duplicates[0].bindingType).toBe('key');
    });

    it('should detect axis duplicates', () => {
      mockDcsService.getModuleBindings.mockReturnValue([
        makeDeviceBindings({
          axisBindings: [
            { id: 'axis1', name: 'Roll', key: 'JOY_X' },
            { id: 'axis2', name: 'Aileron', key: 'JOY_X' },
          ],
        }),
      ]);

      const results = bindingAnalysisService.findDuplicatesInModule('FA-18C');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].duplicates.some((d) => d.bindingType === 'axis')).toBe(true);
    });

    it('should ignore removed bindings', () => {
      mockDcsService.getModuleBindings.mockReturnValue([
        makeDeviceBindings({
          keyBindings: [
            { id: 'action1', name: 'Fire Gun', key: 'JOY_BTN1' },
            { id: 'action2', name: 'Drop Bomb', key: 'JOY_BTN1', isRemoved: true },
          ],
        }),
      ]);

      const results = bindingAnalysisService.findDuplicatesInModule('FA-18C');
      expect(results).toHaveLength(0);
    });

    it('should return empty for no duplicates', () => {
      mockDcsService.getModuleBindings.mockReturnValue([
        makeDeviceBindings({
          keyBindings: [
            { id: 'action1', name: 'Fire Gun', key: 'JOY_BTN1' },
            { id: 'action2', name: 'Drop Bomb', key: 'JOY_BTN2' },
          ],
        }),
      ]);

      const results = bindingAnalysisService.findDuplicatesInModule('FA-18C');
      expect(results).toHaveLength(0);
    });
  });

  describe('getPerDeviceSummary', () => {
    it('should aggregate across modules', () => {
      mockDcsService.scanModules.mockReturnValue({
        savedGamesPath: 'C:\\test',
        modules: [
          { id: 'FA-18C', name: 'FA-18C', path: 'C:\\test\\FA-18C', deviceCount: 1 },
          { id: 'A-10C', name: 'A-10C', path: 'C:\\test\\A-10C', deviceCount: 1 },
        ],
        errors: [],
      });

      mockDcsService.getModuleBindings.mockImplementation((moduleId: string) => {
        return [
          makeDeviceBindings({
            module: moduleId,
            keyBindings: [{ id: 'action1', name: 'Test', key: 'JOY_BTN1' }],
          }),
        ];
      });

      const summary = bindingAnalysisService.getPerDeviceSummary();
      expect(summary.length).toBeGreaterThan(0);
      expect(summary[0].modules).toContain('FA-18C');
      expect(summary[0].modules).toContain('A-10C');
      expect(summary[0].totalKeyBindings).toBe(2);
    });

    it('should sort by total binding count', () => {
      mockDcsService.scanModules.mockReturnValue({
        savedGamesPath: 'C:\\test',
        modules: [{ id: 'FA-18C', name: 'FA-18C', path: 'C:\\test\\FA-18C', deviceCount: 2 }],
        errors: [],
      });

      mockDcsService.getModuleBindings.mockReturnValue([
        makeDeviceBindings({
          deviceGuid: 'guid-1',
          keyBindings: [{ id: 'a1', name: 'A', key: 'B1' }],
        }),
        makeDeviceBindings({
          deviceGuid: 'guid-2',
          keyBindings: [
            { id: 'a1', name: 'A', key: 'B1' },
            { id: 'a2', name: 'B', key: 'B2' },
            { id: 'a3', name: 'C', key: 'B3' },
          ],
        }),
      ]);

      const summary = bindingAnalysisService.getPerDeviceSummary();
      expect(summary.length).toBe(2);
      expect(summary[0].totalKeyBindings).toBeGreaterThanOrEqual(summary[1].totalKeyBindings);
    });
  });

  describe('findAllDuplicatesForDevice', () => {
    it('should filter by device GUID', () => {
      mockDcsService.scanModules.mockReturnValue({
        savedGamesPath: 'C:\\test',
        modules: [{ id: 'FA-18C', name: 'FA-18C', path: 'C:\\test\\FA-18C', deviceCount: 2 }],
        errors: [],
      });

      mockDcsService.getModuleBindings.mockReturnValue([
        makeDeviceBindings({
          deviceGuid: 'target-guid',
          keyBindings: [
            { id: 'a1', name: 'Fire', key: 'BTN1' },
            { id: 'a2', name: 'Bomb', key: 'BTN1' },
          ],
        }),
        makeDeviceBindings({
          deviceGuid: 'other-guid',
          keyBindings: [
            { id: 'a3', name: 'Other', key: 'BTN1' },
            { id: 'a4', name: 'Other2', key: 'BTN1' },
          ],
        }),
      ]);

      const dupes = bindingAnalysisService.findAllDuplicatesForDevice('target-guid');
      expect(dupes.every((d) => d.modules.includes('FA-18C'))).toBe(true);
    });
  });

  describe('getDeviceModuleBreakdown', () => {
    it('should return per-module counts', () => {
      mockDcsService.scanModules.mockReturnValue({
        savedGamesPath: 'C:\\test',
        modules: [
          { id: 'FA-18C', name: 'FA-18C', path: 'C:\\test\\FA-18C', deviceCount: 1 },
          { id: 'A-10C', name: 'A-10C', path: 'C:\\test\\A-10C', deviceCount: 1 },
        ],
        errors: [],
      });

      mockDcsService.getModuleBindings.mockImplementation((moduleId: string) => {
        if (moduleId === 'FA-18C') {
          return [
            makeDeviceBindings({
              deviceGuid: 'my-guid',
              keyBindings: [
                { id: 'a1', name: 'A', key: 'B1' },
                { id: 'a2', name: 'B', key: 'B2' },
              ],
              axisBindings: [{ id: 'x1', name: 'Roll', key: 'JOY_X' }],
            }),
          ];
        }
        return [
          makeDeviceBindings({
            deviceGuid: 'my-guid',
            keyBindings: [{ id: 'a1', name: 'A', key: 'B1' }],
          }),
        ];
      });

      const breakdown = bindingAnalysisService.getDeviceModuleBreakdown('my-guid');
      expect(breakdown.length).toBe(2);
      // Should be sorted by total count descending
      expect(breakdown[0].keyCount + breakdown[0].axisCount).toBeGreaterThanOrEqual(
        breakdown[1].keyCount + breakdown[1].axisCount
      );
    });
  });
});
