import { commandFailed, defineCommands } from '../../../../src/shared/feature';
import { exampleContract } from './contract';

/**
 * What the test feature offers the command palette: an action that goes through its own
 * IPC channel, more words for its page, and a command that depends on its state.
 */
export default defineCommands({
  feature: 'zz-example',
  commands: [
    {
      id: 'zz-example.ping',
      title: 'Ping the example',
      icon: 'mdi-lightbulb-outline',
      async run(shell) {
        const answer = await shell.client(exampleContract).ping({ text: 'from the palette' });
        if (!answer.ok) return commandFailed(answer.error);
        shell.machineChanged();
        return { tone: 'ok', text: `The example answered "${answer.value.echo}"` };
      },
    },
    { id: 'zz-example.page', title: 'Lamp', keywords: ['bulb'], to: '/configure/zz-example' },
  ],
  async list(shell) {
    const count = await shell.client(exampleContract).count();
    if (!count.ok) throw new Error(count.error.message);
    return [
      {
        id: 'zz-example.again',
        title: 'Ping the example again',
        hint: `Pinged ${count.value.pings} times`,
        run: async () => ({ tone: 'info', text: 'Nothing to do' }),
      },
    ];
  },
});
