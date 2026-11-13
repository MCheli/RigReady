/**
 * The racing feature (its iRacing page, the cheat sheets and every other reader of
 * ctx.bindings) and the iRacing bindings page name iRacing's actions and keys. No feature
 * imports another, so each keeps its own table (racing/core/iracing/labels.ts,
 * iracing-bindings/core/names.ts) and this test holds them together: an action of the
 * recorded files named or grouped differently on one side fails here until the other follows.
 * On 13 Nov 2026 they differed in 39 names, the black box ones among them: "Next black box"
 * was another action on each page.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as bindingsPage from '../../src/features/iracing-bindings/core/names';
import { parseControlsCfg } from '../../src/features/racing/core/iracing/controlsCfg';
import * as racing from '../../src/features/racing/core/iracing/labels';
import { fixturesDir } from '../helpers';

/** The older file of the recorded rig (367 actions) and the control profile of 13 Nov (369). */
const FILES = [
  path.join(fixturesDir, 'rigs', 'mark-full', 'files', 'Documents', 'iRacing', 'controls.cfg'),
  path.join(fixturesDir, 'scenarios', 'data', 'iracing-bindings', 'profile-controls.cfg'),
];

async function actions(): Promise<string[]> {
  const ids = new Set<string>();
  for (const file of FILES) {
    const parsed = parseControlsCfg(new Uint8Array(await fs.readFile(file)));
    if (!parsed.ok) throw new Error(parsed.error.message);
    for (const record of parsed.value.records) ids.add(record.action);
  }
  return [...ids];
}

describe('one name for each iRacing action', () => {
  it('reads every action of both recorded files', async () => {
    const ids = await actions();
    expect(ids.length).toBe(369);
    expect(ids).toEqual(expect.arrayContaining(['PitSummaryToggle', 'ToggleUIVisibleDrive']));
  });

  it('the racing feature names and groups every action as the iRacing bindings page does', async () => {
    const differences: string[] = [];
    for (const id of await actions()) {
      const a = racing.iracingActionLabel(id);
      const b = bindingsPage.iracingActionLabel(id);
      if (a !== b) differences.push(`${id}: racing "${a}", iRacing bindings "${b}"`);
      const ga = racing.iracingActionGroup(id);
      const gb = bindingsPage.iracingActionGroup(id);
      if (ga !== gb) differences.push(`${id} group: racing "${ga}", iRacing bindings "${gb}"`);
    }
    expect(differences).toEqual([]);
  });

  it('the black box actions are called what iRacing calls them, on both sides', () => {
    // iRacing's "Next Black Box" (unassigned by default); Down, on BlackBoxNext, moves inside it.
    for (const names of [racing, bindingsPage]) {
      expect(names.iracingActionLabel('BlackBoxShowNext')).toBe('Next black box');
      expect(names.iracingActionLabel('BlackBoxShowPrev')).toBe('Previous black box');
      expect(names.iracingActionLabel('BlackBoxNext')).toBe('Black box next control');
    }
  });

  it('both name every key code, with every modifier, alike', () => {
    const differences: string[] = [];
    for (let code = 0; code < 256; code++) {
      for (const modifiers of [0, 0x03, 0x0c, 0x30, 0x3f]) {
        const a = racing.iracingKeyLabel(code, modifiers);
        const b = bindingsPage.iracingKeyLabel(code, modifiers);
        if (a !== b) differences.push(`${code}/${modifiers}: "${a}" and "${b}"`);
      }
    }
    expect(differences).toEqual([]);
  });
});
