import path from 'node:path';
import { z } from 'zod';
import type {
  CaptureCandidate,
  CaptureDefinition,
  CheckDefinition,
  RemediationDefinition,
} from '../../../core/checks/registry';
import { err, ok } from '../../../core/result';
import { dcsRunning } from './dcsPaths';
import { EXPORT_TOOLS, ExportToolSchema, hasTool, parseExportLua, TOOL_INFO } from './exportLua';
import {
  describeChange,
  editOptions,
  OPTION_LABELS,
  readOptions,
  type DcsOptions,
  type OptionKey,
} from './options';
import { boundingBox, MONITOR_SETUP_OPTION } from './screens';
import { findSimAppPro, SIMAPPPRO_EXE } from './simAppPro';
import { RuntimeFeatureSchema, runtimeFeaturePhrase } from './simAppProShared';
import { SIMAPPPRO_CHECK, START_SIMAPPPRO, type DcsSetupService } from './service';

export const DCS_INSTALL = 'dcs.install';
export const DCS_MONITOR_SETUP = 'dcs.monitorSetup';
export const DCS_WRITE_SCREENS = 'dcs.writeScreenSetup';
export const DCS_EXPORT = 'dcs.exportLua';
export const DCS_REPAIR_EXPORT = 'dcs.repairExportLua';
export const DCS_OPTIONS = 'dcs.options';
export const DCS_SET_OPTIONS = 'dcs.setOptions';
export const DCS_MANAGED = 'dcs.managedFiles';
export const DCS_RESTORE_MANAGED = 'dcs.restoreManaged';

