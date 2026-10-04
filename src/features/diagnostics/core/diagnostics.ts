import os from 'node:os';
import path from 'node:path';
import { dataFileStatus } from '../../../core/dataHealth';
import { appErrors, errorDetails, type ErrorCenter } from '../../../core/errorCenter';
import type { MainContext } from '../../../core/feature';
import { createZip, type ZipEntry } from '../../../core/files/zip';
import {
  createRedactor,
  LOG_FILE_NAME,
  logFile,
  logFolder,
  parseLog,
  parseLogLevel,
  type LogEntry,
  type LogLevel,
} from '../../../core/logger';
import { privacyContext, Scanner } from '../../../core/privacy';
import { err, ok, type Result } from '../../../core/result';
import type { LogView, Overview } from '../contract';

export type Ctx = Pick<
  MainContext,
  'ports' | 'log' | 'games' | 'profiles' | 'settings' | 'layouts'
>;

export interface DiagnosticsOptions {
  appVersion: string;
  env?: NodeJS.ProcessEnv;
  /** process.versions of the running app. */
  versions?: Record<string, string | undefined>;
  errors?: ErrorCenter;
  /** How long one part of the machine may take to answer before it is reported as silent. */
  sectionTimeoutMs?: number;
}

const SECTION_TIMEOUT_MS = 5000;

