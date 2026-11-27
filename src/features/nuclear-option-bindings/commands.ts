import { defineCommands } from '../../shared/feature';

/** More words for the page to be found by in the command palette. */
export default defineCommands({
  feature: 'nuclear-option-bindings',
  commands: [
    {
      id: 'nuclear-option-bindings.open',
      title: 'Nuclear Option bindings',
      hint: 'What each button, axis and key does in Nuclear Option',
      icon: 'mdi-airplane',
      keywords: ['nuclear option', 'controls', 'buttons', 'keys', 'axes', 'rewired'],
      to: '/configure/nuclear-option-bindings',
    },
  ],
});
