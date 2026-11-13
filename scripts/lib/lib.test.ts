import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../../tests/helpers';
import { validateLedger } from './ledger';
import {
  guidRegistryBytes,
  identityReplacements,
  isPlaceholderSerial,
  madeUpGuid,
  madeUpSerial,
  replaceIdentity,
  replaceIdentityBytes,
  sanitizeDeep,
  sanitizeUserPaths,
} from './sanitize';

describe('sanitizeUserPaths', () => {
  it('replaces only the user name segment of paths', () => {
    expect(sanitizeUserPaths('C:\\Users\\Owner\\Saved Games\\DCS', 'Owner')).toBe(
      'C:\\Users\\User\\Saved Games\\DCS'
    );
    expect(sanitizeUserPaths('"C:\\\\Users\\\\owner\\\\x"', 'Owner')).toBe(
      '"C:\\\\Users\\\\User\\\\x"'
    );
    expect(sanitizeUserPaths('C:/Users/Owner/x and C:/Users/Owner', 'Owner')).toBe(
      'C:/Users/User/x and C:/Users/User'
    );
    expect(sanitizeUserPaths('The Owner of C:\\Users\\Ownership\\x', 'Owner')).toBe(
      'The Owner of C:\\Users\\Ownership\\x'
    );
    expect(sanitizeUserPaths('C:\\Users\\A.B+C\\x', 'A.B+C')).toBe('C:\\Users\\User\\x');
    expect(sanitizeUserPaths('unchanged', '')).toBe('unchanged');
  });

  it('walks nested values', () => {
    expect(
      sanitizeDeep({ a: ['C:\\Users\\Owner\\x', 5, null], b: { c: 'C:\\Users\\Owner' } }, 'Owner')
    ).toEqual({
      a: ['C:\\Users\\User\\x', 5, null],
      b: { c: 'C:\\Users\\User' },
    });
  });
});

/** Each character as d (digit), U, l (letters) or itself: the shape of a value. */
const shape = (value: string): string =>
  value.replace(/[0-9]/g, 'd').replace(/[A-Z]/g, 'U').replace(/[a-z]/g, 'l');

