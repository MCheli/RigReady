import path from 'node:path';
import type { DisplayLayoutStore } from './displays/layouts';
import { parseJournal } from './files/fileStore';
import type { Logger } from './logger';
import type { Ports } from './ports';
import type { ProfileStore } from './profile/store';
import type { SettingsStore } from './settings';

/**
 * The state of RigReady's own files under the data root (settings, setups, monitor
 * layouts, the change journal): what the Diagnostics page lists, and what the user is
 * told at startup when one of them cannot be read. A damaged file is never silently
 * replaced: it is kept (set aside, or left where it is) and named.
 */

export interface DataFileStatus {
  id: 'settings' | 'profiles' | 'layouts' | 'journal';
  label: string;
  file: string;
  ok: boolean;
  /** One line: "3 setups", or what is wrong. */
  summary: string;
}

export interface DataHealthContext {
  ports: Pick<Ports, 'files' | 'folders'>;
  log: Logger;
  profiles: ProfileStore;
  layouts: DisplayLayoutStore;
  settings: SettingsStore;
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export async function dataFileStatus(ctx: DataHealthContext): Promise<DataFileStatus[]> {
  const dataRoot = ctx.ports.folders.dataRoot();
  const out: DataFileStatus[] = [];

  const settings = await ctx.settings.get();
  out.push({
    id: 'settings',
    label: 'Settings',
    file: ctx.settings.file,
    ok: settings.ok,
    summary: settings.ok
      ? (await ctx.ports.files.exists(ctx.settings.file))
        ? 'Readable'
        : 'Not saved yet; defaults are in use'
      : settings.error.message,
  });

  const profiles = await ctx.profiles.listDetailed();
  out.push({
    id: 'profiles',
    label: 'Setups',
    file: ctx.profiles.dir,
    ok: profiles.ok && profiles.value.invalid.length === 0,
    summary: !profiles.ok
      ? profiles.error.message
      : profiles.value.invalid.length === 0
        ? count(profiles.value.profiles.length, 'setup')
        : `${count(profiles.value.profiles.length, 'setup')}; ${count(profiles.value.invalid.length, 'file')} cannot be read (${profiles.value.invalid.map((p) => `${p.id}.yaml`).join(', ')})`,
  });

  const layouts = await ctx.layouts.list();
  out.push({
    id: 'layouts',
    label: 'Monitor layouts',
    file: ctx.layouts.file,
    ok: layouts.ok,
    summary: layouts.ok ? count(layouts.value.length, 'layout') : layouts.error.message,
  });

  const journalFile = path.join(dataRoot, 'journal.jsonl');
  let journal: Omit<DataFileStatus, 'id' | 'label' | 'file'>;
  if (!(await ctx.ports.files.exists(journalFile))) {
    journal = { ok: true, summary: 'No changes recorded yet' };
  } else {
    const text = await ctx.ports.files.readText(journalFile);
    if (!text.ok) {
      journal = { ok: false, summary: text.error.message };
    } else {
      const lines = parseJournal(text.value);
      const damaged = lines.filter((line) => !line.record).length;
      const entries = lines.filter((line) => line.record && !('undo' in line.record)).length;
      journal =
        damaged === 0
          ? { ok: true, summary: count(entries, 'change') }
          : {
              ok: false,
              summary: `${count(entries, 'change')}; ${count(damaged, 'line')} cannot be read`,
            };
    }
  }
  out.push({ id: 'journal', label: 'Change journal', file: journalFile, ...journal });
  return out;
}

/**
 * Run once at startup, after the settings were loaded: recovers what can be recovered
 * and returns what the user should be told. Never throws; the app starts whatever the
 * data folder looks like.
 */
export async function startupNotices(ctx: DataHealthContext): Promise<string[]> {
  const notices: string[] = [];
  try {
    const recovered = await ctx.layouts.recover();
    const layoutsReported = !recovered.ok;
    if (!recovered.ok) {
      notices.push(
        `The saved monitor layouts could not be read. ${recovered.error.message} ${recovered.error.detail ?? ''}`.trim()
      );
    } else if (recovered.value) {
      notices.push(recovered.value);
    }
    for (const status of await dataFileStatus(ctx)) {
      if (status.ok) continue;
      if (status.id === 'profiles') {
        notices.push(
          `Some setup files could not be read: ${status.summary}. They are listed under Configure > Setups, where each can be fixed or deleted.`
        );
      } else if (status.id === 'journal') {
        notices.push(
          `Part of the change journal could not be read (${status.summary}). The changes that can be read can still be undone under Configure > Safety; the file ${status.file} was left as it is.`
        );
      } else if (status.id === 'layouts' && !layoutsReported) {
        notices.push(`The saved monitor layouts could not be read. ${status.summary}`);
      }
      // Settings: the shell reports those itself (it needs them before anything else).
    }
  } catch (e) {
    ctx.log.error('checking the data files failed', e);
    notices.push('RigReady could not check its own data files; the log has the details.');
  }
  for (const notice of notices) ctx.log.warn(notice);
  return notices;
}
