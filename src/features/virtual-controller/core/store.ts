import path from 'node:path';
import { z } from 'zod';
import { JsonStore } from '../../../core/jsonStore';
import type { Ports } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { BUILTIN_PROFILES, isBuiltin } from './builtins';
import { separateGameNotes } from './gameNotes';
import { freeName, nameKey, nameTakenText } from './names';
import { PadProfileSchema, type PadProfile, type PadProfileInput } from './profile';

/** The user's virtual controller profiles: one file in RigReady's data folder. */

const FileSchema = z
  .object({ profiles: z.array(PadProfileSchema).default([]) })
  // A copy made before notes for one game were kept apart shows them apart from now on.
  .transform((file) => ({ profiles: file.profiles.map(separateGameNotes) }));

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

  /** The starting points first, then the user's own, each by name (two of one name: by id). */
  async all(): Promise<Result<{ builtin: readonly PadProfile[]; mine: PadProfile[] }>> {
    const read = await this.store.read();
    if (!read.ok) return read;
    const mine = [...read.value.profiles].sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    );
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

  /**
   * Saves a profile of the user's own (a starting point cannot be changed, only copied).
   * A new profile, or one given a new name, cannot take a name another profile has: two
   * rows that read the same are how the wrong one gets deleted. A profile that shares its
   * name already (from before this rule) is still saved under it, so it can be edited.
   */
  async save(input: PadProfileInput): Promise<Result<PadProfile>> {
    const parsed = PadProfileSchema.safeParse(input);
    if (!parsed.success) {
      return err('vc.invalid', 'The profile is not valid.', z.prettifyError(parsed.error));
    }
    const profile = parsed.data;
    if (isBuiltin(profile.id)) {
      return err('vc.builtin', 'A starting point cannot be changed. Make a copy and change that.');
    }
    let taken: PadProfile | undefined;
    const saved = await this.store.update((current) => {
      const before = current.profiles.find((p) => p.id === profile.id);
      if (!before || nameKey(before.name) !== nameKey(profile.name)) {
        taken = [...BUILTIN_PROFILES, ...current.profiles].find(
          (p) => p.id !== profile.id && nameKey(p.name) === nameKey(profile.name)
        );
        if (taken) return current;
      }
      return { profiles: [...current.profiles.filter((p) => p.id !== profile.id), profile] };
    });
    if (!saved.ok) return saved;
    if (taken) return err('vc.nameTaken', nameTakenText(taken));
    const back = saved.value.profiles.find((p) => p.id === profile.id);
    return back ? ok(back) : err('vc.notSaved', 'The profile was not saved.');
  }

  /**
   * A copy of any profile, as the user's own. Its name is the one asked for, or that name
   * with the next free number when another profile has it ("My HOTAS 2"); its id follows
   * the name. Both are chosen while the file is held, so two copies asked for at once (a
   * double press) never share a name or an id.
   */
  async copy(fromId: string, name: string): Promise<Result<PadProfile>> {
    const from = await this.get(fromId);
    if (!from.ok) return from;
    let made: PadProfile | undefined;
    let invalid: string | undefined;
    const saved = await this.store.update((current) => {
      const all = [...BUILTIN_PROFILES, ...current.profiles];
      const unique = freeName(
        name,
        all.map((p) => p.name)
      );
      const parsed = PadProfileSchema.safeParse({
        ...from.value,
        id: freeId(unique, new Set(all.map((p) => p.id))),
        name: unique,
      });
      if (!parsed.success) {
        invalid = z.prettifyError(parsed.error);
        return current;
      }
      made = parsed.data;
      return { profiles: [...current.profiles, parsed.data] };
    });
    if (!saved.ok) return saved;
    if (!made) return err('vc.invalid', 'The profile is not valid.', invalid);
    const id = made.id;
    const back = saved.value.profiles.find((p) => p.id === id);
    return back ? ok(back) : err('vc.notSaved', 'The copy was not saved.');
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
