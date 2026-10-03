import { bind, defineFeatureMain } from '../../core/feature';
import { settingsContract } from './contract';
import {
  applyPatch,
  clearAiKey,
  readView,
  removeLayout,
  renameLayout,
  saveCurrentLayout,
  setAiKey,
} from './core/settings';

export default defineFeatureMain({
  id: 'settings',
  setup(ctx) {
    return [
      bind(settingsContract, {
        get: () => readView(ctx),
        update: (patch) => applyPatch(ctx, patch),
        saveCurrentLayout: ({ name }) => saveCurrentLayout(ctx, name),
        renameLayout: ({ id, name }) => renameLayout(ctx, id, name),
        removeLayout: ({ id }) => removeLayout(ctx, id),
        setAiKey: ({ key }) => setAiKey(ctx, key),
        clearAiKey: () => clearAiKey(ctx),
      }),
    ];
  },
});
