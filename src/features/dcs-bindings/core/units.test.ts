import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LuaTable, parseLuaData, writeLuaDocument } from '../../../core/lua/data';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import { BINDING_FILES, HORNET, bindingsFor } from '../../../../tests/dcsBindings';
import { discoverAircraft, inputProfilesOf, profileFolderName } from './aircraft';
import { detectInputs } from './capture';
import { DefaultsLoader, commandHash, fieldText, unresolvedNames } from './defaults';
import {
  DEFAULT_FILTER,
  comboFromLua,
  dropCombo,
  filterFromLua,
  filterToLua,
  hasCombo,
  isEmptyDiff,
  newDiffDocument,
  putCombo,
  readDiff,
  sameFilter,
} from './diff';
import { applyDiff } from './effective';
import { EngineIds, parseHash } from './engineIds';
import {
  comboLabel,
  describeInput,
  deviceHasInput,
  deviceInputs,
  diffFileNameFor,
  inputSortKey,
} from './names';
import { lineDiff } from './textDiff';

let rig: TestRig | undefined;
afterEach(async () => {
  await rig?.cleanup();
  rig = undefined;
});

describe('input names', () => {
  it('describes DCS event names in plain words', () => {
    expect(describeInput('JOY_BTN5')).toEqual({ kind: 'button', number: 5, label: 'Button 5' });
    expect(describeInput('JOY_BTN12_OFF').label).toBe('Button 12 (on release)');
    expect(describeInput('JOY_BTN_POV1_UL')).toEqual({
      kind: 'hat',
      number: 1,
      label: 'Hat 1 up-left',
    });
    expect(describeInput('JOY_RZ')).toEqual({ kind: 'axis', axis: 'RZ', label: 'RZ axis' });
    expect(describeInput('JOY_SLIDER2').label).toBe('Slider 2');
    expect(describeInput('JOY_V1').label).toBe('V1 axis');
    expect(describeInput('LShift')).toEqual({ kind: 'key', label: 'LShift' });
    expect(comboLabel({ key: 'JOY_BTN34', reformers: ['LCtrl', 'LWin'] })).toBe(
      'LCtrl + LWin + Button 34'
    );
    expect(comboLabel({ key: 'Space' })).toBe('Space');
    const keys = ['JOY_BTN10', 'JOY_BTN2', 'JOY_BTN_POV1_U', 'JOY_X', 'A'];
    expect([...keys].sort((a, b) => inputSortKey(a).localeCompare(inputSortKey(b)))).toEqual([
      'JOY_X',
      'JOY_BTN2',
      'JOY_BTN10',
      'JOY_BTN_POV1_U',
      'A',
    ]);
    expect(diffFileNameFor('WINWING ICP', '806DB7F0-B756-11F0-8020-444553540000')).toBe(
      'WINWING ICP {806DB7F0-B756-11f0-8020-444553540000}.diff.lua'
    );
    expect(diffFileNameFor('Keyboard', undefined)).toBe('Keyboard.diff.lua');
  });

  it('knows which inputs a device has', () => {
    const device = { numButtons: 2, numHats: 1, axisNames: ['X', 'SLIDER1'] };
    expect(deviceInputs(device)).toEqual([
      'JOY_X',
      'JOY_SLIDER1',
      'JOY_BTN1',
      'JOY_BTN2',
      'JOY_BTN_POV1_U',
      'JOY_BTN_POV1_R',
      'JOY_BTN_POV1_D',
      'JOY_BTN_POV1_L',
      'JOY_BTN_POV1_UR',
      'JOY_BTN_POV1_DR',
      'JOY_BTN_POV1_DL',
      'JOY_BTN_POV1_UL',
    ]);
    expect(deviceHasInput(device, 'JOY_BTN2')).toBe(true);
    expect(deviceHasInput(device, 'JOY_BTN3')).toBe(false);
    expect(deviceHasInput(device, 'JOY_BTN_POV2_U')).toBe(false);
    expect(deviceHasInput(device, 'JOY_Y')).toBe(false);
    expect(deviceHasInput(device, 'JOY_SLIDER1')).toBe(true);
    expect(deviceHasInput(device, 'LShift')).toBe(true);
  });
});

