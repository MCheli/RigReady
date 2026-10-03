import { describe, expect, it } from 'vitest';
import type { Profile } from '../../../core/profile/schema';
import type { DeviceInfo, InputDevice } from '../../../shared/models';
import type { HidHideInfo } from './hidhide';
import { buildOverview, requirements, type OverviewInputs } from './overview';
import { DevicesDataSchema, HistorySchema } from './store';
import { buildUsbMap, USB_ADDRESS_LIMIT } from './usbMap';

const root = { instanceId: 'USB\\ROOT_HUB30\\4&1&0&0', name: 'USB Root Hub (USB 3.0)' };
const device = (over: Partial<DeviceInfo>): DeviceInfo => ({
  instanceId: 'USB\\VID_1234&PID_0001\\5&a&0&1',
  vendorId: '1234',
  productId: '0001',
  name: 'Box',
  isHid: true,
  isGameController: true,
  isHub: false,
  hubChain: [root],
  ...over,
});
const controller = (over: Partial<InputDevice>): InputDevice => ({
  index: 0,
  name: 'Box',
  guid: 'G0',
  productGuid: '',
  vendorId: '1234',
  productId: '0001',
  numAxes: 2,
  numButtons: 10,
  numHats: 0,
  axisNames: ['X', 'Y'],
  ...over,
});
const profile = (name: string, checks: Profile['checks'], exe?: string): Profile => ({
  schemaVersion: 1,
  id: name.toLowerCase().replace(/\W+/g, '-'),
  name,
  createdAt: '',
  updatedAt: '',
  checks,
  extensions: {},
  ...(exe ? { launch: { exe, args: [] } } : {}),
});
const inputs = (over: Partial<OverviewInputs>): OverviewInputs => ({
  devices: [],
  input: [],
  data: DevicesDataSchema.parse({}),
  history: HistorySchema.parse({}),
  profiles: [],
  hidHide: { installed: false },
  now: new Date(2026, 9, 3, 12, 0),
  ...over,
});

describe('devices overview', () => {
  it('pairs controllers with their USB device, and admits it when identical twins cannot be paired', () => {
    const a = device({ instanceId: 'USB\\VID_1234&PID_0001\\5&a&0&1' });
    const b = device({ instanceId: 'USB\\VID_1234&PID_0001\\5&a&0&2' });
    const overview = buildOverview(
      inputs({
        devices: [a, b],
        input: [controller({ guid: 'G1' }), controller({ index: 1, guid: 'G2' })],
      })
    );
    expect(overview.devices).toHaveLength(2);
    for (const d of overview.devices) {
      expect(d).toMatchObject({ twins: 2, controllersShared: true, identifiedBy: 'port' });
      expect(d.controllers).toHaveLength(2);
    }
    expect(overview.hidHide).toEqual({ state: 'notInstalled' });
  });

  it('lists a missing device once with every setup that needs it, and a different unit when one is here', () => {
    const here = device({ serial: 'S1', instanceId: 'USB\\VID_1234&PID_0001\\S1' });
    const need = { vendorId: '1234', productId: '0001', serial: 'S2' };
    const overview = buildOverview(
      inputs({
        devices: [here],
        profiles: [
          profile('A', [
            { id: '1', type: 'device.connected', title: 'Left box', required: true, params: need },
          ]),
          profile('B', [
            {
              id: '1',
              type: 'device.connected',
              title: 'Box two',
              required: true,
              params: { ...need, serial: 'S2' },
            },
            {
              id: '2',
              type: 'device.connected',
              title: 'Broken',
              required: true,
              params: { name: 'x' },
            },
            { id: '3', type: 'process.running', title: 'App', required: true, params: {} },
          ]),
        ],
        data: DevicesDataSchema.parse({
          names: [{ vendorId: '1234', productId: '0001', serial: 'S2', name: 'Right box' }],
        }),
      })
    );
    expect(overview.missing).toEqual([
      {
        title: 'Right box',
        identity: need,
        profiles: ['A', 'B'],
        otherUnit: true,
      },
    ]);
    expect(requirements([profile('C', [])])).toEqual([]);
  });

  it('summarises HidHide for RigReady and the games the setups launch', () => {
    const hid: HidHideInfo = {
      installed: true,
      cli: 'x',
      cloak: true,
      inverse: false,
      hidden: [],
      apps: ['C:\\DCS\\bin\\DCS.exe'],
      gaming: [],
    };
    const profiles = [
      profile('Hornet', [], 'C:\\DCS\\bin\\DCS.exe'),
      profile('Huey', [], 'C:\\DCS\\bin\\dcs.exe'),
      profile('Racing', [], 'C:\\iRacing\\iRacingUI.exe'),
      profile('No game', []),
    ];
    const overview = buildOverview(
      inputs({ hidHide: hid, profiles, rigReadyExe: 'C:\\RigReady\\RigReady.exe' })
    );
    expect(overview.hidHide).toEqual({
      state: 'ok',
      cloak: true,
      inverse: false,
      hiddenCount: 0,
      apps: ['C:\\DCS\\bin\\DCS.exe'],
      programs: [
        { label: 'RigReady', exe: 'C:\\RigReady\\RigReady.exe', onList: false, seesHidden: false },
        { label: 'Hornet', exe: 'C:\\DCS\\bin\\DCS.exe', onList: true, seesHidden: true },
        { label: 'Racing', exe: 'C:\\iRacing\\iRacingUI.exe', onList: false, seesHidden: false },
      ],
    });
    expect(buildOverview(inputs({ hidHide: { ...hid, error: 'denied' } })).hidHide).toEqual({
      state: 'error',
      message: 'denied',
    });
    expect(buildOverview(inputs({ inputError: 'No reader' })).inputError).toBe('No reader');
  });
});

describe('USB map limits', () => {
  it('warns about devices four or five hubs deep', () => {
    const chain = (n: number) => [
      ...Array.from({ length: n }, (_, i) => ({
        instanceId: `USB\\HUB\\6&h${n}${i}&0&1`,
        name: 'Hub',
      })),
      root,
    ];
    const devices = [
      device({ instanceId: 'USB\\VID_1234&PID_0001\\7&x&0&3', hubChain: chain(5) }),
      device({
        instanceId: 'USB\\VID_1234&PID_0002\\7&y&0&2',
        productId: '0002',
        hubChain: chain(4),
      }),
    ];
    const map = buildUsbMap(devices, []);
    const deep = map.nodes.filter((n) => n.warning);
    expect(deep.map((n) => `${n.depth}:${n.warning}`).sort()).toEqual(['4:deep', '5:tooDeep']);
    expect(map.controllers[0]!.deepest).toBe(5);
    expect(map.activeProfile).toBeUndefined();
  });

  it('flags a controller near or over its 127 addresses and lists what is not needed', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        device({
          instanceId: `USB\\VID_1234&PID_${String(i).padStart(4, '0')}\\5&a&0&${i}`,
          productId: String(i).padStart(4, '0').slice(-4),
        })
      );
    expect(buildUsbMap(many(100), []).controllers[0]!.status).toBe('near');
    const over = buildUsbMap(many(USB_ADDRESS_LIMIT + 1), [], {
      required: (d) => d.productId === '0001',
      activeProfile: 'Hornet',
    });
    expect(over.controllers[0]).toMatchObject({ status: 'over', addresses: 128 });
    expect(over.controllers[0]!.spare).toHaveLength(127);
    expect(over.controllers[0]!.spare.some((s) => s.key.includes('PID_0001'))).toBe(false);
    expect(over.activeProfile).toBe('Hornet');
  });
});