describe('device identity: stable made-up serials and GUIDs', () => {
  // Every value here is invented for the test.
  it('a serial becomes another of the same shape, the same every time', () => {
    for (const serial of ['K7Q2XW93P1LM', '3fa90c17b2e4', 'AB12-cd34', 'QZ20231115083000']) {
      const made = madeUpSerial(serial);
      expect(made).not.toBe(serial);
      expect(shape(made)).toBe(shape(serial));
      expect(madeUpSerial(serial)).toBe(made);
    }
    // A hex serial stays hex; another one may use any letter.
    expect(madeUpSerial('3FA90C17B2E4D6A8')).toMatch(/^[0-9A-F]{16}$/);
    expect(madeUpSerial('3FA90C17B2E4D6A8')).not.toBe(madeUpSerial('3FA90C17B2E4D6A9'));
  });

  it('serials that name no unit are not counted as serials', () => {
    for (const placeholder of ['1', 'FF', '000', '000000000000', 'AAAAAA']) {
      expect(isPlaceholderSerial(placeholder), placeholder).toBe(true);
    }
    expect(isPlaceholderSerial('A1B2')).toBe(false);
  });

  it('a DirectInput GUID gets a made-up time and keeps its version, slot counter and node', () => {
    const slot7 = '1A2B3C40-5D6E-11F0-8007-444553540000';
    const slot8 = '1A2B3C40-5D6E-11F0-8008-444553540000';
    const made = madeUpGuid(slot7);
    expect(made).not.toBe(slot7);
    expect(shape(made)).toBe(shape(slot7));
    expect(made).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-1[0-9A-F]{3}-8007-444553540000$/);
    // Seen by Windows at the same moment, so still the same moment after.
    expect(madeUpGuid(slot8).slice(0, 18)).toBe(made.slice(0, 18));
    expect(madeUpGuid(slot8).slice(19)).toBe('8008-444553540000');
    expect(madeUpGuid(slot7)).toBe(made);
  });

  it('any other GUID changes everywhere but its version and variant digits', () => {
    const endpoint = '0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d';
    const made = madeUpGuid(endpoint);
    expect(shape(made)).toBe(shape(endpoint));
    expect(made[14]).toBe('4');
    expect(made[19]).toBe('9');
    expect(made.slice(24)).not.toBe(endpoint.slice(24));
    expect(() => madeUpGuid('not-a-guid')).toThrow();
  });

  it('finds every serial and instance GUID of a recording, placeholders aside', () => {
    const map = identityReplacements({
      devices: [{ serial: 'K7Q2XW93P1LM' }, { serial: 'FF' }, {}],
      displays: [{ serial: '1' }, { serial: 'MON1234567', usbSerial: 'QZ20231115083000' }],
      input: [{ guid: '1A2B3C40-5D6E-11F0-8007-444553540000' }],
      audio: { devices: [{ id: '{0.0.0.00000000}.{0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d}' }] },
      registry: {
        'HKCU\\X\\DirectInput\\VID_1234&PID_5678\\Calibration\\0': {
          GUID: {
            type: 'binary',
            value: guidRegistryBytes('9F8E7D60-5C4B-11EE-8001-444553540000'),
          },
          'Joystick Id': { type: 'binary', value: '01000000' },
        },
        'HKCU\\X\\DirectInput\\VID_1234&PID_5678\\Calibration\\0\\Type': {},
      },
    });
    expect([...map.keys()].sort()).toEqual(
      [
        '0A1B2C3D-4E5F-4A6B-9C7D-8E9F0A1B2C3D',
        '1A2B3C40-5D6E-11F0-8007-444553540000',
        '9F8E7D60-5C4B-11EE-8001-444553540000',
        'K7Q2XW93P1LM',
        'MON1234567',
        'QZ20231115083000',
      ].sort()
    );
  });

  it('replaces them in every spelling, keeping each one’s letter case, and only whole values', () => {
    const guid = '1A2B3C40-5D6E-11F0-8007-444553540000';
    const map = new Map([
      [guid, madeUpGuid(guid)],
      ['K7Q2XW93P1LM', madeUpSerial('K7Q2XW93P1LM')],
    ]);
    const made = map.get(guid)!;
    const dcs = (g: string): string =>
      g.replace(/^(.{14})(.{4})/, (_, a, b) => a + b.toLowerCase());
    const text = [
      `"guid": "${guid}",`,
      `Joystick {${dcs(guid)}}.diff.lua`,
      `"value": "${guidRegistryBytes(guid).toLowerCase()}"`,
      `\\\\?\\usb#vid_1234&pid_5678#k7q2xw93p1lm#{a5dcbf10-6530-11d2-901f-00c04fb951ed}`,
      `USB\\VID_1234&PID_5678\\K7Q2XW93P1LM and XK7Q2XW93P1LM and K7Q2XW93P1LM0`,
    ].join('\n');
    const out = replaceIdentity(text, map).split('\n');
    expect(out[0]).toBe(`"guid": "${made}",`);
    expect(out[1]).toBe(`Joystick {${dcs(made)}}.diff.lua`);
    expect(out[2]).toBe(`"value": "${guidRegistryBytes(made).toLowerCase()}"`);
    expect(out[3]).toBe(
      `\\\\?\\usb#vid_1234&pid_5678#${map.get('K7Q2XW93P1LM')!.toLowerCase()}#{a5dcbf10-6530-11d2-901f-00c04fb951ed}`
    );
    expect(out[4]).toBe(
      `USB\\VID_1234&PID_5678\\${map.get('K7Q2XW93P1LM')} and XK7Q2XW93P1LM and K7Q2XW93P1LM0`
    );
    expect(replaceIdentity(text, new Map())).toBe(text);
  });

  it('replaces a GUID kept as raw bytes, in Windows’ order, and leaves the other bytes alone', () => {
    const guid = '1A2B3C40-5D6E-11F0-8007-444553540000';
    const made = madeUpGuid(guid);
    const raw = (g: string): Buffer => Buffer.from(guidRegistryBytes(g), 'hex');
    const data = Buffer.concat([Buffer.from([0, 1, 2]), raw(guid), Buffer.from('x'), raw(guid)]);
    const out = replaceIdentityBytes(data, new Map([[guid, made]]));
    expect(out).toEqual(
      Buffer.concat([Buffer.from([0, 1, 2]), raw(made), Buffer.from('x'), raw(made)])
    );
    // The input is not changed, and data without the GUID comes back as it was.
    expect(data.indexOf(raw(guid))).toBe(3);
    const other = Buffer.from([9, 8, 7]);
    expect(replaceIdentityBytes(other, new Map([[guid, made]]))).toBe(other);
  });
});