describe('press detection', () => {
  const state = (buttons: boolean[], hats: [number, number][], axes: number[]) => ({
    index: 0,
    name: 'Stick',
    axes,
    buttons,
    hats,
    timestamp: 0,
  });
  it('reports new presses, hat directions and axes that travel from where they rested', () => {
    const device = { axisNames: ['X', 'Z'] };
    // A throttle resting at full back (-1) and a switch that is held on are the resting state.
    const rest = state([true, false], [[0, 0]], [0, -1]);
    expect(detectInputs(rest, rest, state([true, true], [[0, 0]], [0, -1]), device)).toEqual([
      { key: 'JOY_BTN2', kind: 'button' },
    ]);
    expect(detectInputs(rest, rest, state([true, false], [[-1, -1]], [0, -1]), device)).toEqual([
      { key: 'JOY_BTN_POV1_DL', kind: 'hat' },
    ]);
    // The hat going back to centre and a held hat are not presses.
    const held = state([true, false], [[1, 0]], [0, -1]);
    expect(detectInputs(rest, held, held, device)).toEqual([]);
    expect(detectInputs(rest, held, rest, device)).toEqual([]);
    // Small movement is noise; half the travel counts, once.
    expect(detectInputs(rest, rest, state([true, false], [[0, 0]], [0.2, -0.8]), device)).toEqual(
      []
    );
    const moved = state([true, false], [[0, 0]], [0, -0.4]);
    expect(detectInputs(rest, rest, moved, device)).toEqual([{ key: 'JOY_Z', kind: 'axis' }]);
    expect(detectInputs(rest, moved, state([true, false], [[0, 0]], [0, 0.5]), device)).toEqual([]);
    // More axes in the state than the device names: ignored.
    expect(detectInputs(rest, rest, state([true, false], [[0, 0]], [0, -1, 1]), device)).toEqual(
      []
    );
  });
});

