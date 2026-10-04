import path from 'node:path';
import type { CheckContext, RunProfile } from '../../../core/checks/registry';
import type { MainContext } from '../../../core/feature';
import { profileExtension, withProfileExtension, type Profile } from '../../../core/profile/schema';
import { err, ok, type Result } from '../../../core/result';
import type {
  DesktopChoice,
  ExportAction,
  ExportState,
  MonitorSetupFileView,
  Overview,
  ScreensPreview,
  ScreensState,
  SimAppProState,
} from '../contract';
import { listAircraft } from './aircraft';
import { dcsPaths, dcsRunning, refuseWhileRunning, type DcsPaths } from './dcsPaths';
import {
  addTool,
  dedupeTool,
  diffLines,
  EXPORT_TOOLS,
  hasTool,
  lineSetChanges,
  parseExportLua,
  removeTool,
  TOOL_INFO,
  type ExportTool,
} from './exportLua';
import {
  evaluateMonitorSetup,
  findSetup,
  listMonitorSetups,
  type MonitorSetupFile,
} from './monitorFiles';
import { describeChange, editOptions, readOptions, type DcsOptions } from './options';
import {
  boundingBox,
  generateSetup,
  MONITOR_SETUP_NAME,
  MONITOR_SETUP_OPTION,
  type DesktopDisplay,
  type Rect,
  type ScreenSetup,
} from './screens';
import { aircraftCatalog, importSimAppPro } from './simAppProImport';
import { findSimAppPro, readSimAppProPlan } from './simAppPro';
import { DcsProfileExtensionSchema, type RuntimeFeature } from './simAppProShared';
import { createStateStore, type DcsSetupState, type StateStore } from './state';

export type ServiceContext = Pick<MainContext, 'ports' | 'log' | 'games' | 'profiles' | 'layouts'>;

export const FEATURE_ID = 'dcs-setup';
export const SIMAPPPRO_CHECK = 'dcs.simAppProRunning';
export const START_SIMAPPPRO = 'dcs.startSimAppPro';

const STREAM_DECK_DCS_PLUGIN = ['Elgato', 'StreamDeck', 'Plugins', 'com.ctytler.dcs.sdPlugin'];

/** Every rectangle lies on the monitors: the part covered by some monitor is the whole of it. */
export function covered(rect: Rect, displays: Rect[]): boolean {
  if (rect.width <= 0 || rect.height <= 0) return true;
  let area = 0;
  for (const d of displays) {
    const w = Math.min(rect.x + rect.width, d.x + d.width) - Math.max(rect.x, d.x);
    const h = Math.min(rect.y + rect.height, d.y + d.height) - Math.max(rect.y, d.y);
    if (w > 0 && h > 0) area += w * h;
  }
  return area >= rect.width * rect.height;
}

const describeRect = (r: Rect): string => `${r.width}x${r.height} at ${r.x},${r.y}`;

/**
 * Why a MonitorSetup file does not fit the monitors as they are: each viewport must lie on
 * the monitors (the DCS window opens at 0,0 of the main display), and the window from
 * options.lua must be large enough to hold every viewport.
 */
export function viewportProblems(
  file: Pick<MonitorSetupFile, 'cameras' | 'exports'>,
  options: DcsOptions,
  displays: Rect[]
): string[] {
  const problems: string[] = [];
  const all = [...file.cameras, ...file.exports].filter(
    (v) => v.rect.width > 0 && v.rect.height > 0
  );
  for (const { name, rect } of all) {
    if (!covered(rect, displays)) {
      problems.push(
        `${name} (${describeRect(rect)}) is not on the monitors as they are arranged now`
      );
    }
  }
  if (all.length > 0 && options.width && options.height) {
    const box = boundingBox(all.map((v) => v.rect));
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    if (right > options.width || bottom > options.height) {
      problems.push(
        `DCS's window is ${options.width}x${options.height} (options.lua) but the monitor setup draws up to ${right}x${bottom}`
      );
    }
  }
  return problems;
}

/** Monitors the saved screen setup uses that are no longer where it was made for them. */
export function desktopDrift(setup: ScreenSetup, current: DesktopDisplay[]): string[] {
  const used = new Set([
    ...setup.mainDisplayIds,
    ...setup.aircraft.flatMap((a) => a.placements.map((p) => p.displayId)),
  ]);
  const problems: string[] = [];
  for (const want of setup.desktop.filter((d) => used.has(d.id))) {
    const have = current.find((d) => d.id === want.id);
    const label = want.name || 'A monitor';
    if (!have) problems.push(`${label} is off or not connected`);
    else if (
      have.x !== want.x ||
      have.y !== want.y ||
      have.width !== want.width ||
      have.height !== want.height
    ) {
      problems.push(
        `${label} is ${describeRect(have)}; the screen setup was made for ${describeRect(want)}`
      );
    }
  }
  return problems;
}

export interface ManagedFileStatus {
  label: string;
  path: string;
  status: 'unchanged' | 'changed' | 'notManaged' | 'missing';
  details: string[];
}

export class DcsSetupService {
  readonly store: StateStore;

