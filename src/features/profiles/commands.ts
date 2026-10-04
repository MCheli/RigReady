import { defineCommands } from '../../shared/feature';

/** Setups for the command palette: the capture page under the name it carries. */
export default defineCommands({
  feature: 'profiles',
  commands: [
    {
      id: 'profiles.capture',
      title: 'New setup from this rig',
      hint: 'Capture what is plugged in, running and arranged now',
      icon: 'mdi-camera-iris',
      keywords: ['create', 'capture', 'profile', 'add'],
      to: '/configure/profiles/capture',
    },
    {
      // The navigation entry keeps its name; these are more words it is found by.
      id: 'profiles.page',
      title: 'Profiles',
      keywords: ['edit', 'clone', 'checklist'],
      to: '/configure/profiles',
    },
  ],
});