describe('diff tables', () => {
  it('reads and writes filters and combos the way DCS does', () => {
    expect(filterFromLua(undefined)).toBeUndefined();
    expect(filterFromLua(LuaTable.from({ invert: true }) as LuaTable)).toEqual({
      ...DEFAULT_FILTER,
      invert: true,
    });
    const filter = { ...DEFAULT_FILTER, curvature: [0.2], saturationY: 0.5 };
    expect(filterFromLua(filterToLua(filter))).toEqual(filter);
    expect(
      filterToLua({ ...DEFAULT_FILTER, curvature: [] })
        .table('curvature')!
        .toJs()
    ).toEqual([0]);
    expect(sameFilter(undefined, DEFAULT_FILTER)).toBe(true);
    expect(sameFilter(filter, { ...filter, curvature: [0.2, 0.3] })).toBe(false);
    expect(comboFromLua('x')).toBeUndefined();
    expect(comboFromLua(LuaTable.from({ reformers: ['LCtrl'] }))).toBeUndefined();
    expect(comboFromLua(LuaTable.from({ key: 'JOY_BTN1', reformers: ['LCtrl', 5] }))).toEqual({
      key: 'JOY_BTN1',
      reformers: ['LCtrl'],
    });
  });

  it('edits a document in place, keeps what it does not understand, and keeps keys sorted', () => {
    const parsed = parseLuaData(
      [
        'local diff = {',
        '\t["ffDiffs"] = {',
        '\t\t["trimmer"] = 0.5,',
        '\t},',
        '\t["keyDiffs"] = {',
        '\t\t["d10pnilunilcdnilvdnilvpnilvunil"] = {',
        '\t\t\t["added"] = {',
        '\t\t\t\t[1] = {',
        '\t\t\t\t\t["column"] = 2,',
        '\t\t\t\t\t["key"] = "JOY_BTN1",',
        '\t\t\t\t},',
        '\t\t\t},',
        '\t\t\t["name"] = "Ten",',
        '\t\t},',
        '\t},',
        '}',
        'return diff',
      ].join('\n')
    );
    if (!parsed.ok) throw new Error(parsed.error.message);
    const doc = parsed.value;
    expect(readDiff(doc)).toMatchObject({ hasForceFeedback: true, entries: [{ name: 'Ten' }] });
    putCombo(doc, 'axis', 'a2001cdnil', 'Pitch', 'removed', { key: 'JOY_Y', reformers: [] });
    putCombo(doc, 'key', 'd05pnilunilcdnilvdnilvpnilvunil', 'Five', 'added', {
      key: 'JOY_BTN2',
      reformers: ['LCtrl'],
      filter: DEFAULT_FILTER,
    });
    // Replacing an existing combo keeps its unknown fields.
    putCombo(doc, 'key', 'd10pnilunilcdnilvdnilvpnilvunil', 'Ten', 'added', {
      key: 'JOY_BTN1',
      reformers: [],
    });
    putCombo(doc, 'key', 'd10pnilunilcdnilvdnilvpnilvunil', 'Ten', 'added', {
      key: 'JOY_BTN3',
      reformers: [],
    });
    expect(
      hasCombo(doc, 'key', 'd10pnilunilcdnilvdnilvpnilvunil', 'added', {
        key: 'JOY_BTN3',
        reformers: [],
      })
    ).toBe(true);
    expect(hasCombo(doc, 'key', 'nope', 'added', { key: 'JOY_BTN3', reformers: [] })).toBe(false);
    expect(writeLuaDocument(doc)).toBe(
      [
        'local diff = {',
        '\t["axisDiffs"] = {',
        '\t\t["a2001cdnil"] = {',
        '\t\t\t["name"] = "Pitch",',
        '\t\t\t["removed"] = {',
        '\t\t\t\t[1] = {',
        '\t\t\t\t\t["key"] = "JOY_Y",',
        '\t\t\t\t},',
        '\t\t\t},',
        '\t\t},',
        '\t},',
        '\t["ffDiffs"] = {',
        '\t\t["trimmer"] = 0.5,',
        '\t},',
        '\t["keyDiffs"] = {',
        '\t\t["d05pnilunilcdnilvdnilvpnilvunil"] = {',
        '\t\t\t["added"] = {',
        '\t\t\t\t[1] = {',
        '\t\t\t\t\t["key"] = "JOY_BTN2",',
        '\t\t\t\t\t["reformers"] = {',
        '\t\t\t\t\t\t[1] = "LCtrl",',
        '\t\t\t\t\t},',
        '\t\t\t\t},',
        '\t\t\t},',
        '\t\t\t["name"] = "Five",',
        '\t\t},',
        '\t\t["d10pnilunilcdnilvdnilvpnilvunil"] = {',
        '\t\t\t["added"] = {',
        '\t\t\t\t[1] = {',
        '\t\t\t\t\t["column"] = 2,',
        '\t\t\t\t\t["key"] = "JOY_BTN1",',
        '\t\t\t\t},',
        '\t\t\t\t[2] = {',
        '\t\t\t\t\t["key"] = "JOY_BTN3",',
        '\t\t\t\t},',
        '\t\t\t},',
        '\t\t\t["name"] = "Ten",',
        '\t\t},',
        '\t},',
        '}',
        'return diff',
      ].join('\n')
    );
    expect(
      dropCombo(doc, 'key', 'd10pnilunilcdnilvdnilvpnilvunil', 'added', {
        key: 'JOY_BTN9',
        reformers: [],
      })
    ).toBe(false);
    for (const key of ['JOY_BTN1', 'JOY_BTN3']) {
      expect(
        dropCombo(doc, 'key', 'd10pnilunilcdnilvdnilvpnilvunil', 'added', { key, reformers: [] })
      ).toBe(true);
    }
    dropCombo(doc, 'key', 'd05pnilunilcdnilvdnilvpnilvunil', 'added', {
      key: 'JOY_BTN2',
      reformers: ['LCtrl'],
    });
    dropCombo(doc, 'axis', 'a2001cdnil', 'removed', { key: 'JOY_Y', reformers: [] });
    // Force-feedback settings are still there, so the file is not empty.
    expect(isEmptyDiff(doc)).toBe(false);
    expect(writeLuaDocument(doc)).toBe(
      'local diff = {\n\t["ffDiffs"] = {\n\t\t["trimmer"] = 0.5,\n\t},\n}\nreturn diff'
    );

    const fresh = newDiffDocument();
    expect(isEmptyDiff(fresh)).toBe(true);
    expect(writeLuaDocument(fresh)).toBe('local diff = {\n}\nreturn diff');
    // A file that returns another variable name, or has no table at all.
    const other = parseLuaData('local d = {\n}\nreturn d');
    expect(other.ok && readDiff(other.value).entries).toEqual([]);
    const none = parseLuaData('x = 5');
    if (!none.ok) throw new Error('parse');
    expect(isEmptyDiff(none.value)).toBe(true);
    putCombo(none.value, 'key', 'd1pnilunilcdnilvdnilvpnilvunil', 'One', 'added', {
      key: 'A',
      reformers: [],
    });
    expect(readDiff(none.value).entries).toHaveLength(1);
  });
});

