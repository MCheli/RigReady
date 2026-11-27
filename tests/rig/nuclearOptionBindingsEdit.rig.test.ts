/**
 * The Nuclear Option binding writer against the game's real saved bindings on this PC.
 * Both steps only read the registry; neither writes it. Skipped unless
 * RIGREADY_RIG_NUCLEAR_OPTION names a step (docs/research/nuclear-option.md, "The second look"):
 *
 *   before            reads every saved map, checks each comes back character for character,
 *                     tries the change on a copy in memory, and keeps a snapshot of the values
 *   after:<actionId>  compares the registry with the snapshot: only one controller map
 *                     differs, only in that action, exactly as the writer composes it
 *
 * Between the two, with the game closed, the change is made in RigReady by hand.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nullLogger } from '../../src/core/logger';
import { editMapText } from '../../src/features/nuclear-option-bindings/core/edit';
import {
  parseControllerMap,
  parseSaveKey,
  serializeControllerMap,
  textOfBinary,
} from '../../src/features/nuclear-option-bindings/core/rewired';
import { createWindowsPorts } from '../../src/platform/windows';
import type { RegistryValue } from '../../src/shared/models';

const step = process.env.RIGREADY_RIG_NUCLEAR_OPTION ?? '';
const KEY = 'Software\\Shockfront\\NuclearOption';
const SNAPSHOT = path.join(os.tmpdir(), 'rigready-rig-nuclear-option-before.json');
const ports = createWindowsPorts({
  log: nullLogger,
  projectRoot: path.resolve(__dirname, '../..'),
});

async function values(): Promise<Record<string, RegistryValue>> {
  const read = await ports.registry.listValues('HKCU', KEY);
  if (!read.ok) throw new Error(read.error.message);
  return read.value;
}
/** The saved controller maps: value name to stored text. */
function mapsOf(all: Record<string, RegistryValue>): Map<string, string> {
  const maps = new Map<string, string>();
  for (const [name, value] of Object.entries(all)) {
    if (parseSaveKey(name)?.dataType !== 'ControllerMap' || value.type !== 'binary') continue;
    const text = textOfBinary(value.value);
    if (text !== undefined) maps.set(name, text);
  }
  return maps;
}
const elements = (text: string): string[] =>
  text.match(/<ActionElementMap>.*?<\/ActionElementMap>/g) ?? [];
/**
 * The text around the bindings. A list that got its first binding, or lost its last, is
 * written open or closed on itself: both count as the same empty list here.
 */
const withoutElements = (text: string): string =>
  text
    .replace(/<ActionElementMap>.*?<\/ActionElementMap>/g, '')
    .replace(/<buttonMaps><\/buttonMaps>/g, '<buttonMaps />');

describe.skipIf(step !== 'before')('Nuclear Option bindings, before a change (read-only)', () => {
  it('every saved map is read and put together again character for character, and a change on a copy differs in one binding only', async () => {
    const all = await values();
    const maps = mapsOf(all);
    expect(maps.size).toBeGreaterThan(0);
    let joysticks = 0;
    for (const [name, text] of maps) {
      const map = parseControllerMap(text);
      expect(map.ok, name).toBe(true);
      if (!map.ok) continue;
      expect(serializeControllerMap(map.value), name).toBe(text);
      if (map.value.kind !== 'JoystickMap' || map.value.categoryId !== 0) continue;
      joysticks++;
      // Toggle Navigation Lights (49) to button 12, on a copy: nothing is written anywhere.
      const edited = editMapText(text, { actionId: 49, button: 12 });
      if (!edited.ok) continue; // bound to an axis here, or in a way the writer leaves alone
      if (edited.value.same) continue;
      const before = elements(text).filter((e) => !e.includes('<actionId>49</actionId>'));
      const after = elements(edited.value.text).filter(
        (e) => !e.includes('<actionId>49</actionId>')
      );
      expect(after, name).toEqual(before);
      expect(withoutElements(edited.value.text), name).toBe(withoutElements(text));
    }
    expect(joysticks).toBeGreaterThan(0);
    await fs.writeFile(SNAPSHOT, JSON.stringify(all), 'utf8');
  });
});

describe.skipIf(!step.startsWith('after:'))(
  'Nuclear Option bindings, after a change (read-only)',
  () => {
    it('only one controller map differs from the snapshot, only in the named action, as the writer composes it', async () => {
      const actionId = Number(step.slice('after:'.length));
      expect(Number.isInteger(actionId)).toBe(true);
      const before = JSON.parse(await fs.readFile(SNAPSHOT, 'utf8')) as Record<
        string,
        RegistryValue
      >;
      const now = await values();
      // Unity counts the game's runs in two values of its own; nothing else may differ.
      const own = (name: string): boolean => name.startsWith('unity.player_session');
      const differing = [...new Set([...Object.keys(before), ...Object.keys(now)])].filter(
        (name) => !own(name) && JSON.stringify(before[name]) !== JSON.stringify(now[name])
      );
      expect(differing).toHaveLength(1);
      const name = differing[0]!;
      const was = mapsOf(before).get(name)!;
      const is = mapsOf(now).get(name)!;
      expect(withoutElements(is)).toBe(withoutElements(was));
      const mark = `<actionId>${actionId}</actionId>`;
      expect(elements(is).filter((e) => !e.includes(mark))).toEqual(
        elements(was).filter((e) => !e.includes(mark))
      );
      // What is there for the action now is exactly what the writer gives for that button.
      const mine = elements(is).filter((e) => e.includes(mark));
      expect(mine.length).toBeLessThanOrEqual(1);
      const button = mine[0] ? Number(/<elementIdentifierId>(\d+)</.exec(mine[0])![1]) - 31 : null;
      const composed = editMapText(was, { actionId, button });
      expect(composed.ok && composed.value.text).toBe(is);
    });
  }
);
