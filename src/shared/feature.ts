import type { AsyncComponentLoader, Component } from 'vue';
import type { RouteRecordRaw } from 'vue-router';
import type { CheckGroup } from '../core/profile/schema';

/** Renderer-side description of a feature: src/features/<name>/index.ts default-exports one. */

export interface NavEntry {
  title: string;
  /** Material Design Icons name, e.g. "mdi-monitor". */
  icon: string;
  /** Route path, e.g. "/configure/displays". */
  to: string;
  /** Lower comes first. Setup 100-199, bindings 200-299, tools 300-399, settings 900+. */
  order: number;
  section: 'Setup' | 'Bindings' | 'Hardware' | 'App';
}

/**
 * A section a feature adds to the Settings page for a setting of its own. The component
 * reads and stores the setting through the feature's own IPC; Settings only gives it a
 * titled panel.
 */
export interface SettingsSection {
  title: string;
  /** Loaded when the Settings page opens: `() => import('./renderer/MySettings.vue')`. */
  component: AsyncComponentLoader;
  /** Lower comes first among the sections features add. Default 500. */
  order?: number;
}

export interface FeatureManifest {
  id: string;
  /** Entries in the Configure navigation. */
  nav?: NavEntry[];
  /**
   * Routes. Paths under /configure render inside the Configure layout; a route with
   * meta.mode === 'fly' renders as the Fly screen.
   */
  routes?: RouteRecordRaw[];
  /**
   * Components mounted once at the app root, on every screen: prompts that must be
   * able to appear anywhere (e.g. "keep this monitor layout?").
   */
  overlays?: Component[];
  /** Check types this feature registers in main, with the label shown in editors. */
  checkTypes?: { type: string; label: string; group: CheckGroup }[];
  remediationTypes?: { type: string; label: string }[];
  /** Sections on the Settings page, below the app's own. */
  settings?: SettingsSection[];
}

export function defineFeature(manifest: FeatureManifest): FeatureManifest {
  return manifest;
}
