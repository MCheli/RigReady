import type { RouteRecordRaw } from 'vue-router';
import {
  collectManifests,
  navSectionsOf,
  type FeatureManifest,
  type NavEntry,
} from '../shared/feature';

/** Feature manifests, discovered at build time. Adding a feature edits no shared file. */
const modules = import.meta.glob<{ default: FeatureManifest }>('../features/*/index.ts', {
  eager: true,
});

export const manifests: FeatureManifest[] = collectManifests(modules);

export const featureRoutes: RouteRecordRaw[] = manifests.flatMap((m) => m.routes ?? []);

export const navSections: { section: NavEntry['section']; entries: NavEntry[] }[] =
  navSectionsOf(manifests);

export const firstConfigurePath: string | undefined = navSections[0]?.entries[0]?.to;
