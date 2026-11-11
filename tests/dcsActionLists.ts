import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BoundAction } from '../src/core/bindings';

/**
 * The action lists of the DCS aircraft, recorded from the owner's DCS install by
 * tests/unit/dcsActionLists.record.test.ts: each action's id and DCS's own name for it,
 * nothing else from Eagle Dynamics' files. The binding guide tests check every guide
 * against them, also for the aircraft the recorded rig has no input files for.
 */

/** Below fixtures/. */
export const ACTION_LISTS_DIR = 'dcs-actions';

const dir = path.resolve(__dirname, '..', 'fixtures', ACTION_LISTS_DIR);

/** The file of one aircraft profile: "A-10C II" -> A-10C_II.json. */
export function actionListFile(aircraftId: string): string {
  return `${aircraftId.replace(/[^A-Za-z0-9_.-]+/g, '_')}.json`;
}

interface ActionListFile {
  aircraft: string;
  name: string;
  actions: [string, string][];
}

export interface ActionList {
  /** DCS's input profile id, as written: "A-10C II". */
  id: string;
  name: string;
  actions: BoundAction[];
}

let cache: Map<string, ActionList> | undefined;

/** Every recorded aircraft, by its profile id in lower case. */
export function actionLists(): Map<string, ActionList> {
  if (cache) return cache;
  cache = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const list = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as ActionListFile;
    cache.set(list.aircraft.toLowerCase(), {
      id: list.aircraft,
      name: list.name,
      actions: list.actions.map(([id, name]) => ({
        id,
        name,
        category: [],
        kind: id.startsWith('axis:') ? 'axis' : 'button',
        editable: true,
      })),
    });
  }
  return cache;
}
