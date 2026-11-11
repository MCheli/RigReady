import { promises as fs } from 'node:fs';
import path from 'node:path';
import { it } from 'vitest';
import { BINDING_FILES } from '../dcsBindings';
import { fixturesDir, wiredApp } from '../helpers';
import { ACTION_LISTS_DIR, actionListFile } from '../dcsActionLists';

/**
 * Records the action lists in fixtures/dcs-actions from a real DCS install, read only:
 * each module's input folder is copied into the test rig's temp folder (on top of the
 * recorded rig, which has DCS's own Config and Scripts), and the action list is read with
 * the app's own reader, the same Lua evaluation the app uses. Only each action's id and
 * DCS's name for it are kept.
 *
 * Runs only when asked:
 *   set RIGREADY_RECORD_DCS_ACTIONS=C:\Program Files (x86)\Steam\steamapps\common\DCSWorld
 *   npx vitest run tests/unit/dcsActionLists.record.test.ts
 */
const install = process.env['RIGREADY_RECORD_DCS_ACTIONS'];

async function copyLua(from: string, to: string, recursive: boolean): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(from, { withFileTypes: true });
  } catch {
    return; // The module has no such folder.
  }
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    if (entry.isDirectory()) {
      if (recursive) await copyLua(source, path.join(to, entry.name), true);
    } else if (/\.lua$/i.test(entry.name)) {
      await fs.mkdir(to, { recursive: true });
      await fs.copyFile(source, path.join(to, entry.name));
    }
  }
}

it.runIf(!!install)(
  'records the action list of every aircraft in a DCS install',
  async () => {
    const app = await wiredApp('dcs-bindings-hornet', { files: BINDING_FILES });
    try {
      const real = path.join(install!, 'Mods', 'aircraft');
      const rig = path.join(
        app.home,
        'Program Files (x86)/Steam/steamapps/common/DCSWorld/Mods/aircraft'
      );
      for (const module of await fs.readdir(real)) {
        // Input definitions, and the cockpit scripts they load for device and command numbers.
        await copyLua(path.join(real, module, 'Input'), path.join(rig, module, 'Input'), true);
        for (const sub of ['Cockpit', path.join('Cockpit', 'Scripts')]) {
          await copyLua(path.join(real, module, sub), path.join(rig, module, sub), false);
        }
      }
      const reader = app.wiring.context.bindings.get('dcs')!;
      const aircraft = await reader.aircraft();
      if (!aircraft.ok) throw new Error(aircraft.error.message);
      await fs.mkdir(path.join(fixturesDir, ACTION_LISTS_DIR), { recursive: true });
      for (const a of aircraft.value) {
        const actions = await reader.actions!(a.id);
        if (!actions.ok || actions.value.length < 50) continue; // Gunner seats and the like.
        const lines = actions.value.map((x) => JSON.stringify([x.id, x.name]));
        const text =
          `{"aircraft":${JSON.stringify(a.id)},"name":${JSON.stringify(a.name)},"actions":[\n` +
          `${lines.join(',\n')}\n]}\n`;
        await fs.writeFile(path.join(fixturesDir, ACTION_LISTS_DIR, actionListFile(a.id)), text);
      }
    } finally {
      await app.cleanup();
    }
  },
  600_000
);
