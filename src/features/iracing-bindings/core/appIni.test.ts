import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixturesDir } from '../../../../tests/helpers';
import { controlProfileLines } from '../../../core/iracingControls';
import { globalProfileOf, withGlobalProfile, writableProfileName } from './appIni';

/** The recorded app.ini with the [ControlProfiles] section iRacing 2026.11 wrote on the rig at 12:27. */
const FIXTURE = path.join(
  fixturesDir,
  'scenarios',
  'data',
  'iracing-bindings',
  'app-profiles-car.ini'
);
const bytesOf = async (): Promise<Uint8Array> => new Uint8Array(await fs.readFile(FIXTURE));
const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');
const fromText = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'latin1'));

/** Every byte before and after the one changed run, and the run itself. */
function expectOnlyValueChanged(before: Uint8Array, after: Uint8Array, was: string, now: string) {
  const at = text(before).indexOf(`Global=${was}`) + 'Global='.length;
  expect(at).toBeGreaterThan(7);
  expect(after.length).toBe(before.length - was.length + now.length);
  expect(Buffer.from(after.subarray(0, at)).equals(Buffer.from(before.subarray(0, at)))).toBe(true);
  expect(text(after.subarray(at, at + now.length))).toBe(now);
  expect(
    Buffer.from(after.subarray(at + now.length)).equals(
      Buffer.from(before.subarray(at + was.length))
    )
  ).toBe(true);
}

describe('app.ini: the control profile for all cars', () => {
  it('sets Global= and keeps every other byte of the real file, CRLF and the car line included', async () => {
    const before = await bytesOf();
    expect(globalProfileOf(before)).toBe('Baseline');
    const changed = withGlobalProfile(before, 'Test Profile CTSV');
    if (!changed.ok) throw new Error(changed.error.message);
    expect(changed.value.before).toBe('Baseline');
    expect(changed.value.same).toBe(false);
    const after = changed.value.bytes;
    expectOnlyValueChanged(before, after, 'Baseline', 'Test Profile CTSV');
    expect(globalProfileOf(after)).toBe('Test Profile CTSV');
    // The car keeps its own line, and iRacing's line endings stay CRLF.
    expect(controlProfileLines(text(after))).toEqual([
      { key: 'cadillacctsvr', value: 'Test Profile CTSV' },
      { key: 'Global', value: 'Test Profile CTSV' },
    ]);
    expect(text(after)).toContain(
      '[ControlProfiles]\r\ncadillacctsvr=Test Profile CTSV\r\nGlobal=Test Profile CTSV\r\n'
    );
    // [AutoLoadHUD] has a "global" too: it is the HUD's, and it is left alone.
    expect(text(after)).toContain('[AutoLoadHUD]');
    expect(text(after).match(/^global=Baseline/im)?.[0]).toBe('global=Baseline');
  });

  it('putting the profile back gives the file again byte for byte', async () => {
    const before = await bytesOf();
    const there = withGlobalProfile(before, 'Test Profile CTSV');
    if (!there.ok) throw new Error(there.error.message);
    const back = withGlobalProfile(there.value.bytes, 'Baseline');
    if (!back.ok) throw new Error(back.error.message);
    expect(back.value.before).toBe('Test Profile CTSV');
    expect(Buffer.from(back.value.bytes).equals(Buffer.from(before))).toBe(true);
  });

  it('the profile it names already: the same bytes, and it says so', async () => {
    const before = await bytesOf();
    const same = withGlobalProfile(before, 'Baseline');
    expect(same.ok && same.value.same).toBe(true);
    expect(same.ok && Buffer.from(same.value.bytes).equals(Buffer.from(before))).toBe(true);
  });

  it('keeps padding, a comment after a tab and bytes that are not text', () => {
    const before = fromText(
      '\r\n[Other]\r\nGlobal=Elsewhere\r\nname=caf\xe9\xff\r\n[controlprofiles]\r\n; Global=Commented\r\n  global = Baseline    \t; the profile for all cars\r\nmx5=Mine\r\n'
    );
    const changed = withGlobalProfile(before, 'Night Race');
    if (!changed.ok) throw new Error(changed.error.message);
    expect(text(changed.value.bytes)).toBe(
      '\r\n[Other]\r\nGlobal=Elsewhere\r\nname=caf\xe9\xff\r\n[controlprofiles]\r\n; Global=Commented\r\n  global = Night Race    \t; the profile for all cars\r\nmx5=Mine\r\n'
    );
    expect(changed.value.before).toBe('Baseline');
  });

  it('refuses a file without the line, and a name it cannot write exactly', async () => {
    const none = withGlobalProfile(fromText('[ControlProfiles]\r\nmx5=Mine\r\n'), 'Baseline');
    expect(none.ok ? 'ok' : none.error.code).toBe('iracing-bindings.profile.noGlobal');
    expect(none.ok ? '' : none.error.message).toContain('Start iRacing once');
    const empty = withGlobalProfile(fromText('[Drive Screen]\r\nblackBox=2\r\n'), 'Baseline');
    expect(empty.ok ? 'ok' : empty.error.code).toBe('iracing-bindings.profile.noGlobal');
    const real = await bytesOf();
    for (const name of [
      '',
      '..',
      'a/b',
      'C:\\x',
      'two\r\nlines',
      'semi;colon',
      ' padded',
      'CafÃ©',
      'tab\there',
      'dot.',
    ]) {
      expect(writableProfileName(name), JSON.stringify(name)).toBe(false);
      const refused = withGlobalProfile(real, name);
      expect(refused.ok ? 'ok' : refused.error.code, JSON.stringify(name)).toBe(
        'iracing-bindings.profile.name'
      );
    }
    expect(writableProfileName('Test Profile CTSV')).toBe(true);
  });

  it('never changes a byte outside the value, for 200 made-up files', () => {
    let seed = 7;
    const random = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const words = ['Baseline', 'Night', 'GT3 wet', 'x', 'Mine 2'];
    for (let round = 0; round < 200; round++) {
      const eol = random(2) ? '\r\n' : '\n';
      const lines: string[] = [];
      for (let s = 0; s < 1 + random(4); s++) {
        lines.push(random(3) ? `[Section${s}]` : '[ControlProfiles]');
        for (let k = 0; k < random(5); k++) lines.push(`key${k}=${words[random(words.length)]}`);
      }
      lines.push('[ControlProfiles]', `car${random(9)}=${words[random(words.length)]}`);
      lines.push(`Global=${words[random(words.length)]}${random(2) ? '   \t; comment' : ''}`);
      if (random(2)) lines.push('[After]', 'Global=NotThis');
      const before = fromText(lines.join(eol) + (random(2) ? eol : ''));
      const wanted = words[random(words.length)]!;
      const changed = withGlobalProfile(before, wanted);
      if (!changed.ok) throw new Error(`${round}: ${changed.error.message}`);
      expect(globalProfileOf(changed.value.bytes)).toBe(wanted);
      expectOnlyValueChanged(before, changed.value.bytes, changed.value.before, wanted);
    }
  });
});