describe('applying a diff like DCS does', () => {
  it('keeps a default that the diff gives to another action without taking it away here', () => {
    const commands = [
      {
        kind: 'key' as const,
        hash: 'A',
        combos: [
          { key: 'JOY_BTN1', reformers: [] },
          { key: 'JOY_BTN2', reformers: [] },
        ],
      },
      { kind: 'key' as const, hash: 'B', combos: [] },
    ];
    const entry = (hash: string, added: string[], removed: string[]) => ({
      kind: 'key' as const,
      hash,
      name: hash,
      added: added.map((key) => ({ key, reformers: [] })),
      removed: removed.map((key) => ({ key, reformers: [] })),
      changed: [],
    });
    const keys = (result: ReturnType<typeof applyDiff>) =>
      result.bindings.map((b) => `${b.hash}:${b.combo.key}:${b.source}`).sort();
    // Only B.added: A is "updated" and keeps Button 1 too, so the button does both.
    expect(
      keys(
        applyDiff(
          commands,
          { entries: [entry('B', ['JOY_BTN1'], [])], hasForceFeedback: false },
          'user'
        )
      )
    ).toEqual(['A:JOY_BTN1:default', 'A:JOY_BTN2:default', 'B:JOY_BTN1:user']);
    // With A.removed as well (what DCS and RigReady write for a move): only B has it.
    const moved = applyDiff(
      commands,
      {
        entries: [entry('A', [], ['JOY_BTN1']), entry('B', ['JOY_BTN1'], [])],
        hasForceFeedback: false,
      },
      'template'
    );
    expect(keys(moved)).toEqual(['A:JOY_BTN2:default', 'B:JOY_BTN1:template']);
    expect(moved.removed).toEqual([
      { kind: 'key', hash: 'A', combo: { key: 'JOY_BTN1', reformers: [] } },
    ]);
    // An entry for an action that is not in the defaults is reported, not dropped.
    const stale = applyDiff(
      commands,
      { entries: [entry('GONE', ['JOY_BTN9'], [])], hasForceFeedback: false },
      'user'
    );
    expect(stale.unmatched.map((e) => e.hash)).toEqual(['GONE']);
    expect(applyDiff(commands, undefined, 'user').bindings).toHaveLength(2);
  });
});

