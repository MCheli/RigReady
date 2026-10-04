import path from 'node:path';
import { z } from 'zod';
import type { CheckContext } from '../../../core/checks/registry';
import {
  dcsGuidText,
  readDirectInputIdentities,
  identityForGuid,
  sameGuid,
} from '../../../core/directInput';
import type { GameRegistry } from '../../../core/games';
import { JsonStore } from '../../../core/jsonStore';
import type { DeviceNames } from '../../../core/names';
import { LuaDocument, LuaTable, parseLuaData } from '../../../core/lua/data';
import { err, ok, type Result } from '../../../core/result';
import type { DirectInputIdentity, InputDevice } from '../../../shared/models';
import { discoverAircraft, profileFolderName, type AircraftProfile } from './aircraft';
import {
  DefaultsLoader,
  commandHash,
  unresolvedNames,
  type DefaultCombo,
  type DefaultCommand,
} from './defaults';
import { comboId, readDiff, type CommandKind, type DiffModel } from './diff';
import { applyDiff, type DeviceCommand, type EffectiveResult } from './effective';
import { EngineIds, type NamedHash } from './engineIds';
import {
  DeviceRoleSchema,
  type AircraftSummary,
  type AircraftView,
  type BindingView,
  type CommandView,
  type DeviceRole,
  type DeviceView,
  type Overview,
} from './model';
import {
  DEVICE_TYPES,
  comboLabel,
  describeInput,
  deviceHasInput,
  fullIdFor,
  inputSortKey,
  parseDiffFileName,
  splitFullId,
  type DeviceType,
} from './names';
import { findProblems, suggestRole } from './problems';

/**
 * The read side of DCS bindings: which aircraft and devices there are and what is
 * effectively bound on each (defaults plus the one diff DCS uses). Everything else in
 * this feature (edits, cleanup, migration, copy, snapshots, the check) builds on it,
 * and so will cheat sheets and AI guidance: call `view(aircraftId)` for the model in
 * model.ts, or `state(aircraftId)` when the parsed files are needed too.
 */

export interface BindingsContext extends CheckContext {
  games: GameRegistry;
  /** The names the owner gave devices (ctx.names.devices); without it devices have no given name. */
  names?: () => Promise<DeviceNames>;
  /** The DCS install a setup names (Profile.gameInstall). Absent: the first install found. */
  install?: string;
}

export interface Locations {
  /** <Saved Games>\DCS */
  userDir: string;
  /** <Saved Games>\DCS\Config\Input */
  inputDir: string;
  /** The DCS install, when one was found. Read only. */
  installDir?: string;
  /** False when DCS has never written a Config folder on this PC. */
  found: boolean;
}

export const StateSchema = z.object({
  /** Device role by "VID:PID" (or "name:<device name>" when the ids are unknown). */
  roles: z.record(z.string(), DeviceRoleSchema).default({}),
  /** Per aircraft: command ids the user marked as intentionally bound more than once. */
  expected: z.record(z.string(), z.array(z.string())).default({}),
});
export type BindingsState = z.infer<typeof StateSchema>;

export interface DeviceState {
  type: DeviceType;
  name: string;
  /** The name the owner gave the device, to show; `name` stays what DCS knows it by. */
  givenName?: string;
  guid?: string;
  fullId: string;
  id: string;
  connected: boolean;
  input?: InputDevice;
  vendorId?: string;
  productId?: string;
  role: DeviceRole;
  roleSuggested: boolean;
  /** The user's diff file: where it is or would be. */
  userPath: string;
  userText?: string;
  userDoc?: LuaDocument;
  userError?: string;
  /** The template diff DCS ships for this device, when there is one. */
  templateText?: string;
  diffSource: 'user' | 'template' | 'none';
  /** The defaults that apply to this device, one per hash. */
  commands: DeviceCommand[];
  effective: EffectiveResult;
}

export interface ModifierState {
  name: string;
  key: string;
  device: string;
  isSwitch: boolean;
  fromUser: boolean;
}

export interface AircraftState {
  profile: AircraftProfile;
  /** <inputDir>\<aircraft folder> */
  dir: string;
  devices: DeviceState[];
  /** Every action of the aircraft by id, in DCS's own order. */
  commands: Map<string, CommandView>;
  modifiers: ModifierState[];
  warnings: string[];
  dcsRunning: boolean;
  connected: InputDevice[];
  state: BindingsState;
}