  constructor(private readonly ctx: ServiceContext) {
    this.store = createStateStore(ctx.ports.files, ctx.ports.folders.dataRoot());
  }

  /** The setup this instance works for, when a check or fix of a setup is running. */
  private profile: RunProfile | undefined;

  private get check(): CheckContext {
    return {
      ports: this.ctx.ports,
      log: this.ctx.log,
      ...(this.profile ? { profile: this.profile } : {}),
    };
  }

  /**
   * The service for one setup's check or fix: when the setup names the DCS install it
   * uses, every path is that install's. Configure pages use the service as it is (the
   * first install found).
   */
  for(ctx: CheckContext): DcsSetupService {
    if (ctx.profile?.game !== 'dcs' || !ctx.profile.install) return this;
    const scoped = Object.create(this) as DcsSetupService;
    scoped.profile = ctx.profile;
    return scoped;
  }

  paths(): Promise<Result<DcsPaths>> {
    return dcsPaths(this.check, this.ctx.games);
  }

  async state(): Promise<DcsSetupState> {
    const state = await this.store.read();
    if (!state.ok) this.ctx.log.warn('dcs-setup state unreadable', state.error);
    return state.ok ? state.value : { schemaVersion: 1, exportTools: [] };
  }

  private async readText(file: string): Promise<string | undefined> {
    if (!(await this.ctx.ports.files.exists(file))) return undefined;
    const text = await this.ctx.ports.files.readText(file);
    return text.ok ? text.value : undefined;
  }

  /** Enabled monitors as they are now. */
  async currentDesktop(): Promise<DesktopDisplay[]> {
    const layout = await this.ctx.ports.displays.read();
    if (!layout.ok) return [];
    return layout.value.displays
      .filter((d) => d.enabled && d.width > 0 && d.height > 0)
      .map((d) => ({
        id: d.id,
        name: d.name,
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
        rotation: d.rotation,
        primary: d.primary,
      }));
  }

  async options(
    paths: DcsPaths
  ): Promise<{ options?: DcsOptions; text?: string; problem?: string }> {
    const text = await this.readText(paths.options);
    if (text === undefined) {
      return { problem: 'options.lua does not exist yet. DCS creates it the first time it runs.' };
    }
    const options = readOptions(text);
    return options.ok ? { options: options.value, text } : { text, problem: options.error.message };
  }

  private author(file: MonitorSetupFile): MonitorSetupFileView['author'] {
    if (file.folder === 'user' && file.stem.toLowerCase() === MONITOR_SETUP_OPTION)
      return 'rigready';
    if (/winwing/i.test(`${file.name} ${file.description}`)) return 'simapppro';
    return file.folder === 'install' ? 'dcs' : 'other';
  }

  async monitorFiles(
    paths: DcsPaths,
    options: DcsOptions | undefined
  ): Promise<MonitorSetupFileView[]> {
    const desktop = await this.currentDesktop();
    const files = await listMonitorSetups(
      this.check,
      { user: paths.userDir, ...(paths.install ? { install: paths.install.installDir } : {}) },
      {
        screen: {
          width:
            options?.width ??
            boundingBox(desktop.length ? desktop : [{ x: 0, y: 0, width: 1, height: 1 }]).width,
          height: options?.height ?? 1,
        },
        displays: desktop,
      }
    );
    return files.map((f) => ({ ...f, author: this.author(f) }));
  }

  /** The active monitor setup and what is wrong with it on the monitors as they are now. */
  async activeMonitorSetup(): Promise<Result<Overview['monitorSetup'] & { options?: DcsOptions }>> {
    const paths = await this.paths();
    if (!paths.ok) return paths;
    const { options, problem } = await this.options(paths.value);
    if (!options) return err('dcs.options', problem ?? 'options.lua is not readable.');
    const option = options.multiMonitorSetup;
    const files = await this.monitorFiles(paths.value, options);
    const file = findSetup(files, option) as MonitorSetupFileView | undefined;
    const problems: string[] = [];
    const rigReady = file?.author === 'rigready';
    if (option && !file) {
      problems.push(
        `options.lua selects the monitor setup "${option}", but there is no MonitorSetup file with that name`
      );
    } else if (file?.error) {
      problems.push(`${file.stem}.lua could not be read: ${file.error}`);
    } else if (file) {
      const desktop = await this.currentDesktop();
      problems.push(...viewportProblems(file, options, desktop));
      const state = await this.state();
      if (rigReady && state.screens) problems.push(...desktopDrift(state.screens, desktop));
    }
    return ok({
      ...(option ? { option } : {}),
      ...(file ? { file } : {}),
      rigReady,
      problems: [...new Set(problems)],
      options,
    });
  }

  // ---------------------------------------------------------------- overview

