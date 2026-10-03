import { defineFeature } from '../../shared/feature';

/** No screens of its own: this feature contributes check and fix types. */
export default defineFeature({
  id: 'checks-generic',
  checkTypes: [
    { type: 'service.running', label: 'Windows service running', group: 'apps' },
    { type: 'file.exists', label: 'Config file or folder present', group: 'files' },
    { type: 'file.content', label: 'Config file content', group: 'files' },
    { type: 'script.check', label: 'Script succeeds', group: 'other' },
    { type: 'game.updated', label: 'Game updated since you last verified', group: 'other' },
  ],
  remediationTypes: [
    { type: 'script.run', label: 'Run a script' },
    { type: 'instructions.show', label: 'Show instructions' },
    { type: 'file.restore', label: 'Restore from a backup' },
  ],
});
