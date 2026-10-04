import { shippedPacks, type Pack } from './pack';

/** The binding guides shipped in packs/*.yaml, read once. */
const files = import.meta.glob('../packs/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

let cache: Map<string, Pack> | undefined;

export function shipped(): Map<string, Pack> {
  cache ??= shippedPacks(files);
  return cache;
}

export function shippedPack(aircraftId: string): Pack | undefined {
  return shipped().get(aircraftId.toLowerCase());
}
