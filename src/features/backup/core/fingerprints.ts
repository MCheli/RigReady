import path from 'node:path';
import { z } from 'zod';
import { sha256 } from '../../../core/files/fileStore';
import type { GameModule } from '../../../core/games';
import { JsonStore } from '../../../core/jsonStore';
import { collapsePath } from '../../../core/pathVariables';
import { ok, type Result } from '../../../core/result';
import { resolveTrackedItem } from '../../../core/tracked';
import { BlobStore } from './blobs';
import { compareFiles, type Comparison, type CurrentFile, type RecordedFile } from './compare';
import { isText } from './diff';
import { itemsForProfile, pathVariables, type Ctx } from './store';

/** Text files up to this size keep their content, so "what changed" can show the lines. */
const KEEP_TEXT_BYTES = 1024 * 1024;

const FingerprintSchema = z.object({
  time: z.string(),
  /** "Launched DCS.exe", "Marked as working". */
  reason: z.string(),
  files: z.array(
    z.object({ key: z.string(), sha256: z.string(), size: z.number().int(), stored: z.boolean() })
  ),
});
export type Fingerprint = z.infer<typeof FingerprintSchema>;

const FileSchema = z.object({ profiles: z.record(z.string(), FingerprintSchema).default({}) });

export const fingerprintStore = (ctx: Pick<Ctx, 'ports'>) =>
  new JsonStore(
    ctx.ports.files,
    path.join(ctx.ports.folders.dataRoot(), 'backup', 'fingerprints.json'),
    FileSchema
  );

/** Every tracked file of a setup as it is now, keyed by its stored path. */
async function currentFiles(
  ctx: Ctx,
  profileId: string
): Promise<Result<{ files: CurrentFile[]; items: number }>> {
  const refs = await itemsForProfile(ctx, profileId);
  if (!refs.ok) return refs;
  const variables = await pathVariables(ctx);
  const files = new Map<string, CurrentFile>();
  for (const { item } of refs.value) {
    const resolved = await resolveTrackedItem(ctx.ports.files, item, variables);
    for (const file of resolved.files) {
      const key = collapsePath(file.path, variables).replace(/\\/g, '/');
      files.set(key.toLowerCase(), { key, path: file.path });
    }
  }
  return ok({ files: [...files.values()], items: refs.value.length });
}

/** Records the tracked files of a setup as "the last time it worked". */
export async function recordFingerprint(
  ctx: Ctx,
  profileId: string,
  reason: string
): Promise<Result<{ time: string; fileCount: number }>> {
  const current = await currentFiles(ctx, profileId);
  if (!current.ok) return current;
  const blobs = new BlobStore(ctx.ports.files, ctx.ports.folders.dataRoot());
  const files: RecordedFile[] = [];
  for (const file of current.value.files) {
    const bytes = await ctx.ports.files.readBytes(file.path);
    if (!bytes.ok) continue;
    const keep = bytes.value.length <= KEEP_TEXT_BYTES && isText(bytes.value);
    const hash = keep ? await blobs.put(bytes.value) : ok(sha256(bytes.value));
    if (!hash.ok) return hash;
    files.push({ key: file.key, sha256: hash.value, size: bytes.value.length, stored: keep });
  }
  const time = ctx.ports.clock.now().toISOString();
  const saved = await fingerprintStore(ctx).update((all) => ({
    profiles: { ...all.profiles, [profileId]: { time, reason, files } },
  }));
  if (!saved.ok) return saved;
  ctx.log.info(`recorded the files of ${profileId} as working`, { reason, files: files.length });
  return ok({ time, fileCount: files.length });
}

export interface ChangesView {
  profileId: string;
  trackedItems: number;
  knownGood?: { time: string; reason: string; fileCount: number };
  comparison?: Comparison;
}

