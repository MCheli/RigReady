import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';
import './styles.css';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import { createVuetify } from 'vuetify';
import { keepNaming } from './a11y';
import App from './App.vue';
import BareWindow from './layouts/BareWindow.vue';
import { router } from './router';
import { opensBare } from './shell/routes';

/** Restrained dark theme. Status colours are reserved for status. */
const vuetify = createVuetify({
  theme: {
    defaultTheme: 'rig',
    themes: {
      rig: {
        dark: true,
        colors: {
          background: '#0f1317',
          surface: '#171c22',
          'surface-bright': '#1e252d',
          primary: '#5aa9e6',
          secondary: '#8b95a3',
          success: '#3fb97f',
          warning: '#e2b23c',
          error: '#ee635b',
          info: '#5aa9e6',
          // Text on a filled button or alert is dark: white on these mid-tones fails WCAG AA.
          'on-primary': '#0f1317',
          'on-success': '#0f1317',
          'on-warning': '#0f1317',
          'on-error': '#0f1317',
          'on-info': '#0f1317',
        },
      },
    },
  },
  defaults: {
    VBtn: { variant: 'flat', rounded: 'md' },
    VTextField: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' },
    VSelect: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto' },
    VCheckbox: { density: 'compact', hideDetails: true },
    VSwitch: { density: 'compact', hideDetails: true, color: 'primary' },
    VCard: { rounded: 'lg', flat: true },
    // Dialogs arrive like pages: a short rise and fade (styles.css), not a zoom from the button.
    VDialog: { transition: 'rr-dialog' },
  },
});

/**
 * A window opened on a bare page (an overlay over a game) gets the page alone: no header, no
 * navigation, and nothing painted behind it (html.rr-bare in styles.css). Which it is never
 * changes while the window lives, so it is decided once, here.
 */
const bare = opensBare(window.location.hash, (path) => router.resolve(path));
if (bare) document.documentElement.classList.add('rr-bare');

createApp(bare ? BareWindow : App)
  .use(createPinia())
  .use(router)
  .use(vuetify)
  .mount('#app');
if (!bare) keepNaming(document);
