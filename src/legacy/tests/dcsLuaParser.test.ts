import {
  parseDCSBindingFile,
  extractAxisBindings,
  extractKeyBindings,
  extractDeviceGuidFromPath,
  extractDeviceNameFromPath,
} from '../../src/main/services/dcsLuaParser';
import type { DCSAxisDiff, DCSKeyDiff } from '../../src/shared/dcsTypes';

describe('dcsLuaParser', () => {
  describe('parseDCSBindingFile', () => {
    it('parses a valid DCS .diff.lua binding file with keyDiffs and axisDiffs', () => {
      const luaContent = `
local diff = {
  ["axisDiffs"] = {
    ["a3001c0058"] = {
      ["added"] = {
        [1] = { ["key"] = "JOY_X" },
      },
      ["name"] = "Roll",
    },
  },
  ["keyDiffs"] = {
    ["d3001pnilu3001"] = {
      ["added"] = {
        [1] = { ["key"] = "JOY_BTN5" },
      },
      ["name"] = "Weapon Release",
    },
  },
}
return diff
`;

      const result = parseDCSBindingFile(luaContent);

      expect(result.axisDiffs).toBeDefined();
      expect(result.keyDiffs).toBeDefined();
      expect(result.raw).toBe(luaContent);

      // Verify axisDiffs content
      const axisEntry = result.axisDiffs['a3001c0058'];
      expect(axisEntry).toBeDefined();
      expect(axisEntry.name).toBe('Roll');
      expect(axisEntry.added).toBeDefined();

      // The parser converts [1] indexed tables to arrays
      const addedAxis = axisEntry.added as unknown;
      // Array form: the parser stores [1] = {...} as array index 0
      if (Array.isArray(addedAxis)) {
        expect((addedAxis[0] as { key: string }).key).toBe('JOY_X');
      } else {
        // Object form with string key "1"
        expect((addedAxis as Record<string, { key: string }>)['1'].key).toBe('JOY_X');
      }

      // Verify keyDiffs content
      const keyEntry = result.keyDiffs['d3001pnilu3001'];
      expect(keyEntry).toBeDefined();
      expect(keyEntry.name).toBe('Weapon Release');

      const addedKey = keyEntry.added as unknown;
      if (Array.isArray(addedKey)) {
        expect((addedKey[0] as { key: string }).key).toBe('JOY_BTN5');
      } else {
        expect((addedKey as Record<string, { key: string }>)['1'].key).toBe('JOY_BTN5');
      }
    });

    it('returns empty structures for empty content', () => {
      const result = parseDCSBindingFile('');

      expect(result.axisDiffs).toEqual({});
      expect(result.keyDiffs).toEqual({});
      expect(result.raw).toBe('');
    });
  });

  describe('extractAxisBindings', () => {
    it('extracts added axis bindings', () => {
      const axisDiffs: DCSAxisDiff = {
        a3001c0058: {
          added: {
            '1': { key: 'JOY_X' },
          },
          name: 'Roll',
        },
        a3001c0059: {
          added: {
            '1': { key: 'JOY_Y', filter: { curvature: [0, 15], deadzone: 0.02 } },
          },
          name: 'Pitch',
        },
      };

      const bindings = extractAxisBindings(axisDiffs);

      expect(bindings).toHaveLength(2);

      const rollBinding = bindings.find((b) => b.name === 'Roll');
      expect(rollBinding).toBeDefined();
      expect(rollBinding!.id).toBe('a3001c0058');
      expect(rollBinding!.key).toBe('JOY_X');
      expect(rollBinding!.isRemoved).toBe(false);

      const pitchBinding = bindings.find((b) => b.name === 'Pitch');
      expect(pitchBinding).toBeDefined();
      expect(pitchBinding!.key).toBe('JOY_Y');
      expect(pitchBinding!.filter).toEqual({ curvature: [0, 15], deadzone: 0.02 });
      expect(pitchBinding!.isRemoved).toBe(false);
    });

    it('extracts removed axis bindings', () => {
      const axisDiffs: DCSAxisDiff = {
        a3001c0058: {
          removed: {
            '1': { key: 'JOY_RX' },
          },
          name: 'Rudder',
        },
      };

      const bindings = extractAxisBindings(axisDiffs);

      expect(bindings).toHaveLength(1);
      expect(bindings[0].id).toBe('a3001c0058');
      expect(bindings[0].name).toBe('Rudder');
      expect(bindings[0].key).toBe('JOY_RX');
      expect(bindings[0].isRemoved).toBe(true);
      expect(bindings[0].filter).toBeUndefined();
    });
  });

  describe('extractKeyBindings', () => {
    it('extracts added key bindings with reformers', () => {
      const keyDiffs: DCSKeyDiff = {
        d3001pnilu3001: {
          added: {
            '1': {
              key: 'JOY_BTN5',
              reformers: ['JOY_BTN_POV1_U'],
            },
          },
          name: 'Weapon Release',
        },
        d3002pnilu3002: {
          added: {
            '1': { key: 'JOY_BTN1' },
          },
          name: 'Trigger',
        },
      };

      const bindings = extractKeyBindings(keyDiffs);

      expect(bindings).toHaveLength(2);

      const weaponBinding = bindings.find((b) => b.name === 'Weapon Release');
      expect(weaponBinding).toBeDefined();
      expect(weaponBinding!.id).toBe('d3001pnilu3001');
      expect(weaponBinding!.key).toBe('JOY_BTN5');
      expect(weaponBinding!.reformers).toEqual(['JOY_BTN_POV1_U']);
      expect(weaponBinding!.isRemoved).toBe(false);

      const triggerBinding = bindings.find((b) => b.name === 'Trigger');
      expect(triggerBinding).toBeDefined();
      expect(triggerBinding!.key).toBe('JOY_BTN1');
      expect(triggerBinding!.reformers).toBeUndefined();
      expect(triggerBinding!.isRemoved).toBe(false);
    });

    it('returns empty array for empty keyDiffs', () => {
      const keyDiffs: DCSKeyDiff = {};
      const bindings = extractKeyBindings(keyDiffs);
      expect(bindings).toEqual([]);
    });
  });

  describe('extractDeviceGuidFromPath', () => {
    it('extracts GUID in braces from path', () => {
      const path =
        'C:\\Users\\Owner\\Saved Games\\DCS\\Config\\Input\\FA-18C_hornet\\joystick\\{B351044F-D287-11ec-8004-444553540000}.diff.lua';
      const guid = extractDeviceGuidFromPath(path);
      expect(guid).toBe('{B351044F-D287-11ec-8004-444553540000}');
    });

    it('returns empty string when no GUID is found', () => {
      const guid = extractDeviceGuidFromPath('C:\\some\\random\\path.lua');
      expect(guid).toBe('');
    });
  });

  describe('extractDeviceNameFromPath', () => {
    it('extracts name from path (content inside braces)', () => {
      const path =
        'C:\\Users\\Owner\\Saved Games\\DCS\\Config\\Input\\FA-18C_hornet\\joystick\\{VPC Stick MT-50CM2}.diff.lua';
      const name = extractDeviceNameFromPath(path);
      expect(name).toBe('VPC Stick MT-50CM2');
    });

    it('returns Unknown Device when path does not match', () => {
      const name = extractDeviceNameFromPath('/some/other/file.txt');
      expect(name).toBe('Unknown Device');
    });
  });
});
