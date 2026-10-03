import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';
import './styles.css';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import { createVuetify } from 'vuetify';
import App from './App.vue';
import { router } from './router';

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
          error: '#e5534b',
          info: '#5aa9e6',
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
  },
});

createApp(App).use(createPinia()).use(router).use(vuetify).mount('#app');
