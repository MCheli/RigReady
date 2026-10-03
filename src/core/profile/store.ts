import path from 'node:path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import type { FileStore } from '../ports';
import { err, ok, type Result } from '../result';
import { migrateProfile, ProfileSchema, slugify, type Profile } from './schema';

const StateSchema = z.object({
  lastProfileId: z.string().optional(),
  /** Profile id -> when it was last used on the Fly screen (ISO). */
  lastUsed: z.record(z.string(), z.string()).default({}),
});
type State = z.infer<typeof StateSchema>;

/** A profile file that could not be loaded, for listing it as broken instead of hiding it. */
export interface InvalidProfile {
  id: string;
  file: string;
  message: string;
  detail?: string;
  /** 1-based line of a YAML syntax error, when known. */
  line?: number;
}

export interface StoredProfile {
  profile: Profile;
  file: string;
  /** Last modification of the file. */
  mtimeMs: number;
  /** The file holds YAML comments, which a save from RigReady would drop. */
  hasComments: boolean;
}

/** A YAML comment: "#" at the start of a line or after a space, outside quoted text. */
export function hasYamlComments(text: string): boolean {
  return text
    .split(/\r?\n/)
    .some((line) => /(^|\s)#/.test(line.replace(/'(?:[^']|'')*'|"(?:[^"\\]|\\.)*"/g, '""')));
}

/** Profiles as YAML files under <data root>/profiles, one file per profile. */
export class ProfileStore {
  /** The last version of each profile that loaded, for when a hand edit breaks the file. */
  private readonly valid = new Map<string, Profile>();

  constructor(
    private readonly files: FileStore,
    private readonly dataRoot: string
  ) {}

  get dir(): string {
    return path.join(this.dataRoot, 'profiles');
  }

  fileFor(id: string): string {
    return path.join(this.dir, `${id}.yaml`);
  }

  async list(): Promise<Result<Profile[]>> {
    const detailed = await this.listDetailed();
    if (!detailed.ok) return detailed;
    return ok(detailed.value.profiles.map((p) => p.profile));
  }

  /** Every profile file: the valid ones (sorted by name) and the broken ones, each with why. */
  async listDetailed(): Promise<Result<{ profiles: StoredProfile[]; invalid: InvalidProfile[] }>> {
    const entries = await this.files.listEntries(this.dir);
    if (!entries.ok) return entries;
    const profiles: StoredProfile[] = [];
    const invalid: InvalidProfile[] = [];
    for (const entry of entries.value) {
      if (entry.isDirectory || !entry.name.endsWith('.yaml')) continue;
      const id = entry.name.slice(0, -'.yaml'.length);
      const loaded = await this.load(id);
      // A broken file must not hide the others.
      if (loaded.ok) {
        profiles.push({
          profile: loaded.value.profile,
          file: entry.path,
          mtimeMs: entry.mtimeMs,
          hasComments: loaded.value.hasComments,
        });
      } else {
        invalid.push({
          id,
          file: entry.path,
          message: loaded.error.message,
          ...(loaded.error.detail ? { detail: loaded.error.detail } : {}),
          ...(loaded.line !== undefined ? { line: loaded.line } : {}),
        });
      }
    }
    profiles.sort(
      (a, b) =>
        a.profile.name.localeCompare(b.profile.name) || a.profile.id.localeCompare(b.profile.id)
    );
    invalid.sort((a, b) => a.id.localeCompare(b.id));
    return ok({ profiles, invalid });
  }

  async get(id: string): Promise<Result<Profile>> {
    const loaded = await this.load(id);
    if (!loaded.ok) return loaded;
    return ok(loaded.value.profile);
  }

  /** The last version of a profile that loaded in this session, if any. */
  lastValid(id: string): Profile | undefined {
    const profile = this.valid.get(id);
    return profile ? structuredClone(profile) : undefined;
  }

  /** The profile file as it is on disk, for hand editing or showing. */
  async readRaw(id: string): Promise<Result<string>> {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))
      return err('profile.id', `Invalid profile id: ${id}`);
    return this.files.readText(this.fileFor(id));
  }

  private async load(
    id: string
  ): Promise<
    | { ok: true; value: { profile: Profile; hasComments: boolean } }
    | { ok: false; error: { code: string; message: string; detail?: string }; line?: number }
  > {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))
      return err('profile.id', `Invalid profile id: ${id}`);
    const file = this.fileFor(id);
    if (!(await this.files.exists(file)))
      return err('profile.missing', `There is no profile "${id}".`);
    const text = await this.files.readText(file);
    if (!text.ok) return text;
    let raw: unknown;
    try {
      raw = yaml.load(text.value);
    } catch (e) {
      const mark = (e as { mark?: { line?: number } }).mark;
      const reason = (e as { reason?: string }).reason ?? String(e);
      const line = typeof mark?.line === 'number' ? mark.line + 1 : undefined;
      return {
        ...err(
          'profile.yaml',
          `The profile file ${path.basename(file)} is not valid YAML.`,
          line !== undefined ? `Line ${line}: ${reason}` : reason
        ),
        ...(line !== undefined ? { line } : {}),
      };
    }
    const parsed = ProfileSchema.safeParse(migrateProfile(raw));
    if (!parsed.success) {
      return err(
        'profile.invalid',
        `The profile file ${path.basename(file)} is not valid.`,
        z.prettifyError(parsed.error)
      );
    }
    if (parsed.data.id !== id) {
      return err(
        'profile.invalid',
        `The profile file ${path.basename(file)} is not valid.`,
        `Its id "${parsed.data.id}" does not match the file name; rename one to match the other.`
      );
    }
    this.valid.set(id, structuredClone(parsed.data));
    return ok({ profile: parsed.data, hasComments: hasYamlComments(text.value) });
  }

  async save(profile: Profile): Promise<Result<Profile>> {
    const parsed = ProfileSchema.safeParse(profile);
    if (!parsed.success) {
      return err('profile.invalid', 'The profile is not valid.', z.prettifyError(parsed.error));
    }
    const text = yaml.dump(parsed.data, { noRefs: true, lineWidth: 120 });
    const written = await this.files.write(this.fileFor(parsed.data.id), text, {
      reason: `Save profile ${parsed.data.name}`,
    });
    if (!written.ok) return written;
    this.valid.set(parsed.data.id, structuredClone(parsed.data));
    return ok(parsed.data);
  }

  async remove(id: string): Promise<Result<void>> {
    const existing = await this.get(id);
    if (!existing.ok && existing.error.code === 'profile.id') return existing;
    // Journaled although it is inside the data root: the Safety page can bring it back.
    const name = existing.ok ? existing.value.name : id;
    const removed = await this.files.remove(this.fileFor(id), {
      reason: `Delete setup "${name}"`,
      journal: true,
    });
    if (!removed.ok) return removed;
    this.valid.delete(id);
    const state = await this.readState();
    if (state.lastProfileId === id) {
      const { lastProfileId: _gone, ...rest } = state;
      await this.writeState(rest);
    }
    return ok(undefined);
  }

  /** An id derived from the name that no existing profile uses. */
  async uniqueId(name: string): Promise<string> {
    const base = slugify(name);
    let candidate = base;
    for (let n = 2; await this.files.exists(this.fileFor(candidate)); n++) {
      candidate = `${base.slice(0, 60)}-${n}`;
    }
    return candidate;
  }

  private get statePath(): string {
    return path.join(this.dataRoot, 'state.json');
  }

  private async readState(): Promise<State> {
    const text = await this.files.readText(this.statePath);
    if (!text.ok) return { lastUsed: {} };
    try {
      const parsed = StateSchema.safeParse(JSON.parse(text.value));
      return parsed.success ? parsed.data : { lastUsed: {} };
    } catch {
      return { lastUsed: {} };
    }
  }

  private async writeState(state: State): Promise<Result<void>> {
    const written = await this.files.write(this.statePath, JSON.stringify(state, null, 2), {
      reason: 'Remember the last used profile',
    });
    return written.ok ? ok(undefined) : written;
  }

  async lastProfileId(): Promise<string | undefined> {
    return (await this.readState()).lastProfileId;
  }

  /** When each profile was last used (ISO), by id. */
  async lastUsed(): Promise<Record<string, string>> {
    return (await this.readState()).lastUsed;
  }

  /** Remembers the profile as the one in use; `at` also records when it was used. */
  async setLastProfileId(id: string, at?: Date): Promise<Result<void>> {
    const state = await this.readState();
    return this.writeState({
      ...state,
      lastProfileId: id,
      lastUsed: at ? { ...state.lastUsed, [id]: at.toISOString() } : state.lastUsed,
    });
  }
}
