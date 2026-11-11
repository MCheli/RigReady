import path from 'node:path';
import type { GameInstall, TrackedFileSuggestion } from '../../../core/games';
import { simpleGame } from '../core/simpleGame';

/**
 * IL-2 Sturmovik: Great Battles. Every Great Battles title installs into one game folder:
 * on Steam that is app 307960 (IL-2 Sturmovik: Battle of Stalingrad, which the other
 * titles add to). The game keeps its bindings inside that folder, in data\input
 * (current.actions, current.map, current.responses, current.devices, curves.cfg,
 * devices.txt), its options in data\startup.cfg and the controllers it has seen in
 * data\swf\il2\storage\storeddevices.txt. Sources: docs/research/game-modules-2026-11.md
 * section 3.
 */

const APP_ID = '307960';
const EXE = path.join('bin', 'game', 'Il-2.exe');

const data = (install: GameInstall): string => path.join(install.installDir, 'data');

const { module, extras } = simpleGame({
  id: 'il2-great-battles',
  name: 'IL-2 Sturmovik: Great Battles',
  kind: 'flight',
  steamAppId: APP_ID,
  exe: EXE,
  steamNeedsExe: true,
  processes: ['Il-2.exe'],
  closeWhy:
    'IL-2 reads and writes its bindings and options while it runs, which could undo the restore.',

  async locations(_ctx, installs) {
    return installs.map((install, index) => ({
      id: `input-${index + 1}`,
      label: 'data\\input (bindings)',
      path: path.join(data(install), 'input'),
    }));
  },

  async tracked(_ctx, installs) {
    const suggestions: TrackedFileSuggestion[] = [];
    for (const install of installs) {
      const input = path.join(data(install), 'input');
      suggestions.push(
        {
          label: 'IL-2 bindings and controller settings',
          path: input,
          kind: 'folder',
          description:
            'The whole data\\input folder: key and controller bindings, axis responses and curves, and the list of controllers the bindings refer to.',
        },
        { label: 'Bindings (current.actions)', path: path.join(input, 'current.actions') },
        { label: 'Controller bindings (current.map)', path: path.join(input, 'current.map') },
        {
          label: 'Axis responses (current.responses)',
          path: path.join(input, 'current.responses'),
        },
        { label: 'Controllers (devices.txt)', path: path.join(input, 'devices.txt') },
        { label: 'Controllers (current.devices)', path: path.join(input, 'current.devices') },
        { label: 'Axis curves (curves.cfg)', path: path.join(input, 'curves.cfg') },
        {
          label: 'Graphics and game options (startup.cfg)',
          path: path.join(data(install), 'startup.cfg'),
        },
        {
          label: 'Controllers seen (storeddevices.txt)',
          path: path.join(data(install), 'swf', 'il2', 'storage', 'storeddevices.txt'),
        }
      );
    }
    return suggestions;
  },

  manualLabel: 'the IL-2 Sturmovik folder (it contains bin\\game\\Il-2.exe)',
  notes: [
    'IL-2 keeps its bindings inside the game folder (data\\input), so reinstalling the game can delete them: keep a backup.',
    'devices.txt gives each controller a number that the bindings use. RigReady backs the file up but does not repair it when Windows renumbers a controller.',
  ],
});

export { extras };
export default module;