/** The answer, or an error result when a provider does not answer (a hung driver call). */
async function within<T>(work: Promise<Result<T>>, ms: number, what: string): Promise<Result<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silent = new Promise<Result<T>>((resolve) => {
    timer = setTimeout(
      () => resolve(err('diagnostics.timeout', `${what} did not answer within ${ms / 1000} s.`)),
      ms
    );
  });
  try {
    return await Promise.race([
      work.catch((e: unknown) => err('diagnostics.threw', `${what} failed.`, String(e))),
      silent,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const problem = (error: { message: string; detail?: string }): string =>
  error.detail ? `${error.message} (${error.detail})` : error.message;

export function osDescription(): string {
  return `${os.version()} ${os.release()} (${os.arch()})`;
}

export function effectiveLogLevel(
  setting: LogLevel,
  env: NodeJS.ProcessEnv = process.env
): { level: LogLevel; fixedByEnvironment: boolean } {
  const fromEnv = parseLogLevel(env['RIGREADY_LOG_LEVEL']);
  return fromEnv
    ? { level: fromEnv, fixedByEnvironment: true }
    : { level: setting, fixedByEnvironment: false };
}

export async function readOverview(
  ctx: Ctx,
  options: DiagnosticsOptions
): Promise<Result<Overview>> {
  const ms = options.sectionTimeoutMs ?? SECTION_TIMEOUT_MS;
  const versions = options.versions ?? process.versions;
  const dataRoot = ctx.ports.folders.dataRoot();
  const settings = await ctx.settings.get();

  const games: Overview['games'] = { found: [], notFound: [] };
  for (const module of ctx.games.all()) {
    const detected = await within(module.detect(ctx), ms, module.name);
    if (!detected.ok) {
      games.found.push({
        id: module.id,
        name: module.name,
        installs: [],
        error: problem(detected.error),
      });
    } else if (detected.value.length === 0) {
      games.notFound.push(module.name);
    } else {
      games.found.push({
        id: module.id,
        name: module.name,
        installs: detected.value.map((i) => ({ source: i.source, installDir: i.installDir })),
      });
    }
  }

  const devices: Overview['devices'] = { controllers: [], usbDevices: 0, hubs: 0 };
  const listed = await within(ctx.ports.devices.list(), ms, 'The device list');
  if (!listed.ok) {
    devices.error = problem(listed.error);
  } else {
    devices.usbDevices = listed.value.length;
    devices.hubs = listed.value.filter((d) => d.isHub).length;
    devices.controllers = listed.value
      .filter((d) => !d.isHub && (d.isGameController || d.isHid))
      .map((d) => ({ name: d.name, vendorId: d.vendorId, productId: d.productId }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const monitors: Overview['monitors'] = { list: [] };
  const layout = await within(ctx.ports.displays.read(), ms, 'The monitor list');
  if (!layout.ok) {
    monitors.error = problem(layout.error);
  } else {
    monitors.list = layout.value.displays.map((d) =>
      d.enabled
        ? `${d.name}: ${d.width}x${d.height} at ${d.x},${d.y}${d.rotation ? `, turned ${d.rotation}` : ''}${d.primary ? ', main' : ''}`
        : `${d.name}: off`
    );
  }

  return ok({
    app: {
      version: options.appVersion,
      ...(versions['electron'] ? { electron: versions['electron'] } : {}),
      ...(versions['chrome'] ? { chrome: versions['chrome'] } : {}),
      node: versions['node'] ?? process.version,
      os: osDescription(),
    },
    dataRoot,
    logFolder: logFolder(dataRoot),
    log: effectiveLogLevel(settings.ok ? settings.value.logLevel : 'info', options.env),
    games,
    devices,
    monitors,
    dataFiles: await dataFileStatus(ctx),
  });
}

/** The newest entries of the current log file (and the one before it, when the current one is short). */
export async function readLog(ctx: Ctx, limit: number): Promise<Result<LogView>> {
  const file = logFile(ctx.ports.folders.dataRoot());
  let entries: LogEntry[] = [];
  let exists = false;
  for (const candidate of [`${file}.1`, file]) {
    if (!(await ctx.ports.files.exists(candidate))) continue;
    const text = await ctx.ports.files.readText(candidate);
    if (!text.ok) return text;
    exists = true;
    entries = entries.concat(parseLog(text.value));
  }
  return ok({
    entries: entries.slice(-limit),
    older: Math.max(0, entries.length - limit),
    file,
    exists,
  });
}

export async function setLogLevel(
  ctx: Ctx,
  level: LogLevel,
  env: NodeJS.ProcessEnv = process.env
): Promise<Result<{ level: LogLevel }>> {
  if (parseLogLevel(env['RIGREADY_LOG_LEVEL'])) {
    return err(
      'diagnostics.levelFixed',
      'The log level is set by the RIGREADY_LOG_LEVEL environment variable for this run.'
    );
  }
  const saved = await ctx.settings.update({ logLevel: level });
  if (!saved.ok) return saved;
  return ok({ level: saved.value.logLevel });
}

/**
 * What every text that leaves through Diagnostics goes through: the privacy review's
 * rules with everything removed (personal folders become {VARIABLES}; the Windows user,
 * the machine name, device serials, instance paths and audio ids are replaced), then the
 * log's own masking of secrets.
 */
export async function createScrubber(ctx: Ctx): Promise<(text: string) => string> {
  const scanner = new Scanner(await privacyContext(ctx, ctx.games));
  const redact = createRedactor([ctx.ports.folders.home()]);
  return (text) => redact(scanner.transform(text, 'Diagnostics', 'profile', () => 'remove'));
}

const RECENT_LOG_ENTRIES = 200;

/** The diagnostics as text, already scrubbed. */
export async function diagnosticsText(
  ctx: Ctx,
  options: DiagnosticsOptions
): Promise<Result<string>> {
  const overview = await readOverview(ctx, options);
  if (!overview.ok) return overview;
  const view = overview.value;
  const log = await readLog(ctx, RECENT_LOG_ENTRIES);
  const errors = (options.errors ?? appErrors).all();
  const lines: string[] = [
    'RigReady diagnostics',
    `Created: ${ctx.ports.clock.now().toISOString()}`,
    `RigReady ${view.app.version}` +
      (view.app.electron ? `, Electron ${view.app.electron}` : '') +
      (view.app.chrome ? `, Chromium ${view.app.chrome}` : '') +
      `, Node ${view.app.node}`,
    view.app.os,
    `Data folder: ${view.dataRoot}`,
    `Log level: ${view.log.level}${view.log.fixedByEnvironment ? ' (set by RIGREADY_LOG_LEVEL)' : ''}`,
    '',
    'Games',
  ];
  if (view.games.found.length === 0) lines.push('  None found on this PC.');
  for (const game of view.games.found) {
    if (game.error) lines.push(`  ${game.name}: could not be looked for: ${game.error}`);
    for (const install of game.installs) {
      lines.push(`  ${game.name}: ${install.source}, ${install.installDir}`);
    }
  }
  if (view.games.notFound.length > 0) lines.push(`  Not found: ${view.games.notFound.join(', ')}`);
  lines.push('', 'Game controllers and input devices');
  if (view.devices.error) lines.push(`  Could not be read: ${view.devices.error}`);
  else {
    if (view.devices.controllers.length === 0) lines.push('  None connected.');
    for (const device of view.devices.controllers) {
      lines.push(`  ${device.name} (${device.vendorId}:${device.productId})`);
    }
    lines.push(
      `  ${view.devices.usbDevices} USB devices in all, ${view.devices.hubs} of them hubs`
    );
  }
  lines.push('', 'Monitors');
  if (view.monitors.error) lines.push(`  Could not be read: ${view.monitors.error}`);
  else if (view.monitors.list.length === 0) lines.push('  None.');
  for (const monitor of view.monitors.list) lines.push(`  ${monitor}`);
  lines.push('', "RigReady's own files");
  for (const file of view.dataFiles) {
    lines.push(`  ${file.label}: ${file.ok ? '' : 'PROBLEM: '}${file.summary}`);
  }
  lines.push('', 'Unexpected errors in this run');
  if (errors.length === 0) lines.push('  None.');
  for (const report of errors) {
    lines.push(
      `  ${report.time} ${report.source}: ${report.message}${report.count > 1 ? ` (${report.count} times)` : ''}`
    );
    for (const line of (report.detail ?? '').split('\n').filter(Boolean))
      lines.push(`      ${line}`);
  }
  lines.push('', `Recent log (newest ${RECENT_LOG_ENTRIES} entries at most)`);
  if (!log.ok) lines.push(`  Could not be read: ${problem(log.error)}`);
  else if (log.value.entries.length === 0) lines.push('  Nothing logged yet.');
  else {
    for (const entry of log.value.entries) {
      lines.push(
        `  ${entry.time} ${entry.level.toUpperCase().padEnd(5)} [${entry.scope}] ${entry.text.replace(/\n/g, '\n      ')}`
      );
    }
  }
  const scrub = await createScrubber(ctx);
  return ok(scrub(lines.join('\n')) + '\n');
}

export async function copyDiagnostics(
  ctx: Ctx,
  options: DiagnosticsOptions
): Promise<Result<{ characters: number }>> {
  const text = await diagnosticsText(ctx, options);
  if (!text.ok) return text;
  const copied = await ctx.ports.clipboard.writeText(text.value);
  if (!copied.ok) return copied;
  return ok({ characters: text.value.length });
}

/** Windows' own Explorer. */
function explorer(ctx: Ctx): string {
  return path.join(ctx.ports.folders.windows(), 'explorer.exe');
}

export async function openLogFolder(ctx: Ctx): Promise<Result<{ opened: boolean }>> {
  const folder = logFolder(ctx.ports.folders.dataRoot());
  const made = await ctx.ports.files.mkdir(folder);
  if (!made.ok) return made;
  // An argument array: the path is never part of a command line.
  const started = await ctx.ports.shell.launch(explorer(ctx), [folder]);
  return started.ok ? ok({ opened: true }) : started;
}

export interface ExportOutcome {
  saved: boolean;
  path?: string;
  files: string[];
  bytes: number;
}

/** The entries of the diagnostics zip: the report, every log file and the settings, all scrubbed. */
export async function diagnosticsEntries(
  ctx: Ctx,
  options: DiagnosticsOptions
): Promise<Result<ZipEntry[]>> {
  const text = await diagnosticsText(ctx, options);
  if (!text.ok) return text;
  const scrub = await createScrubber(ctx);
  const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
  const entries: ZipEntry[] = [{ path: 'diagnostics.txt', data: encode(text.value) }];
  const dataRoot = ctx.ports.folders.dataRoot();
  const folder = logFolder(dataRoot);
  const names = await ctx.ports.files.list(folder);
  if (!names.ok) return names;
  for (const name of names.value.filter((n) => n.startsWith(LOG_FILE_NAME))) {
    const content = await ctx.ports.files.readText(path.join(folder, name));
    // A log file that cannot be read is named in the archive instead of failing the export.
    entries.push({
      path: `logs/${name}`,
      data: encode(
        content.ok ? scrub(content.value) : `Could not be read: ${problem(content.error)}\n`
      ),
    });
  }
  if (await ctx.ports.files.exists(ctx.settings.file)) {
    const content = await ctx.ports.files.readText(ctx.settings.file);
    entries.push({
      path: 'settings.json',
      data: encode(
        content.ok ? scrub(content.value) : `Could not be read: ${problem(content.error)}\n`
      ),
    });
  }
  return ok(entries);
}

export async function exportDiagnostics(
  ctx: Ctx,
  options: DiagnosticsOptions
): Promise<Result<ExportOutcome>> {
  const stamp = ctx.ports.clock.now().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const target = await ctx.ports.dialogs.save({
    title: 'Export diagnostics',
    defaultPath: path.join(ctx.ports.folders.documents(), `RigReady-diagnostics-${stamp}.zip`),
    filters: [{ name: 'Zip archive', extensions: ['zip'] }],
  });
  if (!target.ok) return target;
  if (target.value === null) return ok({ saved: false, files: [], bytes: 0 });
  const file = /\.zip$/i.test(target.value) ? target.value : `${target.value}.zip`;
  const entries = await diagnosticsEntries(ctx, options);
  if (!entries.ok) return entries;
  const zipped = createZip(entries.value);
  if (!zipped.ok) return zipped;
  const written = await ctx.ports.files.write(file, zipped.value, { reason: 'Export diagnostics' });
  if (!written.ok) return written;
  ctx.log.info('exported diagnostics', { file, files: entries.value.length });
  return ok({
    saved: true,
    path: file,
    files: entries.value.map((e) => e.path),
    bytes: zipped.value.length,
  });
}

export async function copyError(
  ctx: Ctx,
  id: string,
  options: DiagnosticsOptions
): Promise<Result<{ characters: number }>> {
  const report = (options.errors ?? appErrors).get(id);
  if (!report) return err('diagnostics.noError', 'That error is no longer in the list.');
  const text = errorDetails(report, { version: options.appVersion, os: osDescription() });
  const copied = await ctx.ports.clipboard.writeText(text);
  if (!copied.ok) return copied;
  return ok({ characters: text.length });
}