const DEFAULT_MODIFIERS = ['LShift', 'RShift', 'LAlt', 'RAlt', 'LCtrl', 'RCtrl', 'LWin', 'RWin'];

export const commandId = (kind: CommandKind, hash: string): string => `${kind}:${hash}`;

export function roleKey(device: { vendorId?: string; productId?: string; name: string }): string {
  return device.vendorId && device.productId
    ? `${device.vendorId}:${device.productId}`
    : `name:${device.name}`;
}

/** Merges commands that hash the same (DCS applies one diff entry to all of them). */
function mergeByHash(
  commands: DefaultCommand[],
  ids: EngineIds
): { device: DeviceCommand[]; info: Map<string, CommandView> } {
  const device = new Map<string, DeviceCommand>();
  const info = new Map<string, CommandView>();
  for (const command of commands) {
    const hash = commandHash(command.kind, command.fields, ids.resolve);
    const id = commandId(command.kind, hash);
    const existing = device.get(id);
    if (existing) {
      const have = new Set(existing.combos.map(comboId));
      for (const combo of command.combos)
        if (!have.has(comboId(combo))) existing.combos.push(combo);
      continue;
    }
    device.set(id, { kind: command.kind, hash, combos: [...command.combos] });
    info.set(id, {
      id,
      kind: command.kind,
      hash,
      name: command.name || hash,
      category: command.category,
      editable: unresolvedNames(command.kind, command.fields, ids.resolve).length === 0,
      unmatched: false,
    });
  }
  return { device: [...device.values()], info };
}

export class DcsBindings {
  private loader: DefaultsLoader | undefined;
  private readonly ids = new EngineIds();
  private readonly learnedFrom = new Set<string>();
  private readonly store: JsonStore<typeof StateSchema>;

  constructor(readonly ctx: BindingsContext) {
    this.store = new JsonStore(
      ctx.ports.files,
      path.join(ctx.ports.folders.dataRoot(), 'dcs-bindings', 'state.json'),
      StateSchema
    );
  }

  /** Where DCS keeps bindings, from the DCS game module (with a small fallback when it is absent). */
  async locations(): Promise<Locations> {
    const { ports } = this.ctx;
    const dcs = this.ctx.games.get('dcs');
    let userDir: string | undefined;
    let installDir: string | undefined;
    const chosen = this.ctx.install;
    if (dcs && chosen) {
      // The install a setup names: its folders, or none. Never another install's.
      const installs = await dcs.detect(this.ctx);
      const install = (installs.ok ? installs.value : []).find(
        (i) => path.resolve(i.installDir).toLowerCase() === path.resolve(chosen).toLowerCase()
      );
      installDir = install?.installDir;
      userDir = install?.userDir;
      if (!install) {
        const missing = path.join(ports.folders.savedGames(), 'DCS (install not found)');
        return { userDir: missing, inputDir: path.join(missing, 'Config', 'Input'), found: false };
      }
    } else if (dcs) {
      const locations = await dcs.configLocations(this.ctx);
      if (locations.ok) userDir = locations.value[0]?.path;
      const installs = await dcs.detect(this.ctx);
      if (installs.ok) installDir = installs.value[0]?.installDir;
    }
    if (!installDir) {
      const libraries = await ports.folders.steamLibraries();
      for (const library of libraries.ok ? libraries.value : []) {
        const candidate = path.join(library, 'steamapps', 'common', 'DCSWorld');
        if (await ports.files.exists(path.join(candidate, 'Scripts', 'Input'))) {
          installDir = candidate;
          break;
        }
      }
    }
    const found = userDir !== undefined;
    userDir ??= path.join(ports.folders.savedGames(), 'DCS');
    return {
      userDir,
      inputDir: path.join(userDir, 'Config', 'Input'),
      found: found || (await ports.files.exists(path.join(userDir, 'Config'))),
      ...(installDir ? { installDir } : {}),
    };
  }

  async dcsRunning(): Promise<boolean> {
    const processes = await this.ctx.ports.processes.list();
    return processes.ok && processes.value.some((p) => p.name.toLowerCase() === 'dcs.exe');
  }

  /** The controllers DirectInput lists right now. Empty (with a logged warning) when that fails. */
  async connectedDevices(): Promise<InputDevice[]> {
    const started = await this.ctx.ports.input.start();
    if (!started.ok) {
      this.ctx.log.warn('dcs-bindings: controllers could not be listed', started.error);
      return [];
    }
    return started.value;
  }

