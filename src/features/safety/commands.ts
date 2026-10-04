import { defineCommands } from '../../shared/feature';

/**
 * Safety for the command palette. The page is already listed under its navigation name;
 * this adds the words people look for it by. Undo itself stays on the page, where the
 * files of a change are shown before it is undone.
 */
export default defineCommands({
  feature: 'safety',
  commands: [
    {
      id: 'safety.open',
      title: 'Undo a change',
      keywords: ['undo', 'changes', 'journal', 'what did rigready change', 'automatic backups'],
      to: '/configure/safety',
    },
  ],
});
