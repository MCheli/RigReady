import { describe, expect, it } from 'vitest';
import type { BoundAircraft } from '../../../core/bindings';
import { aircraftNamedBy, pickAircraft } from './aircraft';

const plane = (id: string, name: string, hasUserBindings = false): BoundAircraft => ({
  id,
  name,
  hasUserBindings,
});

const HORNET = plane('FA-18C_hornet', 'F/A-18C', true);
const VIPER = plane('F-16C_50', 'F-16C', true);
const HOG = plane('A-10C', 'A-10C');
const HOG2 = plane('A-10C_2', 'A-10C II');
const MIRAGE = plane('M-2000C', 'M-2000C');
const ALL = [VIPER, HORNET, HOG, HOG2, MIRAGE];

const picked = (input: Parameters<typeof pickAircraft>[0]): string | undefined => {
  const pick = pickAircraft(input);
  return pick ? `${pick.aircraft.id} (${pick.how})` : undefined;
};

describe('which aircraft or car the labels are for', () => {
  it('none when the game has bindings for none', () => {
    expect(pickAircraft({ aircraft: [] })).toBeUndefined();
  });

  it('the one the user chose for this setup comes before everything else', () => {
    expect(
      picked({
        aircraft: ALL,
        chosen: 'A-10C_2',
        named: ['FA-18C_hornet'],
        setupName: 'DCS F-16C',
      })
    ).toBe('A-10C_2 (chosen)');
  });

  it('a choice the game has no bindings for any more is passed over', () => {
    expect(picked({ aircraft: ALL, chosen: 'Su-27', named: ['FA-18C_hornet'] })).toBe(
      'FA-18C_hornet (setup)'
    );
  });

  it('then one a check of the setup names, the first that the game knows', () => {
    expect(picked({ aircraft: ALL, named: ['Su-27', 'M-2000C'], setupName: 'DCS F-16C' })).toBe(
      'M-2000C (setup)'
    );
    // However the id is written.
    expect(picked({ aircraft: ALL, named: ['fa-18c_HORNET'] })).toBe('FA-18C_hornet (setup)');
  });

  it('the only one there is needs no choosing, and neither does the one set a game uses for everything', () => {
    expect(picked({ aircraft: [HOG], setupName: 'Friday night' })).toBe('A-10C (only)');
    const general: BoundAircraft = {
      id: 'all',
      name: 'All cars',
      hasUserBindings: true,
      general: true,
    };
    expect(picked({ aircraft: [general, HOG], setupName: 'iRacing GT3' })).toBe('all (only)');
  });

  it('then the one the setup is called after', () => {
    expect(picked({ aircraft: ALL, setupName: 'DCS F/A-18C' })).toBe('FA-18C_hornet (setup)');
    expect(picked({ aircraft: ALL, setupName: 'Hornet, carrier nights' })).toBe(
      'FA-18C_hornet (setup)'
    );
    expect(picked({ aircraft: ALL, setupName: 'dcs f16c viper' })).toBe('F-16C_50 (setup)');
    expect(picked({ aircraft: ALL, setupName: 'Mirage 2000C' })).toBe('M-2000C (setup)');
  });

  it('of two that fit, the one more of the name speaks for', () => {
    expect(picked({ aircraft: ALL, setupName: 'DCS A-10C II' })).toBe('A-10C_2 (setup)');
    expect(picked({ aircraft: ALL, setupName: 'DCS A-10C' })).toBe('A-10C (setup)');
  });

  it('otherwise the first with bindings of the user’s own, and it says that this is a guess', () => {
    expect(picked({ aircraft: [HOG, MIRAGE, HORNET, VIPER], setupName: 'Friday night' })).toBe(
      'FA-18C_hornet (guess)'
    );
    expect(picked({ aircraft: [HOG, MIRAGE] })).toBe('A-10C (guess)');
    // A word too short to mean anything is not a name.
    expect(picked({ aircraft: [plane('F5', 'F5'), HOG], setupName: 'My F5 setup' })).toBe(
      'F5 (guess)'
    );
  });
});

describe('the aircraft a setup’s checks are about', () => {
  it('every check that names one, in order, each once', () => {
    expect(
      aircraftNamedBy([
        { params: { vendorId: '4098', productId: 'BEA8' } },
        { params: { aircraft: 'FA-18C_hornet', aircraftName: 'F/A-18C' } },
        { params: { game: 'dcs', aircraft: 'F-16C_50' } },
        { params: { aircraft: 'FA-18C_hornet' } },
      ])
    ).toEqual(['FA-18C_hornet', 'F-16C_50']);
  });

  it('nothing from a check that names none, or names it as something that is not a word', () => {
    expect(
      aircraftNamedBy([
        {},
        { params: {} },
        { params: { aircraft: 7 } },
        { params: { aircraft: '' } },
      ])
    ).toEqual([]);
  });
});
