import { defineFeature } from '../../shared/feature';

/** No screens of its own: this feature contributes the app check, its fix and its capture. */
export default defineFeature({
  id: 'processes',
  checkTypes: [{ type: 'process.running', label: 'App running', group: 'apps' }],
  remediationTypes: [{ type: 'process.launch', label: 'Start the app' }],
});