/** What differs now from the last time the setup worked. */
export async function changesSinceWorked(
  ctx: Ctx,
  profileId: string
): Promise<Result<ChangesView>> {
  const profile = await ctx.profiles.get(profileId);
  if (!profile.ok) return profile;
  const current = await currentFiles(ctx, profileId);
  if (!current.ok) return current;
  const all = await fingerprintStore(ctx).read();
  if (!all.ok) return all;
  const known = all.value.profiles[profileId];
  if (!known) return ok({ profileId, trackedItems: current.value.items });
  const comparison = await compareFiles(
    (file) => ctx.ports.files.readBytes(file),
    new BlobStore(ctx.ports.files, ctx.ports.folders.dataRoot()),
    known.files,
    current.value.files
  );
  return ok({
    profileId,
    trackedItems: current.value.items,
    knownGood: { time: known.time, reason: known.reason, fileCount: known.files.length },
    comparison,
  });
}

const exeName = (exe: string): string => path.win32.basename(exe).toLowerCase();

/**
 * Notices a game starting, however it was started (RigReady's Launch, Steam, a desktop
 * shortcut), and records the tracked files of the setup it belongs to as working. A
 * setup belongs to a program when its launch target is that program or its game
 * module's install starts it. When several setups match, the last used one wins.
 */
export class LaunchWatcher {
  private running: Set<string> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  /** Lower-case process name -> as Windows reports it, for messages. */
  private names = new Map<string, string>();
  /** Programs each game module's installs start, looked up at most once a minute. */
  private gameExes = new Map<string, { at: number; exes: string[] }>();

  constructor(
    private readonly ctx: Ctx,
    private readonly onRecorded: (profileId: string) => void = () => {}
  ) {}

  start(intervalMs: number): void {
    this.timer = setInterval(() => void this.poll(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One look at the running programs. Resolves with the setups recorded. */
  async poll(): Promise<string[]> {
    if (this.busy) return [];
    this.busy = true;
    try {
      const list = await this.ctx.ports.processes.list();
      if (!list.ok) return [];
      const now = new Set(list.value.map((p) => p.name.toLowerCase()));
      this.names = new Map(list.value.map((p) => [p.name.toLowerCase(), p.name]));
      const before = this.running;
      this.running = now;
      // The first look only learns what is already running.
      if (!before) return [];
      const started = [...now].filter((name) => !before.has(name));
      if (started.length === 0) return [];
      return await this.record(started);
    } finally {
      this.busy = false;
    }
  }

  private async exesOf(module: GameModule): Promise<string[]> {
    const now = this.ctx.ports.clock.now().getTime();
    const cached = this.gameExes.get(module.id);
    if (cached && now - cached.at < 60_000) return cached.exes;
    const installs = await module.detect(this.ctx);
    const exes = installs.ok
      ? installs.value.flatMap((i) => (i.launch ? [exeName(i.launch.exe)] : []))
      : [];
    this.gameExes.set(module.id, { at: now, exes });
    return exes;
  }

  private async record(started: string[]): Promise<string[]> {
    const profiles = await this.ctx.profiles.list();
    if (!profiles.ok) return [];
    const matches = new Map<string, string>();
    for (const profile of profiles.value) {
      const exes = new Set<string>();
      if (profile.launch) exes.add(exeName(profile.launch.exe));
      const module = profile.game ? this.ctx.games.get(profile.game) : undefined;
      if (module) for (const exe of await this.exesOf(module)) exes.add(exe);
      const hit = started.find((name) => exes.has(name));
      if (hit) matches.set(profile.id, hit);
    }
    if (matches.size === 0) return [];
    const last = await this.ctx.profiles.lastProfileId();
    const chosen = last && matches.has(last) ? [last] : [...matches.keys()];
    const recorded: string[] = [];
    for (const profileId of chosen) {
      const hit = matches.get(profileId)!;
      const name = this.names.get(hit) ?? hit;
      const result = await recordFingerprint(this.ctx, profileId, `Launched ${name}`);
      if (result.ok) {
        recorded.push(profileId);
        this.onRecorded(profileId);
      } else {
        this.ctx.log.warn(`could not record ${profileId} as working`, result.error);
      }
    }
    return recorded;
  }
}
