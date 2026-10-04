import type { RouteRecordRaw } from 'vue-router';
import {
  collectCommands,
  collectManifests,
  navSectionsOf,
  type FeatureCommands,
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

/**
 * What the features offer the command palette, discovered the same way. Loaded when the
 * palette is first needed, not at startup: a commands.ts brings its feature's contract
 * with it, which the first screen does not need.
 */
const commandModules = import.meta.glob<{ default: FeatureCommands }>('../features/*/commands.ts');

let commands: Promise<FeatureCommands[]> | undefined;

export function featureCommands(): Promise<FeatureCommands[]> {
  commands ??= Promise.all(
    Object.entries(commandModules).map(async ([file, load]) => [file, await load()] as const)
  ).then((loaded) => collectCommands(Object.fromEntries(loaded)));
  return commands;
}
