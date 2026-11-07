import { defineFeature } from '../../shared/feature';
import McpConfirm from './renderer/McpConfirm.vue';

export default defineFeature({
  id: 'mcp',
  overlays: [McpConfirm],
  settings: [
    {
      title: 'AI assistants (MCP)',
      component: () => import('./renderer/McpSettings.vue'),
      order: 110,
    },
  ],
});
