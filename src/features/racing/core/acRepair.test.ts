import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixturesDir, mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { InputDevice } from '../../../shared/models';
import type { AcView } from '../contract';
import { parseIni } from './acIni';
import {
  bindingCounts,
  listedControllers,
  matchControllers,
  rewriteControls,
  type AcChoice,
  type AcRewrite,
} from './acRepair';

const data = path.join(fixturesDir, 'scenarios', 'data', 'racing');
const fixture = (name: string): Promise<string> => fs.readFile(path.join(data, name), 'utf8');

const WHEEL = '20B0BED0-03A4-11F1-8001-444553540000';
const PEDALS = '3A1B2C30-0000-11F1-8003-444553540000';
const HANDBRAKE = '4C5D6E70-0000-11F1-8004-444553540000';

const device = (
  name: string,
  guid: string,
  productGuid: string,
  enumerationIndex: number | undefined
): InputDevice => ({
  index: 0,
  name,
  guid,
  productGuid,
  vendorId: productGuid.slice(4, 8),
  productId: productGuid.slice(0, 4),
  numAxes: 3,
  numButtons: 12,
  numHats: 0,
  axisNames: [],
  ...(enumerationIndex !== undefined ? { enumerationIndex } : {}),
});
const wheel = (n: number | undefined, guid = WHEEL): InputDevice =>
  device('FANATEC Podium Wheel Base DD2', guid, '00070EB7-0000-0000-0000-504944564944', n);
const pedals = (n: number | undefined, guid = PEDALS): InputDevice =>
  device('Fanatec ClubSport Pedals V3', guid, '183B0EB7-0000-0000-0000-504944564944', n);
const handbrake = (n: number): InputDevice =>
  device('Fanatec ClubSport Handbrake', HANDBRAKE, '1A930EB7-0000-0000-0000-504944564944', n);
const box = (n: number, guid: string): InputDevice =>
  device('Button Box', guid, '12340001-0000-0000-0000-504944564944', n);

