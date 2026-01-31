import { createVuetify, type ThemeDefinition } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

// Custom dark greyscale theme matching our style guide
const rigReadyTheme: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#0a0a0a',
    surface: '#141414',
    'surface-variant': '#1e1e1e',
    'surface-bright': '#282828',
    primary: '#ffffff',
    secondary: '#a0a0a0',
    error: '#f87171',
    warning: '#fbbf24',
    success: '#4ade80',
    info: '#60a5fa',
    'on-background': '#ffffff',
    'on-surface': '#ffffff',
    'on-primary': '#0a0a0a',
    'on-secondary': '#0a0a0a',
    'on-error': '#0a0a0a',
    'on-warning': '#0a0a0a',
    'on-success': '#0a0a0a',
  },
  variables: {
    'border-color': '#2a2a2a',
    'border-opacity': 1,
    'high-emphasis-opacity': 1,
    'medium-emphasis-opacity': 0.7,
    'disabled-opacity': 0.4,
  },
};

export const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'rigReadyTheme',
    themes: {
      rigReadyTheme,
    },
  },
  defaults: {
    VBtn: {
      variant: 'flat',
      rounded: 'lg',
    },
    VCard: {
      rounded: 'lg',
      elevation: 0,
    },
    VTextField: {
      variant: 'outlined',
      density: 'comfortable',
    },
    VSelect: {
      variant: 'outlined',
      density: 'comfortable',
    },
  },
});