  async overview(): Promise<Overview> {
    const running = await dcsRunning(this.check);
    const simAppPro = await findSimAppPro(this.check);
    const base: Overview = {
      found: false,
      installs: [],
      userFolders: [],
      aircraft: [],
      monitorSetup: { rigReady: false, problems: [] },
      exportLua: {
        exists: false,
        tools: [],
        unknown: 0,
        changedOutside: false,
        streamDeckNeedsExportScript: false,
      },
      simAppPro: {
        installed: simAppPro.installed,
        ...(simAppPro.version ? { version: simAppPro.version } : {}),
        running: simAppPro.running,
        planFound: simAppPro.planPath !== undefined,
      },
      managedChanged: [],
      dcsRunning: running,
    };
    const paths = await this.paths();
    if (!paths.ok) return { ...base, problem: paths.error.message };
    const dcs = this.ctx.games.get('dcs')!;
    const installs: Overview['installs'] = [];
    for (const install of paths.value.installs) {
      const version = dcs.installedVersion
        ? await dcs.installedVersion(this.check, install)
        : undefined;
      installs.push({
        source: install.source,
        installDir: install.installDir,
        ...(install.userDir ? { userDir: install.userDir } : {}),
        ...(install.launch ? { launch: install.launch } : {}),
        ...(version?.ok
          ? {
              version: version.value.version,
              ...(version.value.updatePending !== undefined
                ? { updatePending: version.value.updatePending }
                : {}),
            }
          : version
            ? { versionProblem: version.error.message }
            : {}),
      });
    }
    const locations = await dcs.configLocations(this.check);
    const userFolders = (locations.ok ? locations.value : []).map((l) => ({
      label: l.label,
      path: l.path,
      orphaned: !paths.value.installs.some(
        (i) =>
          i.userDir && path.resolve(i.userDir).toLowerCase() === path.resolve(l.path).toLowerCase()
      ),
    }));
    const { options, problem: optionsProblem } = await this.options(paths.value);
    const active = await this.activeMonitorSetup();
    const exportState = await this.exportState();
    const managed = await this.managedStatus();
    const state = await this.state();
    const lastRun = await this.lastRun(paths.value);
    return {
      ...base,
      found: true,
      installs,
      userFolders,
      ...(lastRun ? { lastRun } : {}),
      ...(state.verified ? { verified: state.verified } : {}),
      aircraft: await listAircraft(
        this.check,
        paths.value.install?.installDir,
        paths.value.userDir
      ),
      ...(options ? { options } : {}),
      ...(optionsProblem ? { optionsProblem } : {}),
      monitorSetup: active.ok
        ? {
            ...(active.value.option ? { option: active.value.option } : {}),
            ...(active.value.file ? { file: active.value.file } : {}),
            rigReady: active.value.rigReady,
            problems: active.value.problems,
          }
        : { rigReady: false, problems: [] },
      exportLua: {
        exists: exportState.exists,
        tools: exportState.tools.filter((t) => t.active + t.disabled > 0),
        unknown: exportState.unknown,
        changedOutside: exportState.changedOutside !== undefined,
        streamDeckNeedsExportScript:
          exportState.streamDeckDcsPlugin &&
          !exportState.tools.some((t) => t.tool === 'export-script' && t.active > 0),
      },
      managedChanged: managed
        .filter((m) => m.status === 'changed' || m.status === 'missing')
        .map((m) => m.label),
    };
  }

  /** "2.9.28.26283 on 2026-07-26", from the first lines of dcs.log. */
  private async lastRun(paths: DcsPaths): Promise<string | undefined> {
    const text = await this.readText(path.join(paths.userDir, 'Logs', 'dcs.log'));
    if (!text) return undefined;
    const head = text.slice(0, 4000);
    const version = /DCS\/(\d+(?:\.\d+){2,3})/.exec(head)?.[1];
    if (!version) return undefined;
    const date = /Log opened UTC (\d{4}-\d{2}-\d{2})/.exec(head)?.[1];
    return date ? `${version} on ${date}` : version;
  }

  async markVerified(): Promise<Result<{ message: string; changes: string[] }>> {
    const paths = await this.paths();
    if (!paths.ok) return paths;
    const dcs = this.ctx.games.get('dcs')!;
    if (!paths.value.install || !dcs.installedVersion) {
      return err('dcs.version', 'There is no DCS install whose version could be read.');
    }
    const version = await dcs.installedVersion(this.check, paths.value.install);
    if (!version.ok) return version;
    const saved = await this.store.update((s) => ({
      ...s,
      verified: { version: version.value.version, at: this.ctx.ports.clock.now().toISOString() },
    }));
    if (!saved.ok) return saved;
    return ok({ message: `Remembered ${version.value.version} as working`, changes: [] });
  }

  // ---------------------------------------------------------------- screens

