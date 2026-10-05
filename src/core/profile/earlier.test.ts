import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { madeByVersionOne } from './earlier';

/** A setup as RigReady 1.1.0 wrote it. */
const VERSION_ONE = `
name: LMU
game: lmu
checklistItems:
  - id: wiz-device-pygame:0
    type: device
    name: FANATEC Podium Wheel Base DD2
    isRequired: true
    category: hardware
    config:
      deviceName: FANATEC Podium Wheel Base DD2
trackedConfigurations: []
id: mld4nbutw9iuzu9
createdAt: 1770517906373
lastUsed: 1770517906373
`;

describe('a setup file left by RigReady 1', () => {
  it('is recognised by what version 1 wrote, with the name it had', () => {
    expect(madeByVersionOne(yaml.load(VERSION_ONE))).toEqual({ name: 'LMU' });
    // Without a checklist it still has the other list version 1 always wrote.
    expect(madeByVersionOne({ name: 'Empty', trackedConfigurations: [] })).toEqual({
      name: 'Empty',
    });
    expect(madeByVersionOne({ checklistItems: [] })).toEqual({});
    expect(madeByVersionOne({ name: '   ', checklistItems: [] })).toEqual({});
    expect(madeByVersionOne({ name: 7, checklistItems: [] })).toEqual({});
  });

  it('is not a file of this version, however broken that one is', () => {
    // A damaged setup of this version stays a damaged setup: it is reported and can be fixed.
    expect(madeByVersionOne({ schemaVersion: 1, name: 'DCS F/A-18C' })).toBeUndefined();
    expect(madeByVersionOne({ schemaVersion: 99, checklistItems: [] })).toBeUndefined();
    expect(madeByVersionOne({ name: 'No version', checks: [] })).toBeUndefined();
    expect(madeByVersionOne({ name: 'Both', checks: [], checklistItems: [] })).toBeUndefined();
  });

  it('is not anything else that happens to be in the folder', () => {
    expect(madeByVersionOne(undefined)).toBeUndefined();
    expect(madeByVersionOne(null)).toBeUndefined();
    expect(madeByVersionOne('checklistItems')).toBeUndefined();
    expect(madeByVersionOne([{ checklistItems: [] }])).toBeUndefined();
    expect(madeByVersionOne({ name: 'Notes', items: [] })).toBeUndefined();
    expect(madeByVersionOne({ checklistItems: 'none' })).toBeUndefined();
  });
});