describe('engine command numbers', () => {
  it('builds hashes like DCS and learns numbers from named hashes in binding files', () => {
    expect(fieldText(undefined)).toBe('nil');
    expect(fieldText(1.0)).toBe('1');
    expect(fieldText(-0.5)).toBe('-0.5');
    expect(fieldText(true)).toBe('true');
    expect(commandHash('key', { down: 3011, cockpit_device_id: 53, value_down: -1 })).toBe(
      'd3011pnilunilcd53vd-1vpnilvunil'
    );
    expect(commandHash('axis', { action: 'iCommandNew' })).toBe('aiCommandNewcdnil');
    expect(parseHash('key', 'dnilp32u214cdnilvdnilvpnilvunil')).toEqual([
      'nil',
      '32',
      '214',
      'nil',
      'nil',
      'nil',
      'nil',
    ]);
    expect(parseHash('key', 'd1ptrueunilcdnilvdnilvpnilvunil')?.[1]).toBe('true');
    expect(parseHash('axis', 'a2001cdnil')).toEqual(['2001', 'nil']);
    expect(parseHash('key', 'garbage')).toBeUndefined();

    const ids = new EngineIds();
    expect(ids.resolve('iCommandPlanePitch')).toBe(2001);
    expect(ids.size).toBeGreaterThan(400);
    const command = (name: string, fields: Record<string, string | number>) => ({
      kind: 'key' as const,
      name,
      category: [],
      combos: [],
      fields,
    });
    const commands = [
      command('Look left', { pressed: 'iCommandTestLeft', up: 'iCommandTestStop' }),
      command('Look right', { pressed: 'iCommandTestRight', up: 'iCommandTestStop' }),
      command('Twins', { down: 'iCommandTwinA' }),
      command('Twins', { down: 'iCommandTwinB' }),
      command('Cockpit', { down: 3001, cockpit_device_id: 5, value_down: 1 }),
    ];
    expect(unresolvedNames('key', commands[0]!.fields, ids.resolve)).toEqual([
      'iCommandTestLeft',
      'iCommandTestStop',
    ]);
    const learned = ids.learn(commands, [
      { kind: 'key', hash: 'dnilp9001u9003cdnilvdnilvpnilvunil', name: 'Look left' },
      // Contradicts what "Look left" taught about the shared stop command: not used.
      { kind: 'key', hash: 'dnilp9002u7777cdnilvdnilvpnilvunil', name: 'Look right' },
      // Two actions with the same name could both be meant: not used.
      { kind: 'key', hash: 'd9100pnilunilcdnilvdnilvpnilvunil', name: 'Twins' },
      // A localized or unknown name, a malformed hash, a non-numeric value: ignored.
      { kind: 'key', hash: 'd9200pnilunilcdnilvdnilvpnilvunil', name: 'Unbekannt' },
      { kind: 'key', hash: 'nonsense', name: 'Look left' },
      { kind: 'key', hash: 'dnilpnilu9003cdnilvdnilvpnilvunil', name: 'Look left' },
      { kind: 'key', hash: 'd3001pnilunilcd5vd1vpnilvunil', name: 'Cockpit' },
    ]);
    expect(learned).toBe(2);
    expect(ids.resolve('iCommandTestLeft')).toBe(9001);
    expect(ids.resolve('iCommandTestStop')).toBe(9003);
    expect(ids.resolve('iCommandTestRight')).toBeUndefined();
    expect(ids.resolve('iCommandTwinA')).toBeUndefined();
    expect(commandHash('key', commands[0]!.fields, ids.resolve)).toBe(
      'dnilp9001u9003cdnilvdnilvpnilvunil'
    );
    expect(ids.entries().find(([name]) => name === 'iCommandTestLeft')).toEqual([
      'iCommandTestLeft',
      9001,
    ]);
  });
});

