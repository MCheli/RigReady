import type { RouteRecordRaw } from 'vue-router';
import type { FeatureManifest, NavEntry } from '../shared/feature';

/** Feature manifests, discovered at build time. Adding a feature edits no shared file. */
const modules = import.meta.glob<{ default: FeatureManifest }>('../features/*/index.ts', {
  eager: true,
});

export const manifests: FeatureManifest[] = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([file, module]) => {
    if (!module.default?.id) throw new Error(`${file} must default-export defineFeature({...})`);
    return module.default;
  });

export const featureRoutes: RouteRecordRaw[] = manifests.flatMap((m) => m.routes ?? []);

const SECTION_ORDER: NavEntry['section'][] = ['Setup', 'Bindings', 'Hardware', 'App'];

export const navSections: { section: NavEntry['section']; entries: NavEntry[] }[] =
  SECTION_ORDER.map((section) => ({
    section,
    entries: manifests
      .flatMap((m) => m.nav ?? [])
      .filter((entry) => entry.section === section)
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
  })).filter((group) => group.entries.length > 0);

export const firstConfigurePath: string | undefined = navSections[0]?.entries[0]?.to;