function rewritten(text: string, live: InputDevice[], choices: AcChoice[] = []): AcRewrite {
  const result = rewriteControls(text, live, choices);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** section -> key -> value of the rewritten file. */
const valuesOf = (text: string): ((section: string, key: string) => string | undefined) => {
  const ini = parseIni(text);
  return (section, key) => ini.get(section)?.get(key)?.value;
};

describe('Assetto Corsa controls.ini: which controller each number is now', () => {
  it('reads [CONTROLLERS] and counts the bindings per controller number', async () => {
    const ini = parseIni(await fixture('ac-controls-two.ini'));
    expect(listedControllers(ini).map((c) => [c.index, c.name, c.instanceGuid])).toEqual([
      [0, 'Fanatec ClubSport Pedals V3', PEDALS],
      [1, 'FANATEC Podium Wheel Base DD2', WHEEL],
    ]);
    // Pedals: throttle, brake, clutch. Wheel: steering, two paddles, lights, hazards (CSP).
    expect([...bindingCounts(ini)]).toEqual([
      [1, 5],
      [0, 3],
    ]);
    const shifter = parseIni(await fixture('ac-controls-three.ini'));
    // The handbrake axis and the H-shifter on the same adapter.
    expect(bindingCounts(shifter).get(2)).toBe(2);
  });

  it('a controller at another number: the bindings follow it, nothing else changes', async () => {
    const text = await fixture('ac-controls-two.ini');
    // A handbrake plugged in later is listed first by Windows: pedals 0 -> 1, wheel 1 -> 2.
    const live = [handbrake(0), pedals(1), wheel(2)];
    const matches = matchControllers(listedControllers(parseIni(text)), live);
    expect(matches.map((m) => [m.listed.index, m.state, m.target?.enumerationIndex])).toEqual([
      [0, 'reordered', 1],
      [1, 'reordered', 2],
    ]);
    const out = rewritten(text, live);
    const get = valuesOf(out.text);
    expect(get('STEER', 'JOY')).toBe('2');
    expect(get('THROTTLE', 'JOY')).toBe('1');
    expect(get('GEARUP', 'JOY')).toBe('2');
    expect(get('__EXT_HAZARDS', 'JOY')).toBe('2');
    // Unbound stays unbound; the gamepad index is another thing and is left alone.
    expect(get('GLANCELEFT', 'JOY')).toBe('-1');
    expect(get('GEARUP', '__CM_ALT_JOY')).toBe('-1');
    expect(get('X360', 'JOYPAD_INDEX')).toBe('0');
    expect(get('CONTROLLERS', 'CON1')).toBe('Fanatec ClubSport Pedals V3');
    expect(get('CONTROLLERS', '__IGUID2')).toBe(WHEEL);
    expect(get('CONTROLLERS', 'CON0')).toBeUndefined();
    expect(out.bindings).toBe(8);
    // Every other line is byte for byte what it was.
    const before = text.split('\n').filter((l) => !/^(JOY|CON\d|__IGUID|PGUID)/.test(l));
    const after = out.text.split('\n').filter((l) => !/^(JOY|CON\d|__IGUID|PGUID)/.test(l));
    expect(after).toEqual(before);
  });

  it('two controllers swapped: each binding is moved to the other number', async () => {
    const text = await fixture('ac-controls-two.ini');
    const out = rewritten(text, [wheel(0), pedals(1)]);
    const get = valuesOf(out.text);
    expect([get('STEER', 'JOY'), get('THROTTLE', 'JOY'), get('BRAKES', 'JOY')]).toEqual([
      '0',
      '1',
      '1',
    ]);
    expect(out.text).toContain(
      `CON0=FANATEC Podium Wheel Base DD2\n__IGUID0=${WHEEL}\nPGUID0=00070EB7-0000-0000-0000-504944564944\nCON1=Fanatec ClubSport Pedals V3`
    );
    expect(out.updated).toEqual(['Fanatec ClubSport Pedals V3', 'FANATEC Podium Wheel Base DD2']);
    // Done again on the result, there is nothing left to do.
    const again = rewriteControls(out.text, [wheel(0), pedals(1)], []);
    expect(again.ok ? 'changed' : again.error.message).toMatch('already where it is now');
  });

  it('keeps Windows line endings and a file the game wrote without instance GUIDs', async () => {
    const text = (await fixture('ac-controls-no-iguid.ini')).replace(/\n/g, '\r\n');
    const live = [wheel(0), pedals(1)];
    const matches = matchControllers(listedControllers(parseIni(text)), live);
    // Placed by model: only one connected controller of each.
    expect(matches.map((m) => m.state)).toEqual(['reordered', 'reordered']);
    const out = rewritten(text, live);
    expect(out.text.split('\r\n').length).toBe(text.split('\r\n').length + 2);
    expect(out.text).not.toMatch(/[^\r]\n/);
    const get = valuesOf(out.text);
    expect(get('STEER', 'JOY')).toBe('0');
    expect(get('GEARUP', 'JOY_MODIFICATOR')).toBe('1');
    // The product GUID is written back as the file had it, braces included.
    expect(get('CONTROLLERS', 'PGUID0')).toBe('{00070EB7-0000-0000-0000-504944564944}');
    expect(get('CONTROLLERS', '__IGUID0')).toBe(WHEEL);
  });

  it('a controller with a new Windows id: its id is replaced, its number kept', async () => {
    const text = await fixture('ac-controls-two.ini');
    const newWheel = '99990000-03A4-11F1-8001-444553540000';
    const live = [pedals(0), wheel(1, newWheel)];
    const matches = matchControllers(listedControllers(parseIni(text)), live);
    expect(matches.map((m) => m.state)).toEqual(['connected', 'moved']);
    const out = rewritten(text, live);
    expect(valuesOf(out.text)('CONTROLLERS', '__IGUID1')).toBe(newWheel);
    expect(out.bindings).toBe(0);
    expect(out.updated).toEqual(['FANATEC Podium Wheel Base DD2']);
  });

  it('a controller not connected: its bindings are moved off the number another one now has', async () => {
    const text = await fixture('ac-controls-three.ini');
    // The pedals are unplugged; the handbrake moves up to number 1, where the pedals were.
    const live = [wheel(0), handbrake(1)];
    const matches = matchControllers(listedControllers(parseIni(text)), live);
    expect(matches.map((m) => m.state)).toEqual(['connected', 'missing', 'reordered']);
    const out = rewritten(text, live);
    const get = valuesOf(out.text);
    expect(get('HANDBRAKE', 'JOY')).toBe('1');
    expect(get('SHIFTER', 'JOY')).toBe('1');
    // The pedals' throttle and brake would otherwise act on the handbrake.
    expect(get('THROTTLE', 'JOY')).toBe('2');
    expect(get('CONTROLLERS', 'CON2')).toBe('Fanatec ClubSport Pedals V3');
    expect(get('CONTROLLERS', '__IGUID2')).toBe(PEDALS);
    expect(out.setAside).toEqual(['Fanatec ClubSport Pedals V3']);
    expect(get('STEER', 'JOY')).toBe('0');
  });

  it('identical controllers with new ids: asked, never guessed; one controller cannot be two', async () => {
    const text = await fixture('ac-controls-twins.ini');
    const X = 'BBBB0001-0000-11F1-8009-444553540000';
    const Y = 'BBBB0002-0000-11F1-800A-444553540000';
    const live = [wheel(0), box(1, X), box(2, Y)];
    const matches = matchControllers(listedControllers(parseIni(text)), live);
    expect(matches.map((m) => [m.state, m.target?.guid, m.candidates.length])).toEqual([
      ['connected', WHEEL, 0],
      ['moved', undefined, 2],
      ['moved', undefined, 2],
    ]);
    const refused = rewriteControls(text, live, []);
    expect(refused.ok ? '' : refused.error.message).toMatch('Choose which one it is');
    const twice = rewriteControls(text, live, [
      { index: 1, guid: X },
      { index: 2, guid: X },
    ]);
    expect(twice.ok ? '' : twice.error.message).toMatch('cannot both be the same Button Box');
    const stranger = rewriteControls(text, live, [{ index: 0, guid: X }]);
    expect(stranger.ok ? '' : stranger.error.message).toMatch('already matched');
    const wrong = rewriteControls(text, live, [{ index: 1, guid: HANDBRAKE }]);
    expect(wrong.ok ? '' : wrong.error.message).toMatch('not a connected Button Box');
    // The user says the second box is now the first one listed, and the first the second.
    const out = rewritten(text, live, [
      { index: 1, guid: Y },
      { index: 2, guid: X },
    ]);
    const get = valuesOf(out.text);
    expect(get('ACTION_HEADLIGHTS', 'JOY')).toBe('2');
    expect(get('ACTION_HORN', 'JOY')).toBe('1');
    expect(get('CONTROLLERS', '__IGUID2')).toBe(Y);
  });

  it('suggests one of two identical controllers only by its collection number', async () => {
    const text = await fixture('ac-controls-twins.ini');
    // Windows handed out new ids but kept the collection numbers 8005 and 8006.
    const live = [
      wheel(0),
      box(1, 'CCCC0002-0000-11F1-8006-444553540000'),
      box(2, 'CCCC0001-0000-11F1-8005-444553540000'),
    ];
    const matches = matchControllers(listedControllers(parseIni(text)), live);
    expect(matches.map((m) => m.target?.enumerationIndex)).toEqual([0, 2, 1]);
  });

  it('refuses when the order Windows lists the controllers in is not known', async () => {
    const text = await fixture('ac-controls-two.ini');
    const live = [wheel(undefined), pedals(undefined)];
    expect(matchControllers(listedControllers(parseIni(text)), live).map((m) => m.state)).toEqual([
      'connected',
      'connected',
    ]);
    const refused = rewriteControls(text, live, []);
    expect(refused.ok ? '' : refused.error.message).toMatch('cannot see the order');
    expect(matchControllers(listedControllers(parseIni(text)), undefined)[0]!.state).toBe(
      'unknown'
    );
    const empty = rewriteControls('[HEADER]\nINPUT_METHOD=KEYBOARD\n', [wheel(0)], []);
    expect(empty.ok ? '' : empty.error.message).toMatch('lists no controllers');
  });
});

describe('Assetto Corsa controller repair on a fixture rig', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    for (const f of app?.wiring.features ?? []) await f.dispose?.();
    await app?.cleanup();
    app = undefined;
  });
  const entries = async (rig: WiredApp) => {
    const journal = await rig.ports.files.journal();
    if (!journal.ok) throw new Error(journal.error.message);
    return journal.value;
  };

  it('shows which device each binding block is on now and repairs controls.ini through FileStore', async () => {
    app = await wiredApp('racing-ac-moved-controllers', {
      files: [
        'Documents/Assetto Corsa/**',
        'Program Files (x86)/Steam/steamapps/*.*',
        'Program Files (x86)/Steam/steamapps/common/assettocorsa/**',
      ],
    });
    const view = await app.invoke<AcView>('racing:assettoCorsa');
    expect(view.repairNeeded).toBe(true);
    expect(view.controllers.map((c) => [c.index, c.state, c.now?.number, c.bindingCount])).toEqual([
      [0, 'moved', 1, 3],
      [1, 'reordered', 0, 5],
    ]);
    // Steering is stored on the DD2 (controller 1), but number 1 is the pedals now.
    expect(view.bindings.find((b) => b.action === 'STEER')).toMatchObject({
      controller: 'FANATEC Podium Wheel Base DD2',
      number: 1,
      actsOn: 'Fanatec ClubSport Pedals V3',
    });
    const overview = await app.invoke<{ games: { id: string; bindings: string }[] }>(
      'racing:overview'
    );
    expect(overview.games.find((g) => g.id === 'assetto-corsa')!.bindings).toBe(
      '2 controllers are at another number now'
    );

    const preview = await app.invoke<{ summary: string; files: { label: string }[] }>(
      'racing:acRepairPreview',
      { choices: [] }
    );
    expect(preview.summary).toBe('1 file modified');
    expect(await entries(app)).toEqual([]);

    // Refused while Content Manager is open: it writes controls.ini.
    await mutate(app, [
      { op: 'startProcess', name: 'Content Manager.exe', path: 'C:\\Games\\Content Manager.exe' },
    ]);
    await expect(app.invoke('racing:acRepair', { choices: [] })).rejects.toThrow(
      'Close Assetto Corsa first'
    );
    await mutate(app, [{ op: 'stopProcess', name: 'Content Manager.exe' }]);

    const done = await app.invoke<{ message: string }>('racing:acRepair', { choices: [] });
    expect(done.message).toMatch(/^Updated 8 bindings of .* in controls\.ini\. Undo is on/);
    const journal = await entries(app);
    expect(journal).toHaveLength(1);
    expect(journal[0]!.backupPath).not.toBeNull();
    const after = await app.invoke<AcView>('racing:assettoCorsa');
    expect(after.repairNeeded).toBe(false);
    expect(after.controllers.map((c) => [c.index, c.state])).toEqual([
      [0, 'connected'],
      [1, 'connected'],
    ]);
    expect(after.bindings.find((b) => b.action === 'STEER')).toMatchObject({
      controller: 'FANATEC Podium Wheel Base DD2',
      number: 0,
    });
    // Undo puts the file back as it was.
    const undone = await app.ports.files.undoGroup(journal[0]!.groupId!);
    expect(undone.ok).toBe(true);
    expect((await app.invoke<AcView>('racing:assettoCorsa')).repairNeeded).toBe(true);
  });
});
