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
  /** Lower comes first. Setups 100s, Games 200s, Controls 300s, Hardware 400s, RigReady 900s. */
  order: number;
  /**
   * Setups: what you fly or race with, and keeping it safe (setups, backups, sharing).
   * Games: the games found on this PC and what each needs set up.
   * Controls: what the buttons do (bindings, the binding guide, cheat sheets).
   * Hardware: the devices, monitors, audio and helper tools of the rig.
   * RigReady: the app itself (settings, the record of changes, diagnostics).
   */
  section: 'Setups' | 'Games' | 'Controls' | 'Hardware' | 'RigReady';
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

/**
 * The manifests of a set of discovered modules (what import.meta.glob over every feature
 * folder's index.ts returns), in a stable order. This is the whole registry: a feature is
 * its folder.
 */
export function collectManifests(
  modules: Record<string, { default?: FeatureManifest }>
): FeatureManifest[] {
  return Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, module]) => {
      if (!module.default?.id) throw new Error(`${file} must default-export defineFeature({...})`);
      return module.default;
    });
}

const SECTION_ORDER: NavEntry['section'][] = [
  'Setups',
  'Games',
  'Controls',
  'Hardware',
  'RigReady',
];

/** The Configure navigation: every feature's entries by section, in order. */
export function navSectionsOf(
  manifests: FeatureManifest[]
): { section: NavEntry['section']; entries: NavEntry[] }[] {
  return SECTION_ORDER.map((section) => ({
    section,
    entries: manifests
      .flatMap((m) => m.nav ?? [])
      .filter((entry) => entry.section === section)
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
  })).filter((group) => group.entries.length > 0);
}