  readState(): Promise<Result<BindingsState>> {
    return this.store.read();
  }

  updateState(change: (state: BindingsState) => BindingsState): Promise<Result<BindingsState>> {
    return this.store.update(change);
  }

  private defaults(installDir: string): DefaultsLoader {
    if (!this.loader || this.loader.installDir !== installDir) {
      this.loader = new DefaultsLoader(this.ctx.ports.files, installDir);
    }
    return this.loader;
  }

  /** Aircraft known to the install plus what has binding files, for the aircraft picker. */
  async profiles(locations: Locations): Promise<AircraftProfile[]> {
    const roots = [path.join(locations.userDir, 'Mods', 'aircraft')];
    if (locations.installDir) roots.unshift(path.join(locations.installDir, 'Mods', 'aircraft'));
    return discoverAircraft(this.ctx.ports.files, roots);
  }

  private async userFileCount(inputDir: string, aircraftId: string): Promise<number> {
    const tree = await this.ctx.ports.files.listTree(
      path.join(inputDir, profileFolderName(aircraftId)),
      { include: ['*.diff.lua'] }
    );
    return tree.ok ? tree.value.length : 0;
  }

  async aircraftList(locations: Locations): Promise<AircraftSummary[]> {
    const summaries: AircraftSummary[] = [];
    for (const profile of await this.profiles(locations)) {
      const userFiles = await this.userFileCount(locations.inputDir, profile.id);
      if (!profile.folder && userFiles === 0) continue;
      summaries.push({
        id: profile.id,
        name: profile.name,
        hasDefaults: profile.folder !== undefined,
        userFiles,
      });
    }
    // Aircraft with the user's own bindings first, then by name.
    return summaries.sort(
      (a, b) => Number(b.userFiles > 0) - Number(a.userFiles > 0) || a.name.localeCompare(b.name)
    );
  }

  async overview(): Promise<Result<Overview>> {
    const locations = await this.locations();
    return ok({
      found: locations.found,
      inputDir: locations.inputDir,
      ...(locations.installDir ? { installDir: locations.installDir } : {}),
      aircraft: locations.found || locations.installDir ? await this.aircraftList(locations) : [],
      dcsRunning: await this.dcsRunning(),
      staleDeviceIds: 0,
    });
  }

  private async readTable(file: string): Promise<LuaTable | undefined> {
    if (!(await this.ctx.ports.files.exists(file))) return undefined;
    const text = await this.ctx.ports.files.readText(file);
    if (!text.ok) return undefined;
    const parsed = parseLuaData(text.value);
    if (!parsed.ok) return undefined;
    const first = parsed.value.statements.find((s) => s.kind === 'assign')?.value;
    return first instanceof LuaTable ? first : undefined;
  }

  /** Teaches the engine-id table from the template diffs DCS ships for an aircraft (once). */
  private async learnFromTemplates(
    loader: DefaultsLoader,
    folder: string,
    commands: DefaultCommand[]
  ): Promise<void> {
    if (this.learnedFrom.has(folder.toLowerCase())) return;
    this.learnedFrom.add(folder.toLowerCase());
    const entries: NamedHash[] = [];
    for (const type of ['joystick', 'keyboard']) {
      const names = await this.ctx.ports.files.list(path.join(folder, type));
      for (const name of names.ok ? names.value : []) {
        if (!name.toLowerCase().endsWith('.diff.lua')) continue;
        const text = await loader.text(path.join(folder, type, name));
        const parsed = text === null ? undefined : parseLuaData(text);
        if (parsed?.ok) entries.push(...readDiff(parsed.value).entries);
      }
    }
    this.ids.learn(commands, entries);
  }