  async desktops(): Promise<DesktopChoice[]> {
    const choices: DesktopChoice[] = [];
    const seen = new Set<string>();
    const add = (id: string, label: string, displays: DesktopDisplay[]): void => {
      if (displays.length === 0) return;
      const key = JSON.stringify(displays.map((d) => [d.id, d.x, d.y, d.width, d.height]).sort());
      if (seen.has(key)) return;
      seen.add(key);
      choices.push({ id, label, displays });
    };
    add('current', 'Monitors as they are now', await this.currentDesktop());
    const fromTargets = (
      targets: {
        id: string;
        name?: string;
        enabled: boolean;
        primary?: boolean;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        rotation?: number;
      }[]
    ): DesktopDisplay[] =>
      targets
        .filter((t) => t.enabled && t.width && t.height)
        .map((t) => ({
          id: t.id.toLowerCase(),
          name: t.name ?? '',
          x: t.x ?? 0,
          y: t.y ?? 0,
          width: t.width!,
          height: t.height!,
          rotation: t.rotation ?? 0,
          primary: t.primary ?? false,
        }));
    const profiles = await this.ctx.profiles.list();
    for (const profile of profiles.ok ? profiles.value : []) {
      const layout = profile.checks.find((c) => c.type === 'display.layout');
      const displays = (layout?.params as { displays?: unknown } | undefined)?.displays;
      if (Array.isArray(displays))
        add(
          `profile:${profile.id}`,
          `Layout of the setup "${profile.name}"`,
          fromTargets(displays as never)
        );
    }
    const layouts = await this.ctx.layouts.list();
    for (const layout of layouts.ok ? layouts.value : []) {
      add(`layout:${layout.id}`, `Saved layout "${layout.name}"`, fromTargets(layout.displays));
    }
    return choices;
  }

  async screens(): Promise<ScreensState> {
    const state = await this.state();
    const simAppPro = await findSimAppPro(this.check);
    const desktops = await this.desktops();
    const base = {
      desktops,
      ...(state.screens ? { saved: state.screens } : {}),
      files: [],
      catalog: aircraftCatalog(),
      simAppProPlan: simAppPro.planPath !== undefined,
      dcsRunning: await dcsRunning(this.check),
    };
    const paths = await this.paths();
    if (!paths.ok) {
      return {
        ...base,
        problem: paths.error.message,
        rigReady: { path: '', exists: false, editedOutside: false, selected: false },
      };
    }
    const { options } = await this.options(paths.value);
    const current = await this.readText(paths.value.rigReadyLua);
    let catalog = base.catalog;
    if (simAppPro.planPath) {
      const plan = await readSimAppProPlan(this.check);
      const imported = plan.ok ? importSimAppPro(plan.value, []) : undefined;
      if (imported?.ok) catalog = aircraftCatalog(imported.plan.catalog);
    }
    return {
      ...base,
      catalog,
      files: await this.monitorFiles(paths.value, options),
      ...(options ? { options } : {}),
      rigReady: {
        path: paths.value.rigReadyLua,
        exists: current !== undefined,
        editedOutside: current !== undefined && state.monitorSetup?.text !== current,
        selected: options?.multiMonitorSetup?.toLowerCase() === MONITOR_SETUP_OPTION,
      },
    };
  }

  async importFromSimAppPro(
    desktopId: string
  ): Promise<
    Result<{ setup: ScreenSetup; unmatched: string[]; catalog: ReturnType<typeof aircraftCatalog> }>
  > {
    const desktop = (await this.desktops()).find((d) => d.id === desktopId);
    if (!desktop) return err('dcs.screens.layout', 'That monitor layout is no longer available.');
    const json = await readSimAppProPlan(this.check);
    if (!json.ok) return json;
    const imported = importSimAppPro(json.value, desktop.displays);
    if (!imported.ok) return err('simapppro.plan', imported.message);
    const primary = desktop.displays.find((d) => d.primary) ?? desktop.displays[0]!;
    return ok({
      setup: {
        mainDisplayIds: imported.plan.mainDisplayIds.length
          ? imported.plan.mainDisplayIds
          : [primary.id],
        aircraft: imported.plan.aircraft,
        desktop: desktop.displays,
        desktopLabel: desktop.label,
      },
      unmatched: imported.plan.unmatched,
      catalog: aircraftCatalog(imported.plan.catalog),
    });
  }

  private desiredOptions(
    setup: ReturnType<typeof generateSetup>,
    setResolution: boolean
  ): DcsOptions {
    const { width, height } = setup.window;
    return {
      multiMonitorSetup: MONITOR_SETUP_OPTION,
      ...(setResolution ? { width, height, aspect: width / height, fullScreen: false } : {}),
    };
  }

  async previewScreens(input: {
    setup: ScreenSetup;
    setResolution: boolean;
  }): Promise<Result<ScreensPreview>> {
    const paths = await this.paths();
    if (!paths.ok) return paths;
    const generated = generateSetup(input.setup);
    const current = await this.readText(paths.value.rigReadyLua);
    const state = await this.state();
    const status: ScreensPreview['file']['status'] =
      current === undefined
        ? 'new'
        : current === generated.lua
          ? 'same'
          : state.monitorSetup?.text === current
            ? 'update'
            : 'editedOutside';
    const errors = [...generated.errors];
    let optionChanges: string[] = [];
    const { text, problem } = await this.options(paths.value);
    if (text === undefined || problem) errors.push(problem ?? 'options.lua is not readable.');
    else {
      const edited = editOptions(text, this.desiredOptions(generated, input.setResolution));
      if (edited.ok) optionChanges = edited.value.changes.map(describeChange);
      else errors.push(`options.lua cannot be changed safely: ${edited.error.message}`);
    }
    return ok({
      lua: generated.lua,
      window: generated.window,
      errors,
      warnings: generated.warnings,
      file: {
        path: paths.value.rigReadyLua,
        status,
        diff: diffLines(current ?? '', generated.lua),
      },
      optionChanges,
      dcsRunning: await dcsRunning(this.check),
    });
  }

