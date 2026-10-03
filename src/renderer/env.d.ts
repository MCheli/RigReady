/// <reference types="vite/client" />
import type { Bridge } from '../shared/ipc';

declare global {
  interface Window {
    rigready: Bridge;
  }
}

declare module 'vue-router' {
  interface RouteMeta {
    /** 'fly' renders full-width without the Configure navigation. */
    mode?: 'fly' | 'configure';
    title?: string;
  }
}

export {};