describe('validateLedger', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let file: string;
  beforeEach(async () => {
    ({ dir, cleanup } = await tempDir());
    file = path.join(dir, 'ledger.yaml');
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(dir, 'artifacts', 'screens', 'fly'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'tests', 'a.test.ts'),
      "it('opens on the last profile', () => {})"
    );
    await fs.writeFile(path.join(dir, 'artifacts', 'screens', 'fly', 'ready.png'), '');
  });
  afterEach(() => cleanup());

  const entry = (extra: string): string => `
requirements:
  - id: FLY-001
    title: Open on the last-used profile
    job: fly
    area: fly
    done_means: ["shows the last profile"]
${extra}`;

  it('tolerates an absent file', () => {
    expect(validateLedger(file, dir)).toEqual({
      found: false,
      total: 0,
      counts: { todo: 0, in_progress: 0, done: 0 },
      problems: [],
    });
  });

  it('accepts todo entries without evidence and extra fields', async () => {
    await fs.writeFile(file, entry('    status: todo\n    evidence: []'));
    expect(validateLedger(file, dir)).toMatchObject({
      found: true,
      total: 1,
      counts: { todo: 1 },
      problems: [],
    });
  });

  it('accepts done with an existing test and screenshot, in every reference style', async () => {
    await fs.writeFile(
      file,
      entry(`    status: done
    evidence:
      - tests/a.test.ts#opens on the last profile
      - "tests/a.test.ts > opens on the last profile"
      - tests/a.test.ts::opens on the last profile
      - tests/a.test.ts
      - artifacts/screens/fly/ready.png
      - { test: "tests/a.test.ts#opens on the last profile" }
      - { screenshot: artifacts/screens/fly/ready.png }
      - { path: artifacts/screens/fly/ready.png }`)
    );
    expect(validateLedger(file, dir)).toMatchObject({ counts: { done: 1 }, problems: [] });
  });

  it('fails done without evidence, with missing evidence, or with screenshots only', async () => {
    await fs.writeFile(file, entry('    status: done'));
    expect(validateLedger(file, dir).problems).toEqual([
      'FLY-001: status is done but there is no evidence',
    ]);
    await fs.writeFile(
      file,
      entry(`    status: done
    evidence:
      - tests/missing.test.ts#x
      - tests/a.test.ts#a test that was renamed
      - artifacts/screens/fly/nope.png
      - ../outside.png`)
    );
    expect(validateLedger(file, dir).problems).toEqual([
      'FLY-001: evidence does not exist: tests/missing.test.ts',
      'FLY-001: test "a test that was renamed" not found in tests/a.test.ts',
      'FLY-001: evidence does not exist: artifacts/screens/fly/nope.png',
      'FLY-001: evidence points outside the repository: ../outside.png',
    ]);
    await fs.writeFile(
      file,
      entry('    status: done\n    evidence: [artifacts/screens/fly/ready.png]')
    );
    expect(validateLedger(file, dir).problems).toEqual([
      'FLY-001: done needs at least one automated test as evidence',
    ]);
  });

  it('reports schema problems, duplicates and broken files', async () => {
    await fs.writeFile(
      file,
      `- { id: FLY-001, title: A, job: fly, done_means: [x], status: todo }
- { id: FLY-001, title: B, job: fly, done_means: [x], status: in_progress }
- { id: bad id, title: C, job: flying, done_means: [], status: finished }
- just a string`
    );
    const report = validateLedger(file, dir);
    expect(report.total).toBe(2);
    expect(report.problems).toContain('FLY-001: duplicate id');
    expect(report.problems.some((p) => p.startsWith('bad id: job:'))).toBe(true);
    expect(report.problems.some((p) => p.startsWith('bad id: status:'))).toBe(true);
    expect(report.problems.some((p) => p.startsWith('bad id: done_means:'))).toBe(true);
    expect(report.problems.some((p) => p.startsWith('entry 4:'))).toBe(true);

    await fs.writeFile(file, 'requirements: [unclosed');
    expect(validateLedger(file, dir).problems[0]).toMatch(/not valid YAML/);
    await fs.writeFile(file, 'something: else');
    expect(validateLedger(file, dir).problems).toEqual([
      'the file must contain a "requirements" list',
    ]);
  });
});