  /** Writes RigReady.lua and selects it in options.lua: one undoable action, read back before reporting. */
  async applyScreens(input: {
    setup: ScreenSetup;
    setResolution: boolean;
    overwriteEdited: boolean;
  }): Promise<Result<{ message: string; changes: string[] }>> {
    const refused = await refuseWhileRunning(this.check);
    if (!refused.ok) return refused;
    const preview = await this.previewScreens(input);
    if (!preview.ok) return preview;
    if (preview.value.errors.length > 0) {
      return err(
        'dcs.screens.invalid',
        preview.value.errors[0]!,
        preview.value.errors.slice(1).join(' ')
      );
    }
    if (preview.value.file.status === 'editedOutside' && !input.overwriteEdited) {
      return err(
        'dcs.screens.edited',
        `${MONITOR_SETUP_NAME}.lua was changed outside RigReady since RigReady last wrote it. Look at the differences and confirm to replace it.`
      );
    }
    const paths = (await this.paths()) as { ok: true; value: DcsPaths };
    const generated = generateSetup(input.setup);
    const { files } = this.ctx.ports;
    const group = files.beginGroup('Use the RigReady screen setup in DCS');
    const changes: string[] = [];
    if (preview.value.file.status !== 'same') {
      const made = await files.mkdir(paths.value.userMonitorSetups);
      if (!made.ok) return made;
      const written = await files.write(paths.value.rigReadyLua, generated.lua, {
        reason: `Write ${MONITOR_SETUP_NAME}.lua (main view and cockpit displays)`,
        group,
      });
      if (!written.ok) return written;
      changes.push(
        `${preview.value.file.status === 'new' ? 'Created' : 'Updated'} ${MONITOR_SETUP_NAME}.lua`
      );
    }
    const optionsText = await this.readText(paths.value.options);
    const edited = editOptions(
      optionsText ?? '',
      this.desiredOptions(generated, input.setResolution)
    );
    if (!edited.ok) return edited;
    if (edited.value.changes.length > 0) {
      const described = edited.value.changes.map(describeChange);
      const written = await files.write(paths.value.options, edited.value.text, {
        reason: `options.lua: ${described.join('; ')}`,
        group,
      });
      if (!written.ok) return written;
      changes.push(...described.map((d) => `options.lua ${d}`));
    }
    // Read back: report only what is really on disk.
    const lua = await this.readText(paths.value.rigReadyLua);
    const after = readOptions((await this.readText(paths.value.options)) ?? '');
    if (
      lua !== generated.lua ||
      !after.ok ||
      after.value.multiMonitorSetup !== MONITOR_SETUP_OPTION
    ) {
      return err('dcs.screens.verify', 'The files were written but do not read back as expected.');
    }
    const now = this.ctx.ports.clock.now().toISOString();
    const saved = await this.store.update((s) => ({
      ...s,
      screens: input.setup,
      monitorSetup: { path: paths.value.rigReadyLua, text: generated.lua, at: now },
      options: {
        path: paths.value.options,
        multiMonitorSetup: MONITOR_SETUP_OPTION,
        ...(after.value.width !== undefined ? { width: after.value.width } : {}),
        ...(after.value.height !== undefined ? { height: after.value.height } : {}),
        at: now,
      },
    }));
    if (!saved.ok) return saved;
    return ok({
      message: changes.length
        ? 'DCS will use the RigReady screen setup the next time it starts'
        : 'DCS already uses this screen setup; nothing needed changing',
      changes,
    });
  }

  /** Writes the saved screen setup again exactly as it was made (the fix for a changed or deselected file). */
  async rewriteSavedScreens(): Promise<Result<string>> {
    const state = await this.state();
    if (!state.screens)
      return err(
        'dcs.screens.none',
        'There is no RigReady screen setup to write. Make one under Configure > DCS World > Screens.'
      );
    const applied = await this.applyScreens({
      setup: state.screens,
      setResolution: state.options?.width !== undefined,
      overwriteEdited: true,
    });
    return applied.ok
      ? ok(
          applied.value.changes.length
            ? 'Put the RigReady screen setup back in DCS'
            : 'The RigReady screen setup was already in place'
        )
      : applied;
  }

  // ---------------------------------------------------------------- Export.lua

