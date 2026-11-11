import path from 'node:path';
import { z } from 'zod';
import { JsonStore } from '../../../core/jsonStore';
import type { Ports } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { BUILTIN_PROFILES, isBuiltin } from './builtins';
import { PadProfileSchema, type PadProfile, type PadProfileInput } from './profile';

/** The user's virtual controller profiles: one file in RigReady's data folder. */

const FileSchema = z.object({ profiles: z.array(PadProfileSchema).default([]) });

export class ProfileStore {
  private readonly store: JsonStore<typeof FileSchema>;
  constructor(ports: Pick<Ports, 'files' | 'folders'>) {
    this.store = new JsonStore(
      ports.files,
      path.join(ports.folders.dataRoot(), 'virtual-controller', 'profiles.json'),
      FileSchema
    );
  }

  get file(): string {
    return this.store.file;
  }

  /** The starting points first, then the user's own, each by name. */
  async all(): Promise<Result<{ builtin: readonly PadProfile[]; mine: PadProfile[] }>> {
    const read = await this.store.read();
    if (!read.ok) return read;
    const mine = [...read.value.profiles].sort((a, b) => a.name.localeCompare(b.name));
    return ok({ builtin: BUILTIN_PROFILES, mine });
  }

  async get(id: string): Promise<Result<PadProfile>> {
    const builtin = BUILTIN_PROFILES.find((p) => p.id === id);
    if (builtin) return ok(structuredClone(builtin));
    const read = await this.store.read();
    if (!read.ok) return read;
    const found = read.value.profiles.find((p) => p.id === id);
    return found
      ? ok(found)
      : err('vc.unknownProfile', `There is no virtual controller profile "${id}".`);
  }

  /** Saves a profile of the user's own (a starting point cannot be changed, only copied). */
  async save(input: PadProfileInput): Promise<Result<PadProfile>> {
    const parsed = PadProfileSchema.safeParse(input);
    if (!parsed.success) {
      return err('vc.invalid', 'The profile is not valid.', z.prettifyError(parsed.error));
    }
    const profile = parsed.data;
    if (isBuiltin(profile.id)) {
      return err('vc.builtin', 'A starting point cannot be changed. Make a copy and change that.');
    }
    const saved = await this.store.update((current) => ({
      profiles: [...current.profiles.filter((p) => p.id !== profile.id), profile],
    }));
    if (!saved.ok) return saved;
    const back = saved.value.profiles.find((p) => p.id === profile.id);
    return back ? ok(back) : err('vc.notSaved', 'The profile was not saved.');
  }

  /** A copy of any profile under a new name, as the user's own. */
  async copy(fromId: string, name: string): Promise<Result<PadProfile>> {
    const from = await this.get(fromId);
    if (!from.ok) return from;
    const read = await this.store.read();
    if (!read.ok) return read;
    const taken = new Set([
      ...read.value.profiles.map((p) => p.id),
      ...BUILTIN_PROFILES.map((p) => p.id),
    ]);
    return this.save({ ...from.value, id: freeId(name, taken), name });
  }

  async remove(id: string): Promise<Result<boolean>> {
    if (isBuiltin(id)) return err('vc.builtin', 'A starting point cannot be deleted.');
    const read = await this.store.read();
    if (!read.ok) return read;
    if (!read.value.profiles.some((p) => p.id === id)) return ok(false);
    const saved = await this.store.write({
      profiles: read.value.profiles.filter((p) => p.id !== id),
    });
    if (!saved.ok) return saved;
    return ok(!saved.value.profiles.some((p) => p.id === id));
  }
}

/** A profile id from a name: lower case, dashes, never one that is taken or a starting point's. */
export function freeId(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^starting-?/, '')
      .slice(0, 50) || 'controller';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}
