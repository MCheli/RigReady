import { commandFailed, defineCommands, type PaletteCommand } from '../../shared/feature';
import { virtualControllerContract } from './contract';

const PAGE = '/configure/virtual-controller';

export default defineCommands({
  feature: 'virtual-controller',
  commands: [
    {
      id: 'virtual-controller.page',
      title: 'Virtual controller',
      to: PAGE,
      keywords: ['gamepad', 'xbox', 'xinput', 'emulate', 'vigem', 'dualshock', 'emulator'],
    },
  ],
  async list(shell) {
    const state = await shell.client(virtualControllerContract).state();
    if (!state.ok) throw new Error(state.error.message);
    const out: PaletteCommand[] = [];
    const running = state.value.running;
    if (running) {
      out.push({
        id: 'virtual-controller.stop',
        title: 'Stop the virtual controller',
        hint: running.profileName,
        icon: 'mdi-controller-off',
        async run(s) {
          const stopped = await s.client(virtualControllerContract).stop();
          s.machineChanged();
          if (!stopped.ok)
            return commandFailed(stopped.error, { label: 'Open Virtual controller', to: PAGE });
          return { tone: 'ok', text: stopped.value.message ?? 'No virtual controller was running' };
        },
      });
    }
    for (const profile of state.value.profiles.mine) {
      if (running?.profileId === profile.id) continue;
      out.push({
        id: `virtual-controller.start.${profile.id}`,
        // Two profiles of one name are told apart by the id.
        title: `Start virtual controller: ${profile.name}${profile.sameName ? ` (${profile.id})` : ''}`,
        icon: 'mdi-controller',
        async run(s) {
          s.progress('Plugging in the virtual controller…');
          const started = await s
            .client(virtualControllerContract)
            .start({ id: profile.id, hide: false });
          s.machineChanged();
          if (!started.ok)
            return commandFailed(started.error, { label: 'Open Virtual controller', to: PAGE });
          return { tone: 'ok', text: `Virtual controller on: ${started.value.profileName}` };
        },
      });
    }
    return out;
  },
});