  /** Everything about one aircraft's bindings, parsed files included. */
  async state(aircraftId: string): Promise<Result<AircraftState>> {
    const { ports } = this.ctx;
    const locations = await this.locations();
    const profile =
      (await this.profiles(locations)).find((p) => p.id === aircraftId) ??
      ({ id: aircraftId, name: aircraftId } satisfies AircraftProfile);
    const dir = path.join(locations.inputDir, profileFolderName(aircraftId));
    if (!profile.folder && !(await ports.files.exists(dir))) {
      return err('dcs.aircraft.unknown', `DCS has no aircraft "${aircraftId}" on this PC.`);
    }
    const warnings: string[] = [];
    const stored = await this.readState();
    const state = stored.ok ? stored.value : StateSchema.parse({});
    if (!stored.ok) warnings.push(stored.error.message);
    const connected = await this.connectedDevices();
    const identities = await readDirectInputIdentities(ports.registry);
    const known: DirectInputIdentity[] = identities.ok ? identities.value : [];
    const loader = locations.installDir ? this.defaults(locations.installDir) : undefined;
    const wizard = await this.readTable(path.join(locations.inputDir, 'wizard.lua'));
    const names = await this.ctx.names?.();

    // 1. The devices: what is attached, plus what has a binding file.
    interface Slot {
      type: DeviceType;
      name: string;
      guid?: string;
      input?: InputDevice;
      fileName?: string;
    }
    const slots: Slot[] = connected.map((input) => ({
      type: 'joystick',
      name: input.name,
      guid: input.guid,
      input,
    }));
    slots.push({ type: 'keyboard', name: 'Keyboard' });
    for (const type of DEVICE_TYPES) {
      const names = await ports.files.list(path.join(dir, type));
      for (const fileName of names.ok ? names.value : []) {
        const parsed = parseDiffFileName(fileName);
        if (!parsed) continue;
        const slot = slots.find(
          (s) =>
            s.type === type &&
            s.name === parsed.deviceName &&
            (s.guid === undefined
              ? parsed.guid === undefined
              : parsed.guid !== undefined && sameGuid(s.guid, parsed.guid))
        );
        if (slot) slot.fileName = fileName;
        else {
          slots.push({
            type,
            name: parsed.deviceName,
            ...(parsed.guid ? { guid: parsed.guid } : {}),
            fileName,
          });
        }
      }
    }

    // 2. Each device's defaults and its one diff.
    interface Loaded {
      slot: Slot;
      defaults: DefaultCommand[];
      userText?: string;
      userDoc?: LuaDocument;
      userError?: string;
      templateText?: string;
      diff?: DiffModel;
      diffSource: 'user' | 'template' | 'none';
    }
    const loaded: Loaded[] = [];
    for (const slot of slots) {
      const entry: Loaded = { slot, defaults: [], diffSource: 'none' };
      const fullId = fullIdFor(slot.name, slot.guid);
      const typeFolder = profile.folder ? path.join(profile.folder, slot.type) : undefined;
      if (loader && typeFolder && (slot.type === 'joystick' || slot.type === 'keyboard')) {
        const own = path.join(typeFolder, `${slot.name}.lua`);
        const base = (await loader.has(own)) ? own : path.join(typeFolder, 'default.lua');
        if (await loader.has(base)) {
          const layout = await loader.layout({
            file: base,
            folder: `${typeFolder}${path.sep}`,
            deviceTemplate: slot.name,
            deviceFullId: fullId,
            ...(wizard ? { wizard } : {}),
          });
          if (layout.ok) entry.defaults = layout.value.commands;
          else {
            warnings.push(
              `DCS's default bindings for ${slot.name} could not be read: ${layout.error.message}${layout.error.detail ? ` (${layout.error.detail})` : ''}`
            );
          }
        }
        const template = await loader.text(path.join(typeFolder, `${slot.name}.diff.lua`));
        if (template !== null) entry.templateText = template;
      }
      if (slot.fileName) {
        const file = path.join(dir, slot.type, slot.fileName);
        const text = await ports.files.readText(file);
        if (!text.ok) entry.userError = text.error.message;
        else {
          entry.userText = text.value;
          const parsed = parseLuaData(text.value);
          if (parsed.ok) {
            entry.userDoc = parsed.value;
            entry.diff = readDiff(parsed.value);
            entry.diffSource = 'user';
          } else {
            entry.userError = parsed.error.message;
          }
        }
        if (entry.userError) warnings.push(`${file}: ${entry.userError}`);
      } else if (entry.templateText !== undefined) {
        const parsed = parseLuaData(entry.templateText);
        if (parsed.ok) {
          entry.diff = readDiff(parsed.value);
          entry.diffSource = 'template';
        }
      }
      loaded.push(entry);
    }

    // 3. Learn engine command numbers from the files at hand, then hash everything.
    const allDefaults = loaded.flatMap((l) => l.defaults);
    if (loader && profile.folder)
      await this.learnFromTemplates(loader, profile.folder, allDefaults);
    this.ids.learn(
      allDefaults,
      loaded.flatMap((l) => l.diff?.entries ?? [])
    );
    if (profile.folder && allDefaults.length === 0) {
      warnings.push(`DCS's default bindings for ${profile.name} could not be loaded.`);
    } else if (!profile.folder) {
      warnings.push(
        `DCS's default input files for ${profile.name} were not found, so only your own changes are shown.`
      );
    }

    const commands = new Map<string, CommandView>();
    const devices: DeviceState[] = [];
    for (const entry of loaded) {
      const { slot } = entry;
      const merged = mergeByHash(entry.defaults, this.ids);
      for (const [id, info] of merged.info) if (!commands.has(id)) commands.set(id, info);
      const effective = applyDiff(
        merged.device,
        entry.diff,
        entry.diffSource === 'template' ? 'template' : 'user'
      );
      for (const unmatched of effective.unmatched) {
        const id = commandId(unmatched.kind, unmatched.hash);
        if (commands.has(id)) continue;
        commands.set(id, {
          id,
          kind: unmatched.kind,
          hash: unmatched.hash,
          name: unmatched.name || unmatched.hash,
          category: [],
          editable: true,
          unmatched: true,
        });
      }
      const identity = slot.guid ? identityForGuid(known, slot.guid) : undefined;
      const vendorId = slot.input?.vendorId || identity?.vendorId;
      const productId = slot.input?.productId || identity?.productId;
      const ids = {
        name: slot.name,
        ...(vendorId ? { vendorId } : {}),
        ...(productId ? { productId } : {}),
      };
      const chosen = state.roles[roleKey(ids)];
      const fullId = fullIdFor(slot.name, slot.guid);
      const given =
        slot.type === 'joystick'
          ? names?.nameOf({
              vendorId: vendorId ?? '0000',
              productId: productId ?? '0000',
              ...(slot.guid ? { guid: slot.guid } : {}),
            })
          : undefined;
      devices.push({
        type: slot.type,
        ...ids,
        ...(given ? { givenName: given } : {}),
        ...(slot.guid ? { guid: dcsGuidText(slot.guid) } : {}),
        fullId,
        id: `${slot.type}/${fullId}`,
        connected: slot.input !== undefined || slot.type !== 'joystick',
        ...(slot.input ? { input: slot.input } : {}),
        role: chosen ?? (slot.type === 'joystick' ? suggestRole(slot.name) : 'other'),
        roleSuggested: chosen === undefined,
        userPath: path.join(dir, slot.type, slot.fileName ?? `${fullId}.diff.lua`),
        ...(entry.userText !== undefined ? { userText: entry.userText } : {}),
        ...(entry.userDoc ? { userDoc: entry.userDoc } : {}),
        ...(entry.userError ? { userError: entry.userError } : {}),
        ...(entry.templateText !== undefined ? { templateText: entry.templateText } : {}),
        diffSource: entry.diffSource,
        commands: merged.device,
        effective,
      });
    }

    return ok({
      profile,
      dir,
      devices,
      commands,
      modifiers: await this.modifiers(loader, profile, dir),
      warnings,
      dcsRunning: await this.dcsRunning(),
      connected,
      state,
    });
  }

