import { defineCommands } from '../../shared/feature';
import { aiAssistContract } from './contract';
import { assistantOpen } from './panel';

/** The built-in assistant from the command palette: the panel opens on the screen shown now. */
export default defineCommands({
  feature: 'ai-assist',
  commands: [
    {
      id: 'ai-assist.assistant',
      title: 'Open the assistant',
      hint: 'Help with a setup, a check or a script, with the AI provider you chose',
      icon: 'mdi-message-processing-outline',
      group: 'Assistant',
      keywords: ['ai', 'help', 'chat', 'claude', 'script', 'ask'],
      async run(shell) {
        assistantOpen.value = true;
        const status = await shell.client(aiAssistContract).status();
        if (status.ok && status.value.ready) return undefined;
        return {
          tone: 'info',
          text: 'The assistant needs an AI provider first: your own key, or a model on this PC.',
          action: { label: 'Open Settings', to: '/configure/settings' },
        };
      },
    },
  ],
});
