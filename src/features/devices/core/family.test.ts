import { describe, expect, it } from 'vitest';
import { familyOf, simFamily } from './family';

type Case = [vendorId: string, productId: string, family: 'flight' | 'racing', what: string];

const check = (cases: Case[]): void => {
  for (const [vendor, product, family, what] of cases) {
    expect(simFamily(vendor, product), `${what} (${vendor}:${product})`).toBe(family);
  }
};

describe('which family of sims a device is for', () => {
  it('Thrustmaster: the TCA line, HOTAS and rudders are flight; wheels and pedals are racing', () => {
    check([
      ['044F', '0405', 'flight', 'TCA Sidestick Airbus'],
      ['044F', '0406', 'flight', 'TCA Sidestick Airbus, left hand'],
      ['044F', '0407', 'flight', 'TCA Quadrant Airbus'],
      ['044F', '0408', 'flight', 'TCA Quadrant add-on'],
      ['044F', '0409', 'flight', 'TCA Yoke Boeing'],
      ['044F', '040A', 'flight', 'TCA Quadrant Boeing'],
      ['044F', '0402', 'flight', 'HOTAS Warthog stick'],
      ['044F', '0400', 'flight', 'HOTAS Cougar'],
      ['044F', 'B68C', 'flight', 'T.Flight HOTAS One'],
      ['044F', 'B67C', 'flight', 'T.Flight HOTAS 4'],
      ['044F', 'B679', 'flight', 'T-Rudder'],
      ['044F', 'B68F', 'flight', 'TPR'],
      ['044F', 'B66E', 'racing', 'T300 RS'],
      ['044F', 'B696', 'racing', 'T248'],
      ['044F', 'B69C', 'racing', 'T128X'],
      ['044F', 'B689', 'racing', 'TS-PC Racer'],
      ['044F', 'B371', 'racing', 'T-LCM pedals'],
      ['044F', 'B660', 'racing', 'T500 RS gear shift'],
    ]);
    // A Thrustmaster gamepad belongs to neither.
    expect(simFamily('044F', 'D012')).toBeUndefined();
  });

  it('Logitech and Saitek: sticks are flight, wheels are racing', () => {
    check([
      ['046D', 'C215', 'flight', 'Extreme 3D Pro'],
      ['046D', 'C287', 'flight', 'G940'],
      ['06A3', '0762', 'flight', 'X52 Pro'],
      ['06A3', '0BAC', 'flight', 'Pro Flight Yoke'],
      ['06A3', '0763', 'flight', 'Pro Flight Rudder Pedals'],
      ['06A3', '0D67', 'flight', 'Pro Flight Switch Panel'],
      ['0738', '2221', 'flight', 'X-56 stick'],
      ['0738', 'A221', 'flight', 'X-56 throttle'],
      ['046D', 'C24F', 'racing', 'G29'],
      ['046D', 'C26E', 'racing', 'G923'],
      ['046D', 'C272', 'racing', 'Pro Racing Wheel'],
      ['06A3', '0805', 'racing', 'Saitek R440 wheel'],
      ['0738', '4530', 'racing', 'Mad Catz MC2 wheel'],
    ]);
    // A Logitech mouse is nothing to a sim.
    expect(simFamily('046D', 'C077')).toBeUndefined();
  });

  it('VKB, Virpil, WinWing, Honeycomb and CH are flight by vendor', () => {
    check([
      ['231D', '0200', 'flight', 'VKB Gladiator NXT Evo'],
      ['3344', '4391', 'flight', 'Virpil MT-50CM3 stick'],
      ['4098', 'BEA8', 'flight', 'WinWing Orion 2'],
      ['294B', '1900', 'flight', 'Honeycomb'],
      ['068E', '00F3', 'flight', 'CH Fighterstick'],
      ['068E', '00FF', 'flight', 'CH Flight Sim Yoke'],
    ]);
  });

  it('Turtle Beach VelocityOne: the flight gear is flight and the Race is racing', () => {
    check([
      ['10F5', '7084', 'flight', 'VelocityOne flight stick'],
      ['10F5', '7085', 'flight', 'VelocityOne Throttle'],
      ['10F5', '7077', 'racing', 'VelocityOne Race'],
    ]);
    // Its headsets share the vendor id.
    expect(simFamily('10F5', '0231')).toBeUndefined();
  });

  it('Moza: wheel bases are racing, the AB9 base and the flight panels are flight', () => {
    check([
      ['346E', '0002', 'racing', 'Moza R9'],
      ['346E', '0000', 'racing', 'Moza R16/R21'],
      ['346E', '1000', 'flight', 'Moza AB9'],
    ]);
    // Flight gear without a published product id is told by its name.
    expect(simFamily('346E', '1234', 'MOZA MTP Throttle Panel')).toBe('flight');
    expect(simFamily('346E', '1234', 'MOZA MTLP Take-off Landing Pane')).toBe('flight');
    expect(simFamily('346E', '1234', 'MOZA AB9 FFB Base')).toBe('flight');
    expect(simFamily('346E', '1234', 'MOZA SR-P Pedals')).toBe('racing');
    expect(simFamily('346E', '1234')).toBe('racing');
    // The name only counts for Moza.
    expect(simFamily('0EB7', '0020', 'Something AB9')).toBe('racing');
  });

  it('Fanatec, Simagic, Simucube, Asetek, Cammus, Heusinkveld and VRS are racing', () => {
    check([
      ['0EB7', '0007', 'racing', 'Fanatec Podium DD2'],
      ['0EB7', '0020', 'racing', 'Fanatec CSL DD / GT DD Pro'],
      ['3670', '0501', 'racing', 'Simagic EVO'],
      ['0483', '0522', 'racing', 'Simagic Alpha (older bases)'],
      ['16D0', '0D5A', 'racing', 'Simucube 1'],
      ['16D0', '0D61', 'racing', 'Simucube 2 Sport'],
      ['16D0', '0D60', 'racing', 'Simucube 2 Pro'],
      ['16D0', '0D5F', 'racing', 'Simucube 2 Ultimate'],
      ['2433', 'F300', 'racing', 'Asetek Invicta'],
      ['3416', '0302', 'racing', 'Cammus C12'],
      ['30B7', '1001', 'racing', 'Heusinkveld'],
      ['0483', 'A355', 'racing', 'VRS DirectForce Pro'],
    ]);
    // 0483 and 16D0 are shared by many unrelated products: only the known ones count.
    expect(simFamily('0483', '5740')).toBeUndefined();
    expect(simFamily('16D0', '0F3F')).toBeUndefined();
  });

  it('ignores the case of the ids, and knows nothing of unknown hardware', () => {
    expect(simFamily('044f', 'b10a')).toBe('flight');
    expect(simFamily('16d0', '0d61')).toBe('racing');
    expect(simFamily('1234', '5678')).toBeUndefined();
  });
});

describe('DEV-017: what the user said a device is used for', () => {
  const wheel = { vendorId: '0EB7', productId: '0007', name: 'FANATEC Podium Wheel Base DD2' };
  const unknown = { vendorId: '2341', productId: '8036', name: 'Arduino Leonardo' };

  it('comes before what RigReady knows of the maker; "both" is no family; nothing said is the maker', () => {
    expect(familyOf(wheel)).toBe('racing');
    expect(familyOf(wheel, {})).toBe('racing');
    expect(familyOf(wheel, { usedFor: 'flight' })).toBe('flight');
    expect(familyOf(wheel, { usedFor: 'both' })).toBeUndefined();
    expect(familyOf(unknown)).toBeUndefined();
    expect(familyOf(unknown, { usedFor: 'racing' })).toBe('racing');
    expect(familyOf(unknown, { usedFor: 'flight' })).toBe('flight');
    expect(familyOf(unknown, { usedFor: 'both' })).toBeUndefined();
  });
});