  /** The aircraft's modifiers: the user's modifiers.lua, else the module's, else DCS's keyboard defaults. */
  private async modifiers(
    loader: DefaultsLoader | undefined,
    profile: AircraftProfile,
    dir: string
  ): Promise<ModifierState[]> {
    const read = (table: LuaTable | undefined, fromUser: boolean): ModifierState[] =>
      (table?.entries ?? []).flatMap(({ key, value }) => {
        if (!(value instanceof LuaTable)) return [];
        const k = value.get('key');
        const device = value.get('device');
        return [
          {
            name: String(key),
            key: typeof k === 'string' ? k : String(key),
            device: typeof device === 'string' ? device : 'Keyboard',
            isSwitch: value.get('switch') === true,
            fromUser,
          },
        ];
      });
    const user = await this.readTable(path.join(dir, 'modifiers.lua'));
    if (user) return read(user, true);
    if (loader) {
      for (const file of [
        ...(profile.folder ? [path.join(profile.folder, 'modifiers.lua')] : []),
        path.join(loader.installDir, 'Config', 'Input', 'Aircrafts', 'modifiers.lua'),
      ]) {
        const table = await loader.table(file);
        if (table) return read(table, false);
      }
    }
    return DEFAULT_MODIFIERS.map((name) => ({
      name,
      key: name,
      device: 'Keyboard',
      isSwitch: false,
      fromUser: false,
    }));
  }

