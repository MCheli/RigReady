import { describe, expect, it } from 'vitest';
import { DEVICE_NAME_LENGTH, shortDeviceName } from './deviceName';

describe('a controller’s name, short enough for one line of the overlay', () => {
  it('a short name is left as it is', () => {
    expect(shortDeviceName('T-Pendular-Rudder')).toBe('T-Pendular-Rudder');
    expect(shortDeviceName('  VKB  Gladiator  ')).toBe('VKB Gladiator');
  });

  it('keeps what the controller is built on and drops what is mounted on it', () => {
    expect(shortDeviceName('WinWing THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R')).toBe(
      'WinWing THROTTLE BASE1'
    );
    expect(shortDeviceName('WINWING UFC1 + HUD1')).toBe('WINWING UFC1');
  });

  it('a name that is still too long is cut at the end of a word, and shows that it was cut', () => {
    const short = shortDeviceName('WINWING Orion Joystick Base 2 + JGRIP-F16');
    expect(short).toBe('WINWING Orion Joystick…');
    expect(short.length).toBeLessThanOrEqual(DEVICE_NAME_LENGTH);
    // Cut right after a word: that word stays.
    expect(shortDeviceName('FANATEC Podium Wheel Base DD2')).toBe('FANATEC Podium Wheel Base…');
  });

  it('one long word is cut where the room ends', () => {
    const short = shortDeviceName('Thrustmaster_Warthog_Combined_Device');
    expect(short).toBe('Thrustmaster_Warthog_Comb…');
    expect(short.length).toBe(DEVICE_NAME_LENGTH);
  });

  it('a name that starts with a plus sign or is empty does not become nothing', () => {
    expect(shortDeviceName(' + Odd')).toBe('+ Odd');
    expect(shortDeviceName('')).toBe('');
  });
});