  async exportState(): Promise<ExportState> {
    const paths = await this.paths();
    const simAppPro = await findSimAppPro(this.check);
    const plugin = path.join(this.ctx.ports.folders.appData(), ...STREAM_DECK_DCS_PLUGIN);
    const base = {
      path: '',
      exists: false,
      lines: [],
      tools: [],
      unknown: 0,
      streamDeckDcsPlugin: await this.ctx.ports.files.exists(plugin),
      dcsRunning: await dcsRunning(this.check),
      simAppProRunning: simAppPro.running,
    };
    if (!paths.ok) return { ...base, problem: paths.error.message };
    const text = await this.readText(paths.value.exportLua);
    const parsed = parseExportLua(text ?? '');
    const tools: ExportState['tools'] = [];
    for (const tool of EXPORT_TOOLS) {
      const use = parsed.tools.find((t) => t.tool === tool);
      tools.push({
        tool,
        name: TOOL_INFO[tool].name,
        purpose: TOOL_INFO[tool].purpose,
        active: use?.active ?? 0,
        disabled: use?.disabled ?? 0,
        installed: await this.toolInstalled(paths.value, tool),
      });
    }
    const state = await this.state();
    let changedOutside: ExportState['changedOutside'];
    if (state.exportLua && text !== undefined && state.exportLua.text !== text) {
      const changes = lineSetChanges(state.exportLua.text, text);
      if (changes.added.length || changes.removed.length)
        changedOutside = { ...changes, at: state.exportLua.at };
    } else if (state.exportLua && text === undefined) {
      changedOutside = {
        added: [],
        removed: lineSetChanges(state.exportLua.text, '').removed,
        at: state.exportLua.at,
      };
    }
    return {
      ...base,
      path: paths.value.exportLua,
      exists: text !== undefined,
      lines: parsed.lines.map((l) => ({
        index: l.index,
        text: l.text,
        eol: l.eol,
        ...(l.tool ? { tool: l.tool } : {}),
        helper: l.helperFor !== undefined,
        disabled: l.disabled,
      })),
      tools,
      unknown: parsed.unknown.length,
      ...(changedOutside ? { changedOutside } : {}),
    };
  }

  async toolInstalled(paths: DcsPaths, tool: ExportTool): Promise<boolean> {
    for (const script of TOOL_INFO[tool].scripts) {
      if (await this.ctx.ports.files.exists(path.join(paths.userDir, ...script.split('/'))))
        return true;
    }
    return false;
  }

  /** The text Export.lua would have after an action, or why the action is not possible. */
  private async exportAfter(
    paths: DcsPaths,
    action: ExportAction
  ): Promise<Result<{ before: string; after: string; what: string }>> {
    const before = (await this.readText(paths.exportLua)) ?? '';
    if (action.kind === 'restore') {
      const state = await this.state();
      if (!state.exportLua)
        return err(
          'dcs.export.noBaseline',
          'RigReady has not written Export.lua before, so there is nothing to put back.'
        );
      let after = before;
      const missing = state.exportTools.filter((t) => !hasTool(parseExportLua(before), t));
      for (const tool of missing) after = addTool(after, tool);
      return ok({
        before,
        after,
        what: missing.length
          ? `Put back ${missing.map((t) => TOOL_INFO[t].name).join(', ')}`
          : 'Nothing to put back',
      });
    }
    const info = TOOL_INFO[action.tool];
    if (action.kind === 'add') {
      if (!(await this.toolInstalled(paths, action.tool))) {
        return err(
          'dcs.export.notInstalled',
          `${info.name} is not installed: ${info.scripts[0]} is not in ${paths.userDir}. Install ${info.name} first; RigReady then adds its line.`,
          'A line that loads a missing script stops every tool listed after it.'
        );
      }
      return ok({ before, after: addTool(before, action.tool), what: `Add ${info.name}` });
    }
    if (action.kind === 'remove')
      return ok({ before, after: removeTool(before, action.tool), what: `Remove ${info.name}` });
    return ok({
      before,
      after: dedupeTool(before, action.tool),
      what: `Remove duplicate ${info.name} lines`,
    });
  }

  async previewExport(
    action: ExportAction
  ): Promise<Result<{ diff: ReturnType<typeof diffLines>; changed: boolean }>> {
    const paths = await this.paths();
    if (!paths.ok) return paths;
    const change = await this.exportAfter(paths.value, action);
    if (!change.ok) return change;
    return ok({
      diff: diffLines(change.value.before, change.value.after),
      changed: change.value.before !== change.value.after,
    });
  }

  async applyExport(action: ExportAction): Promise<Result<{ message: string; changes: string[] }>> {
    const refused = await refuseWhileRunning(this.check);
    if (!refused.ok) return refused;
    const paths = await this.paths();
    if (!paths.ok) return paths;
    const change = await this.exportAfter(paths.value, action);
    if (!change.ok) return change;
    const { before, after, what } = change.value;
    if (after !== before) {
      const written = await this.ctx.ports.files.write(paths.value.exportLua, after, {
        reason: `Export.lua: ${what}`,
      });
      if (!written.ok) return written;
      if ((await this.readText(paths.value.exportLua)) !== after) {
        return err(
          'dcs.export.verify',
          'Export.lua was written but does not read back as expected.'
        );
      }
    }
    await this.rememberExport(paths.value, after);
    return ok({
      message:
        after !== before
          ? `Export.lua: ${what}`
          : 'Export.lua already had what was asked; nothing changed',
      changes: [],
    });
  }

  private async rememberExport(paths: DcsPaths, text: string): Promise<void> {
    const parsed = parseExportLua(text);
    await this.store.update((s) => ({
      ...s,
      exportLua: { path: paths.exportLua, text, at: this.ctx.ports.clock.now().toISOString() },
      exportTools: EXPORT_TOOLS.filter((t) => hasTool(parsed, t)),
    }));
  }

