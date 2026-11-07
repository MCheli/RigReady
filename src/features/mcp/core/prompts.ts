import type { McpPromptDefinition } from '../../../core/mcp';
import { ok } from '../../../core/result';

/**
 * Guided flows: a prompt starts a conversation with the steps in the right order. Each
 * names the tools and resources to use, so an assistant that has never seen RigReady does
 * the sensible thing first.
 */

const steps = (title: string, lines: string[]): string =>
  [`${title}`, '', ...lines.map((line, i) => `${i + 1}. ${line}`), ''].join('\n');

export const PROMPTS: McpPromptDefinition[] = [
  {
    name: 'first_setup',
    title: 'Set up RigReady for the first time',
    description:
      'Walks a new user from an empty RigReady to a working setup: what is on the PC, a setup captured from the rig as it is, a first check, and what to fix.',
    arguments: [
      {
        name: 'game',
        description:
          'The game or sim this setup is for, when the user said ("DCS World", "iRacing").',
      },
    ],
    get: async (args) =>
      ok({
        description: 'First setup',
        messages: [
          {
            role: 'user',
            text: steps(
              `Help me set up RigReady${args['game'] ? ` for ${args['game']}` : ''}. Follow these steps, one at a time, and tell me what you found after each.`,
              [
                'Read rigready://guide, then read rigready://rig/state to see whether a setup exists.',
                'Call setups_list. If there is no setup, make sure the rig is as it should be for a session (ask me to plug everything in and start the helper apps), then call setup_create_from_rig with a name I agree to.',
                'Call rig_check on that setup and explain every item that is not met in plain words, with check_explain where the summary is not clear.',
                'Propose what to fix, in the order Make ready would (apps, then monitors, then files), and only then call rig_make_ready.',
                'When the rig is ready, tell me how to launch from the Play screen, from the tray, or with rig_launch.',
              ]
            ),
          },
        ],
      }),
  },
  {
    name: 'fix_my_bindings',
    title: 'Fix the bindings of an aircraft or car',
    description:
      'Finds what is wrong with the bindings of one aircraft (DCS World) or car (iRacing, Le Mans Ultimate, BeamNG.drive, Assetto Corsa): stale device ids, unwanted defaults, missing controls. Previews every change before it is written.',
    arguments: [
      { name: 'aircraft', description: 'The aircraft or car, as the game names it, when known.' },
      { name: 'game', description: 'dcs, iracing, lmu, beamng or assetto-corsa, when known.' },
    ],
    get: async (args) =>
      ok({
        description: 'Fix my bindings',
        messages: [
          {
            role: 'user',
            text: steps(
              `My bindings${args['aircraft'] ? ` for ${args['aircraft']}` : ''}${args['game'] ? ` in ${args['game']}` : ''} are not right. Help me fix them without losing anything.`,
              [
                'Read rigready://guide. Then call rigready_channels with the feature "dcs-bindings" (DCS World) or "racing" (the racing games) and read its reference.',
                'Read the overview channel of that feature to learn which aircraft or cars have bindings and whether device ids have gone stale (Windows changed a device id).',
                'Read the bindings of the aircraft or car and list the problems the app found, in my words.',
                'For every change: call the plan or preview channel first, show me exactly what would be written, and ask me before calling the channel that writes. The game must be closed.',
                'After a change, read the bindings again and confirm the problem is gone. Tell me that RigReady backed the files up and that the Safety page can undo the change.',
              ]
            ),
          },
        ],
      }),
  },
  {
    name: 'why_not_ready',
    title: 'Why is my rig not ready?',
    description:
      'Explains a Not ready state item by item: what each failing check looks for, what it found, and what the fix would do; then offers to run Make ready.',
    arguments: [
      { name: 'setup', description: 'The setup, by name or id, when not the one in use.' },
    ],
    get: async (args) =>
      ok({
        description: 'Why not ready',
        messages: [
          {
            role: 'user',
            text: steps(
              `RigReady says${args['setup'] ? ` ${args['setup']} is` : ''} Not ready. Tell me why and what to do.`,
              [
                `Call rig_check${args['setup'] ? ` for "${args['setup']}"` : ''} and list every item that is not met, required ones first.`,
                'For each, call check_explain and tell me in one or two sentences what the check looks for, what it found instead, and what its fix would do (or what I have to do myself).',
                'Where the fix starts a program, changes monitors or writes a file, say so before you offer to run it.',
                'Offer rig_make_ready. After it ran, report what each step did and what is still not met.',
              ]
            ),
          },
        ],
      }),
  },
  {
    name: 'new_pc',
    title: 'Move my rig to a new PC',
    description:
      'The order of work on a fresh PC: install the games and helper apps, restore a RigReady backup or import a shared setup, repair device ids, check and make ready.',
    get: async () =>
      ok({
        description: 'New PC',
        messages: [
          {
            role: 'user',
            text: steps(
              'I moved my rig to a new PC (or reinstalled Windows). Help me get it back to where it was.',
              [
                'Read rigready://docs/protect/new-pc and rigready://docs/protect/restore, and follow their order.',
                'Read rigready://rig/state and the games feature (rigready_channels "games") to see which games and helper apps this PC has. Tell me what is missing before anything else.',
                'If I have a RigReady backup or a shared setup file, use the backup or sharing channels: preview what a restore or import would write, show me, then restore or import.',
                'Device ids change on a new PC: use the dcs-bindings migration channels (scan, plan, apply) or the racing repair channels, previews first.',
                'Then setups_list, rig_check and rig_make_ready, and explain what is still not met.',
              ]
            ),
          },
        ],
      }),
  },
];