describe('showing exactly what changes in a file', () => {
  it('marks added and removed lines with a little context and collapses the rest', () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const after = [...before];
    after[14] = 'line 15 changed';
    after.splice(20, 0, 'inserted');
    expect(lineDiff(before.join('\n'), after.join('\r\n'))).toEqual([
      { type: 'gap', text: '12 unchanged lines' },
      { type: 'same', text: 'line 13' },
      { type: 'same', text: 'line 14' },
      { type: 'del', text: 'line 15' },
      { type: 'add', text: 'line 15 changed' },
      { type: 'same', text: 'line 16' },
      { type: 'same', text: 'line 17' },
      { type: 'gap', text: '1 unchanged lines' },
      { type: 'same', text: 'line 19' },
      { type: 'same', text: 'line 20' },
      { type: 'add', text: 'inserted' },
      { type: 'same', text: 'line 21' },
      { type: 'same', text: 'line 22' },
      { type: 'gap', text: '8 unchanged lines' },
    ]);
    expect(lineDiff('', 'a\nb')).toEqual([
      { type: 'add', text: 'a' },
      { type: 'add', text: 'b' },
    ]);
    expect(lineDiff('a\nb', '')).toEqual([
      { type: 'del', text: 'a' },
      { type: 'del', text: 'b' },
    ]);
    expect(lineDiff('same', 'same')).toEqual([]);
    expect(lineDiff('a\nb\nc', 'a\nc', 0)).toEqual([
      { type: 'gap', text: '1 unchanged lines' },
      { type: 'del', text: 'b' },
      { type: 'gap', text: '1 unchanged lines' },
    ]);
    // Very large rewrites fall back to "everything removed, everything added".
    const big = Array.from({ length: 2100 }, (_, i) => `a${i}`).join('\n');
    const other = Array.from({ length: 2100 }, (_, i) => `b${i}`).join('\n');
    const all = lineDiff(big, other);
    expect(all.filter((l) => l.type === 'del')).toHaveLength(2100);
    expect(all.filter((l) => l.type === 'add')).toHaveLength(2100);
  });
});