  async acceptExport(): Promise<Result<{ message: string; changes: string[] }>> {
    const paths = await this.paths();
    if (!paths.ok) return paths;
    const text = (await this.readText(paths.value.exportLua)) ?? '';
    await this.rememberExport(paths.value, text);
    return ok({
      message: 'RigReady now treats Export.lua as it is as the version to keep',
      changes: [],
    });
  }

  /** Adds the lines of the given tools that are missing. Fails, naming them, for tools that are not installed. */
  async repairExport(tools: ExportTool[]): Promise<Result<string>> {
    const refused = await refuseWhileRunning(this.check);
    if (!refused.ok) return refused;
    const paths = await this.paths();
    if (!paths.ok) return paths;
    const before = (await this.readText(paths.value.exportLua)) ?? '';
    const missing = tools.filter((t) => !hasTool(parseExportLua(before), t));
    const notInstalled: ExportTool[] = [];
    let after = before;
    for (const tool of missing) {
      if (await this.toolInstalled(paths.value, tool)) after = addTool(after, tool);
      else notInstalled.push(tool);
    }
    if (after !== before) {
      const added = missing.filter((t) => !notInstalled.includes(t)).map((t) => TOOL_INFO[t].name);
      const written = await this.ctx.ports.files.write(paths.value.exportLua, after, {
        reason: `Export.lua: add ${added.join(', ')}`,
      });
      if (!written.ok) return written;
      if ((await this.readText(paths.value.exportLua)) !== after) {
        return err(
          'dcs.export.verify',
          'Export.lua was written but does not read back as expected.'
        );
      }
      await this.rememberExport(paths.value, after);
    }
    if (notInstalled.length > 0) {
      const names = notInstalled.map((t) => TOOL_INFO[t].name).join(', ');
      return err(
        'dcs.export.notInstalled',
        `${names} ${notInstalled.length === 1 ? 'is' : 'are'} not installed in Saved Games; install ${notInstalled.length === 1 ? 'it' : 'them'} first.`
      );
    }
    return ok(
      after !== before
        ? `Added ${missing.map((t) => TOOL_INFO[t].name).join(', ')} to Export.lua`
        : 'Export.lua already loads every tool'
    );
  }

  // ---------------------------------------------------------------- managed files

  async managedStatus(): Promise<ManagedFileStatus[]> {
    const state = await this.state();
    const out: ManagedFileStatus[] = [];
    const paths = await this.paths();
    if (state.monitorSetup) {
      const now = await this.readText(state.monitorSetup.path);
      const lines =
        now === undefined
          ? []
          : diffLines(state.monitorSetup.text, now).filter((d) => d.kind !== 'same');
      out.push({
        label: `${MONITOR_SETUP_NAME}.lua`,
        path: state.monitorSetup.path,
        status:
          now === undefined ? 'missing' : now === state.monitorSetup.text ? 'unchanged' : 'changed',
        details:
          now === undefined
            ? ['The file was deleted']
            : lines.slice(0, 8).map((d) => `${d.kind === 'added' ? '+' : 'âˆ’'} ${d.text.trim()}`),
      });
    }
    if (state.options) {
      const now = readOptions((await this.readText(state.options.path)) ?? '');
      const details: string[] = [];
      if (!now.ok) details.push('options.lua is missing or not readable');
      else {
        const o = now.value;
        if (
          (o.multiMonitorSetup ?? '').toLowerCase() !==
          state.options.multiMonitorSetup.toLowerCase()
        ) {
          details.push(
            `Monitor setup is "${o.multiMonitorSetup ?? ''}"; RigReady set "${state.options.multiMonitorSetup}"`
          );
        }
        if (
          state.options.width !== undefined &&
          (o.width !== state.options.width || o.height !== state.options.height)
        ) {
          details.push(
            `Resolution is ${o.width}x${o.height}; RigReady set ${state.options.width}x${state.options.height}`
          );
        }
      }
      out.push({
        label: 'options.lua',
        path: state.options.path,
        status: details.length ? 'changed' : 'unchanged',
        details,
      });
    }
    if (state.exportLua) {
      const now = await this.readText(state.exportLua.path);
      const changes = lineSetChanges(state.exportLua.text, now ?? '');
      const missingTools = state.exportTools.filter((t) => !hasTool(parseExportLua(now ?? ''), t));
      out.push({
        label: 'Export.lua',
        path: state.exportLua.path,
        status: now === undefined ? 'missing' : missingTools.length ? 'changed' : 'unchanged',
        details: [
          ...missingTools.map((t) => `${TOOL_INFO[t].name} is no longer loaded`),
          ...(missingTools.length ? [] : changes.added.map((l) => `+ ${l}`)),
        ],
      });
    }
    if (out.length === 0 && paths.ok) {
      out.push({
        label: 'DCS files',
        path: paths.value.userDir,
        status: 'notManaged',
        details: [],
      });
    }
    return out;
  }

