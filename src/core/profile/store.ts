import path from 'node:path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import type { FileStore } from '../ports';
import { err, ok, type Result } from '../result';
import { ProfileSchema, slugify, type Profile } from './schema';

const StateSchema = z.object({ lastProfileId: z.string().optional() });
type State = z.infer<typeof StateSchema>;

/** Profiles as YAML files under <data root>/profiles, one file per profile. */
export class ProfileStore {
  constructor(
    private readonly files: FileStore,
    private readonly dataRoot: string
  ) {}

  private get dir(): string {
    return path.join(this.dataRoot, 'profiles');
  }

  private fileFor(id: string): string {
    return path.join(this.dir, `${id}.yaml`);
  }

  async list(): Promise<Result<Profile[]>> {
    const names = await this.files.list(this.dir);
    if (!names.ok) return names;
    const profiles: Profile[] = [];
    for (const name of names.value) {
      if (!name.endsWith('.yaml')) continue;
      const loaded = await this.get(name.slice(0, -'.yaml'.length));
      // A broken file must not hide the others; get() reports it when asked directly.
      if (loaded.ok) profiles.push(loaded.value);
    }
    profiles.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return ok(profiles);
  }

  async get(id: string): Promise<Result<Profile>> {
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
      return err('profile.yaml', `The profile file ${file} is not valid YAML.`, String(e));
    }
    const parsed = ProfileSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        'profile.invalid',
        `The profile file ${file} is not valid.`,
        z.prettifyError(parsed.error)
      );
    }
    return ok(parsed.data);
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
    return written.ok ? ok(parsed.data) : written;
  }

  async remove(id: string): Promise<Result<void>> {
    const existing = await this.get(id);
    if (!existing.ok && existing.error.code === 'profile.id') return existing;
    const removed = await this.files.remove(this.fileFor(id), { reason: `Delete profile ${id}` });
    if (!removed.ok) return removed;
    const state = await this.readState();
    if (state.lastProfileId === id) await this.writeState({});
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
    if (!text.ok) return {};
    try {
      const parsed = StateSchema.safeParse(JSON.parse(text.value));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
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

  setLastProfileId(id: string): Promise<Result<void>> {
    return this.writeState({ lastProfileId: id });
  }
}