  /** The model in model.ts for one aircraft: devices, effective bindings, problems. */
  async view(aircraftId: string): Promise<Result<AircraftView>> {
    const loaded = await this.state(aircraftId);
    if (!loaded.ok) return loaded;
    return ok(buildView(loaded.value));
  }
}

function modifierLabel(modifier: ModifierState): string {
  if (modifier.device === 'Keyboard') return modifier.key;
  return `${describeInput(modifier.key).label} on ${splitFullId(modifier.device).deviceName}`;
}

/** Turns the loaded state into the wire model, with labels and problems. */
export function buildView(state: AircraftState): AircraftView {
  const modifierNames = new Map(state.modifiers.map((m) => [m.name, modifierLabel(m)]));
  const label = (combo: { key: string; reformers?: string[] }): string =>
    comboLabel({
      key: combo.key,
      reformers: (combo.reformers ?? []).map((r) => modifierNames.get(r) ?? r),
    });

  const devices: DeviceView[] = state.devices.map((device) => {
    const caps = device.input;
    const bindings: BindingView[] = device.effective.bindings.map((binding) => ({
      commandId: commandId(binding.kind, binding.hash),
      combo: binding.combo,
      label: label(binding.combo),
      source: binding.source,
      filterChanged: binding.filterChanged,
      inert: caps !== undefined && !deviceHasInput(caps, binding.combo.key),
      ...(binding.assignment ? { purpose: binding.assignment } : {}),
    }));
    for (const entry of device.effective.unmatched) {
      for (const combo of entry.added) {
        bindings.push({
          commandId: commandId(entry.kind, entry.hash),
          combo,
          label: label(combo),
          source: device.diffSource === 'template' ? 'template' : 'user',
          filterChanged: false,
          inert: caps !== undefined && !deviceHasInput(caps, combo.key),
        });
      }
    }
    bindings.sort(
      (a, b) =>
        inputSortKey(a.combo.key).localeCompare(inputSortKey(b.combo.key)) ||
        a.combo.reformers.length - b.combo.reformers.length ||
        a.label.localeCompare(b.label)
    );
    const active = bindings.filter((b) => !b.inert);
    return {
      id: device.id,
      type: device.type,
      name: device.name,
      ...(device.givenName ? { givenName: device.givenName } : {}),
      ...(device.guid ? { guid: device.guid } : {}),
      fullId: device.fullId,
      connected: device.connected,
      ...(device.vendorId ? { vendorId: device.vendorId } : {}),
      ...(device.productId ? { productId: device.productId } : {}),
      numButtons: caps?.numButtons ?? 0,
      numHats: caps?.numHats ?? 0,
      axisNames: caps?.axisNames ?? [],
      role: device.role,
      roleSuggested: device.roleSuggested,
      file: {
        path: device.userPath,
        source: device.diffSource,
        ...(device.userError ? { error: device.userError } : {}),
      },
      bindings,
      removed: device.effective.removed.map((r) => ({
        commandId: commandId(r.kind, r.hash),
        combo: { key: r.combo.key, reformers: r.combo.reformers },
        label: label(r.combo),
      })),
      counts: {
        active: active.length,
        fromUser: active.filter((b) => b.source !== 'default').length,
        fromDefaults: active.filter((b) => b.source === 'default').length,
        inert: bindings.length - active.length,
      },
    };
  });

  const commands = [...state.commands.values()];
  const connectedGuids = state.connected.map((d) => d.guid);
  return {
    aircraft: {
      id: state.profile.id,
      name: state.profile.name,
      hasDefaults: state.profile.folder !== undefined,
      userFiles: state.devices.filter((d) => d.userText !== undefined).length,
    },
    devices,
    commands,
    modifiers: state.modifiers.map((m) => {
      const guid = splitFullId(m.device).guid;
      return {
        name: m.name,
        key: m.key,
        device: m.device,
        label: modifierLabel(m),
        isSwitch: m.isSwitch,
        deviceConnected:
          m.device === 'Keyboard' ||
          (guid !== undefined && connectedGuids.some((g) => sameGuid(g, guid))),
        fromUser: m.fromUser,
      };
    }),
    problems: findProblems({
      aircraftId: state.profile.id,
      devices,
      commands,
      expected: new Set(state.state.expected[state.profile.id] ?? []),
    }),
    warnings: state.warnings,
    uneditableCommands: commands.filter((c) => !c.editable).length,
    dcsRunning: state.dcsRunning,
  };
}

export type { DefaultCombo };