const InstallParams = z.object({ installDir: z.string().min(1) });
const MonitorParams = z.object({
  /** The monitor setup (file stem) the profile expects options.lua to select. */
  setup: z.string().optional(),
  /** What the setup's monitors span: DCS's window (options.lua width and height) should be this. */
  window: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .optional(),
});
const ExportParams = z.object({ tools: z.array(ExportToolSchema).min(1) });
export const OptionsParams = z
  .object({
    multiMonitorSetup: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fullScreen: z.boolean().optional(),
    vr: z.boolean().optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'Name at least one option');
const SimAppProParams = z.object({ features: z.array(RuntimeFeatureSchema).min(1) });
const NoParams = z.object({});

const names = (tools: readonly (keyof typeof TOOL_INFO)[]): string =>
  tools.map((t) => TOOL_INFO[t].name).join(', ');

const show = (key: OptionKey, value: unknown): string =>
  value === undefined
    ? 'not set'
    : key === 'vr' || key === 'fullScreen'
      ? value
        ? 'on'
        : 'off'
      : typeof value === 'string'
        ? `"${value}"`
        : String(value);

/** One line per option that is not what the setup expects. */
export function optionDifferences(expected: DcsOptions, actual: DcsOptions): string[] {
  const out: string[] = [];
  for (const key of Object.keys(expected) as OptionKey[]) {
    const want = expected[key];
    if (want === undefined) continue;
    const have = actual[key];
    const same =
      typeof want === 'string' && typeof have === 'string'
        ? want.toLowerCase() === have.toLowerCase()
        : want === have;
    if (!same) out.push(`${OPTION_LABELS[key]} is ${show(key, have)}, expected ${show(key, want)}`);
  }
  return out;
}

/** Injected so tests do not wait in real time. */
export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createDcsChecks(service: DcsSetupService, sleep: Sleep = realSleep) {
  const install: CheckDefinition<z.infer<typeof InstallParams>> = {
    type: DCS_INSTALL,
    group: 'other',
    label: 'DCS World installed',
    params: InstallParams,
    async run(params) {
      const paths = await service.paths();
      const installs = paths.ok ? paths.value.installs : [];
      const found = installs.find(
        (i) =>
          path.resolve(i.installDir).toLowerCase() === path.resolve(params.installDir).toLowerCase()
      );
      if (found) {
        return {
          pass: true,
          summary: `${found.source === 'steam' ? 'Steam edition' : 'Standalone'} at ${found.installDir}`,
        };
      }
      return {
        pass: false,
        summary: 'DCS install not found',
        details: [
          `This setup uses the DCS install at ${params.installDir}, which is gone.`,
          ...(installs.length
            ? [
                `DCS was found at ${installs.map((i) => i.installDir).join(' and ')}; make the setup again to use it.`,
              ]
            : []),
        ],
      };
    },
  };

  const monitorSetup: CheckDefinition<z.infer<typeof MonitorParams>> = {
    type: DCS_MONITOR_SETUP,
    group: 'displays',
    label: 'DCS monitor setup fits the monitors',
    params: MonitorParams,
    async run(params) {
      const active = await service.activeMonitorSetup();
      if (!active.ok) return { pass: false, summary: active.error.message };
      const { option, file, problems } = active.value;
      const details = [...problems];
      const o = active.value.options;
      if (
        params.window &&
        o &&
        (o.width !== params.window.width || o.height !== params.window.height)
      ) {
        details.unshift(
          `DCS's window is ${o.width ?? '?'}x${o.height ?? '?'} (options.lua); the monitors of this setup span ${params.window.width}x${params.window.height}`
        );
      }
      if (params.setup && params.setup.toLowerCase() !== (option ?? '').toLowerCase()) {
        details.unshift(
          `DCS uses the monitor setup "${option ?? 'default'}"; this setup expects "${params.setup}"`
        );
      }
      const label = file
        ? `"${file.name}" (${file.stem}.lua)`
        : option
          ? `"${option}"`
          : "DCS's default single screen";
      if (details.length === 0) return { pass: true, summary: `${label} fits the monitors` };
      return {
        pass: false,
        summary: details.length === 1 ? details[0]! : `${label} does not fit the monitors`,
        details: details.length === 1 ? [] : details,
      };
    },
  };

  const writeScreens: RemediationDefinition<Record<string, never>> = {
    type: DCS_WRITE_SCREENS,
    label: 'Write the RigReady screen setup',
    order: 300,
    params: NoParams as never,
    describe: () => 'Write the RigReady screen setup and select it in DCS',
    run: () => service.rewriteSavedScreens(),
  };

  const exportLua: CheckDefinition<z.infer<typeof ExportParams>> = {
    type: DCS_EXPORT,
    group: 'files',
    label: 'Export.lua loads the tools this setup needs',
    params: ExportParams,
    async run(params, ctx) {
      const paths = await service.paths();
      if (!paths.ok) return { pass: false, summary: paths.error.message };
      const text = await ctx.ports.files.readText(paths.value.exportLua);
      const parsed = parseExportLua(text.ok ? text.value : '');
      const missing = params.tools.filter((t) => !hasTool(parsed, t));
      if (missing.length === 0) return { pass: true, summary: `Loads ${names(params.tools)}` };
      const details: string[] = [];
      for (const tool of missing) {
        const installed = await service.toolInstalled(paths.value, tool);
        details.push(
          installed
            ? `${TOOL_INFO[tool].name}: no line loads ${TOOL_INFO[tool].scripts[0]}`
            : `${TOOL_INFO[tool].name}: not installed (${TOOL_INFO[tool].scripts[0]} is missing), so its line cannot be added`
        );
      }
      return {
        pass: false,
        summary: text.ok
          ? `${names(missing)} ${missing.length === 1 ? 'is' : 'are'} missing from Export.lua`
          : 'Export.lua does not exist',
        details,
      };
    },
  };

  const repairExport: RemediationDefinition<z.infer<typeof ExportParams>> = {
    type: DCS_REPAIR_EXPORT,
    label: 'Put back the missing Export.lua lines',
    order: 300,
    params: ExportParams,
    describe: () => 'Put back the missing Export.lua lines',
    run: (params) => service.repairExport(params.tools),
  };

  const options: CheckDefinition<z.infer<typeof OptionsParams>> = {
    type: DCS_OPTIONS,
    group: 'files',
    label: 'DCS graphics options',
    params: OptionsParams,
    async run(params) {
      const paths = await service.paths();
      if (!paths.ok) return { pass: false, summary: paths.error.message };
      const read = await service.options(paths.value);
      if (!read.options)
        return { pass: false, summary: read.problem ?? 'options.lua is not readable' };
      const differences = optionDifferences(params, read.options);
      if (differences.length === 0) {
        const checked: DcsOptions = {};
        for (const key of Object.keys(params) as OptionKey[]) {
          if ((params as DcsOptions)[key] !== undefined) {
            (checked as Record<string, unknown>)[key] = read.options[key];
          }
        }
        return { pass: true, summary: describeOptions(checked) };
      }
      return {
        pass: false,
        summary:
          differences.length === 1 ? differences[0]! : `${differences.length} options differ`,
        details: differences.length === 1 ? [] : differences,
      };
    },
  };

  const setOptions: RemediationDefinition<z.infer<typeof OptionsParams>> = {
    type: DCS_SET_OPTIONS,
    label: 'Set the DCS options',
    order: 300,
    params: OptionsParams,
    describe: (params) =>
      `Set ${(Object.keys(params) as OptionKey[])
        .filter((k) => (params as DcsOptions)[k] !== undefined)
        .map((k) => OPTION_LABELS[k])
        .join(', ')} in options.lua`,
    async run(params, ctx) {
      if (await dcsRunning(ctx))
        return err(
          'dcs.running',
          'DCS is running. Close DCS first: it rewrites options.lua when it exits.'
        );
      const paths = await service.paths();
      if (!paths.ok) return paths;
      const text = await ctx.ports.files.readText(paths.value.options);
      if (!text.ok) return text;
      const values: DcsOptions = { ...params };
      if (params.width && params.height) values.aspect = params.width / params.height;
      const edited = editOptions(text.value, values);
      if (!edited.ok) return edited;
      if (edited.value.changes.length === 0) return ok('options.lua already had these values');
      const described = edited.value.changes.map(describeChange);
      const written = await ctx.ports.files.write(paths.value.options, edited.value.text, {
        reason: `options.lua: ${described.join('; ')}`,
      });
      if (!written.ok) return written;
      const back = await ctx.ports.files.readText(paths.value.options);
      const after = back.ok ? readOptions(back.value) : back;
      if (!after.ok || optionDifferences(params, after.value).length > 0) {
        return err(
          'dcs.options.verify',
          'options.lua was written but does not read back as expected.'
        );
      }
      return ok(`options.lua: ${described.join('; ')}`);
    },
  };

  const simAppPro: CheckDefinition<z.infer<typeof SimAppProParams>> = {
    type: SIMAPPPRO_CHECK,
    group: 'apps',
    label: 'SimAppPro running',
    params: SimAppProParams,
    async run(params, ctx) {
      const info = await findSimAppPro(ctx);
      const needs = runtimeFeaturePhrase(params.features);
      if (info.running) return { pass: true, summary: `Running, for ${needs}` };
      return {
        pass: false,
        summary: info.installed
          ? `Not running; needed for ${needs}`
          : `SimAppPro is not installed; needed for ${needs}`,
      };
    },
  };

  const startSimAppPro: RemediationDefinition<Record<string, never>> = {
    type: START_SIMAPPPRO,
    label: 'Start SimAppPro',
    order: 100,
    params: NoParams as never,
    describe: () => 'Start SimAppPro',
    async run(_params, ctx) {
      const info = await findSimAppPro(ctx);
      if (info.running) return ok('SimAppPro was already running');
      if (!info.exe)
        return err('simapppro.missing', 'SimAppPro is not installed, so it cannot be started.');
      const started = await ctx.ports.processes.start({
        exe: info.exe,
        args: [],
        cwd: path.dirname(info.exe),
      });
      if (!started.ok) return started;
      const deadline = ctx.ports.clock.now().getTime() + 15_000;
      for (;;) {
        const processes = await ctx.ports.processes.list();
        if (
          processes.ok &&
          processes.value.some((p) => p.name.toLowerCase() === SIMAPPPRO_EXE.toLowerCase())
        ) {
          return ok('Started SimAppPro');
        }
        if (ctx.ports.clock.now().getTime() >= deadline) break;
        await sleep(250);
      }
      return err('process.notStarted', 'SimAppPro was started but is not running.');
    },
  };

  const managed: CheckDefinition<Record<string, never>> = {
    type: DCS_MANAGED,
    group: 'files',
    label: 'DCS files RigReady manages are unchanged',
    params: NoParams as never,
    async run(_params, ctx) {
      const status = await service.managedStatus();
      const changed = status.filter((s) => s.status === 'changed' || s.status === 'missing');
      const watched = status.filter((s) => s.status !== 'notManaged');
      if (changed.length === 0) {
        return {
          pass: true,
          summary: watched.length
            ? `${watched.map((s) => s.label).join(', ')} as RigReady left them`
            : 'RigReady does not manage any DCS file yet',
        };
      }
      const info = await findSimAppPro(ctx);
      return {
        pass: false,
        summary: `${changed.map((s) => s.label).join(', ')} changed outside RigReady`,
        details: [
          ...changed.flatMap((s) => s.details.map((d) => `${s.label}: ${d}`)),
          ...(info.installed && changed.some((s) => s.label === 'Export.lua')
            ? ['SimAppPro rewrites Export.lua every time it starts.']
            : []),
          ...(info.installed && changed.some((s) => s.label !== 'Export.lua')
            ? ["SimAppPro's MFD wizard rewrites options.lua when it is applied."]
            : []),
        ],
      };
    },
  };

  const restoreManaged: RemediationDefinition<Record<string, never>> = {
    type: DCS_RESTORE_MANAGED,
    label: "Restore RigReady's version",
    order: 300,
    params: NoParams as never,
    describe: () => "Restore RigReady's version",
    run: () => service.restoreManaged(),
  };

  const capture: CaptureDefinition = {
    id: 'dcs-setup',
    label: 'DCS World',
    async capture() {
      const paths = await service.paths();
      if (!paths.ok) return ok([]);
      const candidates: CaptureCandidate[] = [];
      if (paths.value.install) {
        candidates.push({
          key: 'dcs:install',
          game: 'dcs',
          group: 'other',
          title: 'DCS World installed',
          description: paths.value.install.installDir,
          selectedByDefault: true,
          check: {
            type: DCS_INSTALL,
            title: 'DCS World installed',
            required: true,
            params: { installDir: paths.value.install.installDir },
          },
        });
      }
      const exportText = await service.exportState();
      const active = EXPORT_TOOLS.filter((t) =>
        exportText.tools.some((s) => s.tool === t && s.active > 0)
      );
      if (active.length > 0) {
        candidates.push({
          key: 'dcs:export',
          game: 'dcs',
          group: 'files',
          title: 'Export.lua tools',
          description: `Export.lua loads ${names(active)}`,
          selectedByDefault: true,
          check: {
            type: DCS_EXPORT,
            title: 'Export.lua tools',
            required: true,
            params: { tools: active },
            remediation: { type: DCS_REPAIR_EXPORT, params: { tools: active } },
          },
        });
      }
      const read = await service.options(paths.value);
      if (read.options) {
        const o = read.options;
        const state = await service.state();
        // The monitors as they are now are the layout this setup is captured with.
        const desktop = await service.currentDesktop();
        const span = desktop.length ? boundingBox(desktop) : { width: 0, height: 0 };
        const rigReady =
          o.multiMonitorSetup?.toLowerCase() === MONITOR_SETUP_OPTION &&
          state.screens !== undefined;
        candidates.push({
          key: 'dcs:monitor',
          game: 'dcs',
          group: 'displays',
          title: 'DCS monitor setup',
          description: o.multiMonitorSetup
            ? `"${o.multiMonitorSetup}" stays selected and its screens fit the monitors`
            : "DCS's default single screen fits the monitors",
          // Offered, not pre-ticked: the monitor layout check already covers the common case.
          selectedByDefault: false,
          check: {
            type: DCS_MONITOR_SETUP,
            title: 'DCS monitor setup',
            required: false,
            params: {
              ...(o.multiMonitorSetup ? { setup: o.multiMonitorSetup } : {}),
              ...(desktop.length ? { window: { width: span.width, height: span.height } } : {}),
            },
            ...(rigReady ? { remediation: { type: DCS_WRITE_SCREENS, params: {} } } : {}),
          },
        });
        const expected = {
          ...(o.width !== undefined ? { width: o.width } : {}),
          ...(o.height !== undefined ? { height: o.height } : {}),
          ...(o.fullScreen !== undefined ? { fullScreen: o.fullScreen } : {}),
          ...(o.vr !== undefined ? { vr: o.vr } : {}),
        };
        if (Object.keys(expected).length > 0) {
          candidates.push({
            key: 'dcs:options',
            game: 'dcs',
            group: 'files',
            title: 'DCS graphics options',
            description: describeOptions(expected),
            selectedByDefault: true,
            check: {
              type: DCS_OPTIONS,
              title: 'DCS graphics options',
              required: false,
              params: expected,
              remediation: { type: DCS_SET_OPTIONS, params: expected },
            },
          });
        }
      }
      const status = await service.managedStatus();
      if (status.some((s) => s.status !== 'notManaged')) {
        candidates.push({
          key: 'dcs:managed',
          game: 'dcs',
          group: 'files',
          title: 'DCS files RigReady manages',
          description: `Warn when ${status.map((s) => s.label).join(', ')} change outside RigReady`,
          selectedByDefault: true,
          check: {
            type: DCS_MANAGED,
            title: 'DCS files RigReady manages',
            required: false,
            params: {},
            remediation: { type: DCS_RESTORE_MANAGED, params: {} },
          },
        });
      }
      return ok(candidates);
    },
  };

  return {
    checks: [
      install,
      monitorSetup,
      exportLua,
      options,
      simAppPro,
      managed,
    ] as CheckDefinition<never>[],
    remediations: [
      writeScreens,
      repairExport,
      setOptions,
      startSimAppPro,
      restoreManaged,
    ] as RemediationDefinition<never>[],
    capture,
  };
}

/** "7424x1440, windowed, VR off" */
export function describeOptions(o: DcsOptions): string {
  const parts: string[] = [];
  if (o.width !== undefined && o.height !== undefined) parts.push(`${o.width}x${o.height}`);
  if (o.fullScreen !== undefined) parts.push(o.fullScreen ? 'full screen' : 'windowed');
  if (o.vr !== undefined) parts.push(o.vr ? 'VR on' : 'VR off');
  if (o.multiMonitorSetup !== undefined) parts.push(`monitor setup "${o.multiMonitorSetup}"`);
  return parts.join(', ');
}