  /** Puts back what RigReady last wrote: RigReady.lua, the options.lua keys it set, the Export.lua tools it added. */
  async restoreManaged(): Promise<Result<string>> {
    const refused = await refuseWhileRunning(this.check);
    if (!refused.ok) return refused;
    const state = await this.state();
    const { files } = this.ctx.ports;
    const group = files.beginGroup('Restore the DCS files RigReady manages');
    const done: string[] = [];
    if (
      state.monitorSetup &&
      (await this.readText(state.monitorSetup.path)) !== state.monitorSetup.text
    ) {
      await files.mkdir(path.dirname(state.monitorSetup.path));
      const written = await files.write(state.monitorSetup.path, state.monitorSetup.text, {
        reason: `Restore RigReady's ${MONITOR_SETUP_NAME}.lua`,
        group,
      });
      if (!written.ok) return written;
      done.push(`${MONITOR_SETUP_NAME}.lua`);
    }
    if (state.options) {
      const text = await this.readText(state.options.path);
      if (text !== undefined) {
        const edited = editOptions(text, {
          multiMonitorSetup: state.options.multiMonitorSetup,
          ...(state.options.width !== undefined && state.options.height !== undefined
            ? {
                width: state.options.width,
                height: state.options.height,
                aspect: state.options.width / state.options.height,
              }
            : {}),
        });
        if (!edited.ok) return edited;
        if (edited.value.changes.length) {
          const written = await files.write(state.options.path, edited.value.text, {
            reason: `options.lua: ${edited.value.changes.map(describeChange).join('; ')}`,
            group,
          });
          if (!written.ok) return written;
          done.push('options.lua');
        }
      }
    }
    if (state.exportLua) {
      const before = (await this.readText(state.exportLua.path)) ?? '';
      let after = before;
      for (const tool of state.exportTools) after = addTool(after, tool);
      if (after !== before) {
        const written = await files.write(state.exportLua.path, after, {
          reason: 'Export.lua: put back the tools RigReady added',
          group,
        });
        if (!written.ok) return written;
        done.push('Export.lua');
      }
      // Lines other tools added since are kept and become part of what is expected.
      await this.store.update((s) => ({
        ...s,
        exportLua: {
          ...state.exportLua!,
          text: after,
          at: this.ctx.ports.clock.now().toISOString(),
        },
      }));
    }
    return ok(
      done.length ? `Restored RigReady's version of ${done.join(', ')}` : 'Nothing needed restoring'
    );
  }

  // ---------------------------------------------------------------- SimAppPro

  async simAppProState(): Promise<SimAppProState> {
    const info = await findSimAppPro(this.check);
    const profiles = await this.ctx.profiles.list();
    return {
      installed: info.installed,
      ...(info.version ? { version: info.version } : {}),
      running: info.running,
      planFound: info.planPath !== undefined,
      profiles: (profiles.ok ? profiles.value : [])
        .filter((p) => p.game === 'dcs')
        .map((p) => ({ id: p.id, name: p.name, features: this.runtimeFeatures(p) })),
      managed: await this.managedStatus(),
    };
  }

  runtimeFeatures(profile: Profile): RuntimeFeature[] {
    return profileExtension(profile, FEATURE_ID, DcsProfileExtensionSchema)?.winwingRuntime ?? [];
  }

  /**
   * Records which WinWing runtime features a setup uses, and gives it a "SimAppPro running"
   * check exactly when it uses at least one.
   */
  async setRuntimeFeatures(
    profileId: string,
    features: RuntimeFeature[]
  ): Promise<Result<{ message: string; changes: string[] }>> {
    const profile = await this.ctx.profiles.get(profileId);
    if (!profile.ok) return profile;
    const unique = [...new Set(features)];
    const existing = profileExtension(profile.value, FEATURE_ID, DcsProfileExtensionSchema) ?? {
      winwingRuntime: [],
    };
    let next = withProfileExtension(profile.value, FEATURE_ID, {
      ...existing,
      winwingRuntime: unique,
    });
    const others = next.checks.filter((c) => c.type !== SIMAPPPRO_CHECK);
    const had = others.length !== next.checks.length;
    next = {
      ...next,
      updatedAt: this.ctx.ports.clock.now().toISOString(),
      checks:
        unique.length === 0
          ? others
          : [
              ...others,
              {
                id:
                  next.checks.find((c) => c.type === SIMAPPPRO_CHECK)?.id ??
                  (others.some((c) => c.id === 'dcs-simapppro')
                    ? `dcs-simapppro-${others.length}`
                    : 'dcs-simapppro'),
                type: SIMAPPPRO_CHECK,
                title: 'SimAppPro running',
                required: true,
                params: { features: unique },
                remediation: { type: START_SIMAPPPRO, params: {} },
              },
            ],
    };
    const saved = await this.ctx.profiles.save(next);
    if (!saved.ok) return saved;
    const message =
      unique.length > 0
        ? `"${profile.value.name}" ${had ? 'still checks' : 'now checks'} that SimAppPro is running`
        : had
          ? `"${profile.value.name}" no longer checks for SimAppPro`
          : `"${profile.value.name}" does not need SimAppPro`;
    return ok({ message, changes: [] });
  }

  /** Re-reads a monitor setup for one unit type (per-aircraft overrides), for tests and the editor. */
  evaluate(text: string, displays: DesktopDisplay[], unit?: string) {
    const box = boundingBox(displays);
    return evaluateMonitorSetup(text, {
      screen: { width: box.width, height: box.height },
      displays,
      ...(unit ? { unit } : {}),
    });
  }
}
