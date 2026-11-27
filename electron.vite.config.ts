import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'electron-vite';
import vuetify from 'vite-plugin-vuetify';

// Only runtime `dependencies` (koffi, a native module) stay external. Everything in
// devDependencies is bundled, so the packaged app carries no other node_modules.
export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/preload.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: 'dist/renderer',
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
    plugins: [vue(), vuetify({ autoImport: true })],
    // The Vuetify plugin adds its imports (`vuetify/components/VBtn`, ...) while a page is
    // transformed, so the dev server's scan of the sources never sees them. Found one page at a
    // time instead, each makes Vite bundle the dependencies again and ask the window to reload,
    // and a window caught between two bundles runs two copies of Vue and Pinia: blank pages.
    // Naming them all here bundles them once, before the first page.
    optimizeDeps: {
      include: ['vuetify/components/*', 'vuetify/directives'],
    },
  },
});