describe('finding aircraft and DCS', () => {
  it('reads input profiles from entry.lua: the folder key is not the display name', () => {
    expect(
      inputProfilesOf(
        `declare_plugin("x", {\nInputProfiles =\n{\n\t["FA-18C_hornet"]\t\t= current_mod_path .. '/Input/FA-18C/',\n    ["Two"] = current_mod_path.."/input/two",\n},\n})`
      )
    ).toEqual([
      { id: 'FA-18C_hornet', relative: '/Input/FA-18C/' },
      { id: 'Two', relative: '/input/two' },
    ]);
    expect(inputProfilesOf('declare_plugin("x", {})')).toEqual([]);
    expect(profileFolderName('A*B/C?D:E"F')).toBe('ABCDEF');
  });

  it('discovers the recorded install, and says so when DCS is not on the PC', async () => {
    rig = await scenarioRig('flying-fresh', { files: BINDING_FILES });
    const install = path.join(rig.home, 'Program Files (x86)/Steam/steamapps/common/DCSWorld');
    const aircraft = await discoverAircraft(rig.ports.files, [
      path.join(install, 'Mods', 'aircraft'),
      path.join(rig.home, 'no-such-folder'),
    ]);
    // Twenty modules declare profiles; the recording holds input files for the Hornet and the Huey.
    expect(aircraft.length).toBeGreaterThan(20);
    expect(
      aircraft
        .filter((a) => a.folder)
        .map((a) => a.id)
        .sort()
    ).toEqual([HORNET, 'UH-1H', 'UH-1H_Gunner', 'UH-1H_TrackIR_Gunner']);
    // Without an input folder there is no name.lua: the profile key is the name.
    expect(aircraft.filter((a) => !a.folder).every((a) => a.name === a.id)).toBe(true);

    // Lua files DCS's own Lua accepts and the sandbox's does not ("\%") still load.
    const loader = new DefaultsLoader(rig.ports.files, install);
    await fs.writeFile(
      path.join(install, 'odd.lua'),
      "return { keyCommands = { { down = 5, name = _('Lights 10\\%') } }, axisCommands = {} }"
    );
    const odd = await loader.layout({ file: 'odd.lua', folder: install, deviceTemplate: 'X' });
    expect(odd.ok && odd.value.commands[0]).toMatchObject({
      name: 'Lights 10%',
      fields: { down: 5 },
    });
    // Failures name the file.
    expect(
      await loader.layout({ file: 'missing.lua', folder: install, deviceTemplate: 'X' })
    ).toMatchObject({
      ok: false,
      error: { code: 'dcs.defaults.missing' },
    });
    await fs.writeFile(path.join(install, 'bad.lua'), 'return 5');
    expect(
      await loader.layout({ file: 'bad.lua', folder: install, deviceTemplate: 'X' })
    ).toMatchObject({
      ok: false,
      error: { code: 'dcs.defaults.shape' },
    });
    await fs.writeFile(path.join(install, 'outside.lua'), 'dofile("C:/Windows/win.ini")');
    expect(
      await loader.layout({ file: 'outside.lua', folder: install, deviceTemplate: 'X' })
    ).toMatchObject({
      ok: false,
      error: { code: 'dcs.defaults.missing', message: expect.stringContaining('win.ini') },
    });
    expect(await loader.table('missing.lua')).toBeUndefined();
    expect(await loader.table('bad.lua')).toBeUndefined();
    // A wizard.lua result for this exact device overrides DefaultAssignments.
    await fs.writeFile(
      path.join(install, 'wiz.lua'),
      'return { keyCommands = {}, axisCommands = { { combos = defaultDeviceAssignmentFor("roll"), action = 2002, name = "Roll" }, { combos = defaultDeviceAssignmentFor("nothing"), action = 1, name = "None" } }, forceFeedback = defaultFFB() }'
    );
    const wizard = LuaTable.from({ 'Stick {G}': { roll: { key: 'JOY_SLIDER1' } } }) as LuaTable;
    const wiz = await loader.layout({
      file: 'wiz.lua',
      folder: install,
      deviceTemplate: 'Stick',
      deviceFullId: 'Stick {G}',
      wizard,
    });
    expect(wiz.ok && wiz.value.commands[0]!.combos).toEqual([
      { key: 'JOY_SLIDER1', reformers: [], assignment: 'roll' },
    ]);
    expect(wiz.ok && wiz.value.commands[1]!.combos).toEqual([]);

    // No DCS at all: the overview says it was not found instead of failing.
    await fs.rm(path.join(rig.home, 'Saved Games', 'DCS'), { recursive: true });
    await fs.rm(install, { recursive: true });
    const overview = await bindingsFor(rig).overview();
    expect(overview.ok && overview.value).toMatchObject({ found: false, aircraft: [] });
    expect(await bindingsFor(rig).view(HORNET)).toMatchObject({
      ok: false,
      error: { code: 'dcs.aircraft.unknown' },
    });
  });

  it('without the install only the user changes are shown, with the names stored in the files', async () => {
    rig = await scenarioRig('flying-fresh', { files: ['Saved Games/DCS/**'] });
    const bindings = bindingsFor(rig);
    const overview = await bindings.overview();
    expect(overview.ok && overview.value).toMatchObject({ found: true, aircraft: [] });
    const view = await bindings.view(HORNET);
    if (!view.ok) throw new Error(view.error.message);
    expect(view.value.aircraft).toMatchObject({ hasDefaults: false, name: HORNET });
    expect(view.value.warnings[0]).toMatch(/default input files .* were not found/);
    const stick = view.value.devices.find((d) => d.name.includes('Orion'))!;
    const names = stick.bindings.map((b) => view.value.commands.find((c) => c.id === b.commandId)!);
    expect(names.every((c) => c.unmatched)).toBe(true);
    expect(names.map((c) => c.name)).toContain('Gun Trigger - SECOND DETENT (Press to shoot)');
    // The keyboard modifiers fall back to DCS's eight defaults.
    expect(view.value.modifiers.map((m) => m.name)).toEqual([
      'LShift',
      'RShift',
      'LAlt',
      'RAlt',
      'LCtrl',
      'RCtrl',
      'LWin',
      'RWin',
    ]);
  });
});
