import { afterEach, describe, expect, it } from 'vitest';
import { err } from '../../../core/result';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { Welcome } from '../contract';

let app: WiredApp;
afterEach(() => app?.cleanup());

describe('first run', () => {
  it('says which games, game controllers and monitors were found on this PC', async () => {
    app = await wiredApp('flying-fresh');
    const found = await app.invoke<Welcome>('fly:welcome');
    expect(found.games.map((g) => g.name)).toEqual([
      'Assetto Corsa',
      'Assetto Corsa EVO',
      'Assetto Corsa Rally',
      'BeamNG.drive',
      'DCS World',
      'iRacing',
      'Le Mans Ultimate',
      'Microsoft Flight Simulator 2024',
    ]);
    expect(found.games.find((g) => g.id === 'dcs')).toMatchObject({ kind: 'flight' });
    expect(found.controllers).toHaveLength(12);
    expect(found.controllers).toContain('T-Pendular-Rudder');
    expect(found.monitors).toEqual({ connected: 5, on: 4 });
  });

  it('on a PC with no sim it finds no game and still says what is there; a provider that fails leaves its part out', async () => {
    app = await wiredApp('generic-fresh');
    expect(await app.invoke<Welcome>('fly:welcome')).toEqual({
      games: [],
      controllers: ['Logitech Extreme 3D'],
      monitors: { connected: 1, on: 1 },
    });
    app.ports.devices.list = async () => err('device.enumerate', 'nope');
    app.ports.displays.read = async () => err('display.read', 'nope');
    expect(await app.invoke<Welcome>('fly:welcome')).toEqual({
      games: [],
      controllers: [],
      monitors: { connected: 0, on: 0 },
    });
  });
});
