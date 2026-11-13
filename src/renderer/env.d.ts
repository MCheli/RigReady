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
    /**
     * The page is a window of its own with nothing around it (an overlay over a game): no
     * header, no navigation, nothing painted behind it. Opened by the main process only.
     */
    bare?: boolean;
    title?: string;
  }
}

export {};
