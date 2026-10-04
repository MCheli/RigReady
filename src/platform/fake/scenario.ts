import { z } from 'zod';
import { err, type Result } from '../../core/result';
import {
  AudioStateSchema,
  DeviceInfoSchema,
  DisplayInfoSchema,
  DisplayLayoutSchema,
  InputDeviceSchema,
  ProcessInfoSchema,
  RegistryHiveSchema,
  RegistryValueSchema,
  RotationSchema,
  ServiceInfoSchema,
  type AudioState,
  type DeviceInfo,
  type DisplayInfo,
  type InputDevice,
  type ProcessInfo,
  type RegistryValue,
  type ServiceInfo,
} from '../../shared/models';

/** What HidHide reported when the rig was recorded (HidHideCLI, read-only). */
export const HidHideStateSchema = z.object({
  installed: z.boolean().default(false),
  /** Full path of HidHideCLI.exe when installed. */
  cliPath: z.string().optional(),
  /** Cloaking on: hidden devices are really hidden from programs not on the allow list. */
  cloak: z.boolean().default(false),
  inverse: z.boolean().default(false),
  /** Device instance paths (HID\VID_...) on the hidden list. */
  hidden: z.array(z.string()).default([]),
  /** Programs allowed to see hidden devices. */
  apps: z.array(z.string()).default([]),
  /** The parsed output of `HidHideCLI --dev-gaming`. */
  gaming: z
    .array(
      z.object({
        friendlyName: z.string(),
        devices: z.array(
          z.looseObject({
            deviceInstancePath: z.string(),
            baseContainerDeviceInstancePath: z.string().default(''),
          })
        ),
      })
    )
    .default([]),
});
export type HidHideState = z.infer<typeof HidHideStateSchema>;

/** Registry keys by full path ("HKCU\\Software\\Valve\\Steam"), each a map of value name to value. */
export const RegistryFixtureSchema = z.record(
  z.string(),
  z.record(z.string(), RegistryValueSchema)
);
export type RegistryFixture = z.infer<typeof RegistryFixtureSchema>;

/** A recorded rig: fixtures/rigs/<name>/*.json. */
export const RigFixtureSchema = z.object({
  devices: z.array(DeviceInfoSchema),
  displays: DisplayLayoutSchema,
  processes: z.array(ProcessInfoSchema),
  audio: AudioStateSchema,
  input: z.array(InputDeviceSchema).default([]),
  services: z.array(ServiceInfoSchema).default([]),
  registry: RegistryFixtureSchema.default({}),
  hidHide: HidHideStateSchema.prefault({}),
});
export interface RigState {
  devices: DeviceInfo[];
  displays: DisplayInfo[];
  processes: ProcessInfo[];
  audio: AudioState;
  input: InputDevice[];
  services: ServiceInfo[];
  registry: RegistryFixture;
  hidHide: HidHideState;
  /** What unplugDevice removed, so plugDevice can put it back as it was. */
  unplugged?: { devices: DeviceInfo[]; input: InputDevice[] };
  /** Injected faults (see the hangProvider and failProcessStart mutations). */
  faults?: {
    /** Ports whose reads never answer. */
    hang: HangablePort[];
    /** Program names (lower case) that do not start. */
    startFails: Record<string, 'error' | 'neverRuns'>;
    /** Ports whose reads fail, with the message they fail with. */
    fail?: Partial<Record<HangablePort, string>>;
  };
}

export const HangablePortSchema = z.enum(['devices', 'displays', 'processes', 'services', 'audio']);
export type HangablePort = z.infer<typeof HangablePortSchema>;

/** True when a test or scenario made this port hang. */
export const isHung = (state: RigState, port: HangablePort): boolean =>
  state.faults?.hang.includes(port) === true;

/** The error a test or scenario made this port answer with, if any (the failProvider mutation). */
export function providerFailure(state: RigState, port: HangablePort): Result<never> | undefined {
  const message = state.faults?.fail?.[port];
  return message === undefined
    ? undefined
    : err(`${port}.read`, message, 'The driver call failed (0x80004005).');
}

/** A promise that never settles: what a hung driver call looks like to the caller. */
export const never = <T>(): Promise<T> => new Promise<T>(() => {});

const DeviceMatchSchema = z
  .object({
    vendorId: z.string().optional(),
    productId: z.string().optional(),
    serial: z.string().optional(),
    /** Case-insensitive substring of the product name. */
    name: z.string().optional(),
  })
  .refine(
    (m) => Object.values(m).some((v) => v !== undefined),
    'A device match needs at least one field'
  );

const DisplayMatchSchema = z
  .object({
    id: z.string().optional(),
    /** Exact EDID name. */
    name: z.string().optional(),
    /** Which one, when several share the name (0-based, in fixture order). */
    index: z.number().int().optional(),
  })
  .refine((m) => m.id !== undefined || m.name !== undefined, 'A display match needs id or name');

const AudioMatchSchema = z
  .object({
    id: z.string().optional(),
    /** Case-insensitive substring of the endpoint name. */
    name: z.string().optional(),
  })
  .refine((m) => m.id !== undefined || m.name !== undefined, 'An audio match needs id or name');

/** A path below the fake user folder, with forward or back slashes. Never absolute, never `..`. */
const HomePathSchema = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !/^[a-zA-Z]:/.test(p) &&
      !p.startsWith('/') &&
      !p.startsWith('\\') &&
      !p.split(/[\\/]/).includes('..'),
    'A scenario file path is relative to the fake user folder'
  );

/** Changes to the fake machine's state. */
const StateMutationSchemas = [
  z.object({ op: z.literal('unplugDevice'), match: DeviceMatchSchema }),
  /**
   * Plugs a device in. With `match`: one that unplugDevice removed earlier comes back as it
   * was, with its game controller. With `device`: a new device appears, and `controller`
   * adds the DirectInput controller a game would see for it.
   */
  z
    .object({
      op: z.literal('plugDevice'),
      match: DeviceMatchSchema.optional(),
      device: DeviceInfoSchema.optional(),
      controller: InputDeviceSchema.omit({ index: true })
        .partial({ numAxes: true, numButtons: true, numHats: true })
        .optional(),
    })
    .refine(
      (m) => (m.match === undefined) !== (m.device === undefined),
      'plugDevice needs exactly one of match and device'
    ),
  /**
   * Changes a DirectInput controller in place: a new instance GUID (what Windows does when
   * it re-enumerates a device) or another name.
   */
  z.object({
    op: z.literal('setController'),
    match: z
      .object({
        guid: z.string().optional(),
        /** Case-insensitive substring of the controller name. */
        name: z.string().optional(),
        vendorId: z.string().optional(),
        productId: z.string().optional(),
        /** Which one, when several match (0-based). */
        nth: z.number().int().optional(),
      })
      .refine(
        (m) => Object.values(m).some((v) => v !== undefined),
        'A controller match needs at least one field'
      ),
    set: z.object({ guid: z.string().optional(), name: z.string().optional() }),
  }),
  /** Makes every read of a port hang (never answer), or stops doing so with `hang: false`. */
  z.object({
    op: z.literal('hangProvider'),
    port: HangablePortSchema,
    hang: z.boolean().default(true),
  }),
  /**
   * Makes every read of a port fail with an error result (a driver or Windows API that
   * answers with a failure), or stops doing so with `fail: false`.
   */
  z.object({
    op: z.literal('failProvider'),
    port: HangablePortSchema,
    message: z.string().optional(),
    fail: z.boolean().default(true),
  }),
  /**
   * Makes starting a program fail: `error` (Windows refuses to start it) or `neverRuns`
   * (the start is accepted but the program never shows up). `mode: off` ends it.
   */
  z.object({
    op: z.literal('failProcessStart'),
    /** Image name, e.g. DCS.exe. */
    name: z.string(),
    mode: z.enum(['error', 'neverRuns', 'off']).default('error'),
  }),
  z.object({ op: z.literal('stopProcess'), name: z.string() }),
  z.object({ op: z.literal('startProcess'), name: z.string(), path: z.string() }),
  z.object({
    op: z.literal('setDisplay'),
    match: DisplayMatchSchema,
    set: z.object({
      enabled: z.boolean().optional(),
      primary: z.boolean().optional(),
      x: z.number().int().optional(),
      y: z.number().int().optional(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      rotation: RotationSchema.optional(),
      refreshHz: z.number().optional(),
      /** A new id: the monitor was moved to another connector or USB port. */
      id: z.string().optional(),
      serial: z.string().optional(),
      usbSerial: z.string().optional(),
    }),
  }),
  z.object({ op: z.literal('unplugDisplay'), match: DisplayMatchSchema }),
  /** Makes an endpoint the default. `role` defaults to both the default and the communications device. */
  z.object({
    op: z.literal('setAudioDefault'),
    flow: z.enum(['playback', 'recording']),
    match: AudioMatchSchema,
    role: z.enum(['default', 'communications', 'both']).default('both'),
  }),
  /** Removes an audio endpoint (headset unplugged). A default pointing at it moves to another endpoint. */
  z.object({ op: z.literal('unplugAudio'), match: AudioMatchSchema }),
  /** Sets a registry value; `value: null` deletes it. The key is created when missing. */
  z.object({
    op: z.literal('setRegistryValue'),
    hive: RegistryHiveSchema,
    key: z.string(),
    name: z.string(),
    value: RegistryValueSchema.nullable(),
  }),
  /** Deletes a registry key and everything below it. */
  z.object({ op: z.literal('removeRegistryKey'), hive: RegistryHiveSchema, key: z.string() }),
  /** Sets a service's state, adding the service when it is not in the rig; `absent` removes it. */
  z.object({
    op: z.literal('setService'),
    name: z.string(),
    state: z.enum(['running', 'stopped', 'starting', 'stopping', 'paused', 'other', 'absent']),
    displayName: z.string().optional(),
  }),
  /** Puts a device on HidHide's hidden list and turns cloaking on (unless cloak: false). */
  z.object({
    op: z.literal('hideDevice'),
    match: DeviceMatchSchema,
    cloak: z.boolean().default(true),
  }),
  /** Changes HidHide itself: installed or not, cloaking, inverse mode, the allow list. */
  z.object({
    op: z.literal('setHidHide'),
    installed: z.boolean().optional(),
    cloak: z.boolean().optional(),
    inverse: z.boolean().optional(),
    apps: z.array(z.string()).optional(),
  }),
  /** Connects a monitor the rig does not have (the TV). Its id must not be connected already. */
  z.object({ op: z.literal('plugDisplay'), display: DisplayInfoSchema }),
] as const;

/** Changes to the files in the fake user folder, applied after the rig's files are in place. */
const FileMutationSchemas = [
  /** Writes a file. Give `content`, or `from` (a file path relative to the scenario file). */
  z
    .object({
      op: z.literal('writeFile'),
      path: HomePathSchema,
      content: z.string().optional(),
      from: z.string().optional(),
    })
    .refine(
      (m) => (m.content === undefined) !== (m.from === undefined),
      'writeFile needs exactly one of content and from'
    ),
  /** Removes a file or a whole folder. */
  z.object({ op: z.literal('removeFile'), path: HomePathSchema }),
  /** Edits steamapps/appmanifest_<appId>.acf in the fake Steam library. */
  z.object({
    op: z.literal('setSteamBuild'),
    appId: z.union([z.string(), z.number()]).transform(String),
    buildId: z.union([z.string(), z.number()]).transform(String).optional(),
    /** 4 = installed, 6 = installed with an update required. */
    stateFlags: z.number().int().optional(),
    targetBuildId: z.union([z.string(), z.number()]).transform(String).optional(),
    /** Unix seconds. */
    lastUpdated: z.number().int().optional(),
  }),
] as const;

export const MutationSchema = z.discriminatedUnion('op', [
  ...StateMutationSchemas,
  ...FileMutationSchemas,
]);
export type Mutation = z.infer<typeof MutationSchema>;
export type FileMutation = Extract<Mutation, { op: 'writeFile' | 'removeFile' | 'setSteamBuild' }>;
export type StateMutation = Exclude<Mutation, FileMutation>;

export function isFileMutation(mutation: Mutation): mutation is FileMutation {
  return (
    mutation.op === 'writeFile' || mutation.op === 'removeFile' || mutation.op === 'setSteamBuild'
  );
}

/** A canned answer for ports.http. The first entry whose match fits the request is used. */
export const HttpScriptSchema = z.object({
  match: z
    .object({
      /** Substring of the request URL. */
      url: z.string().optional(),
      method: z.string().optional(),
      /** Substring of the request body. */
      body: z.string().optional(),
    })
    .prefault({}),
  response: z
    .object({
      status: z.number().int().default(200),
      headers: z.record(z.string(), z.string()).default({}),
      body: z.string().optional(),
      /** Serialized as the body, with content-type application/json. */
      json: z.unknown().optional(),
    })
    .optional(),
  /** Instead of a response: fail as if the network were down. */
  error: z.string().optional(),
  /** How many requests this entry answers before it is used up. Default: unlimited. */
  times: z.number().int().positive().optional(),
});
export type HttpScript = z.infer<typeof HttpScriptSchema>;

/** A canned answer for ports.shell.run. */
export const ShellScriptSchema = z.object({
  match: z.object({
    /** Case-insensitive substring of the executable path. */
    exe: z.string(),
    /** Arguments that must all be present. */
    args: z.array(z.string()).default([]),
  }),
  result: z.object({
    code: z.number().int().nullable().default(0),
    stdout: z.string().default(''),
    stderr: z.string().default(''),
  }),
});
export type ShellScript = z.infer<typeof ShellScriptSchema>;

/**
 * What the file pickers return, one entry per call, in order. Paths are relative to the
 * fake user folder (or absolute). When the list is used up the dialog is "cancelled".
 */
export const DialogScriptSchema = z.object({
  /** Each call to open() takes the next entry: the list of chosen paths ([] = cancelled). */
  open: z.array(z.array(z.string())).default([]),
  /** Each call to save() takes the next entry: the chosen path (null = cancelled). */
  save: z.array(z.string().nullable()).default([]),
});
export type DialogScript = z.infer<typeof DialogScriptSchema>;

export const ScenarioSchema = z.object({
  description: z.string(),
  /** Folder name under fixtures/rigs. */
  rig: z.string(),
  /** Another scenario file (relative to this one) whose mutations are applied first. */
  extends: z.string().optional(),
  mutations: z.array(MutationSchema).default([]),
  /** Profile YAML files (relative to this file) copied into the data root at startup. */
  profiles: z.array(z.string()).default([]),
  /** Other files copied into the data root at startup: target path (below the data root) -> source file (relative to this file). */
  data: z.record(HomePathSchema, z.string()).default({}),
  http: z.array(HttpScriptSchema).default([]),
  shell: z.array(ShellScriptSchema).default([]),
  dialogs: DialogScriptSchema.prefault({}),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export function matchesDevice(
  device: Pick<DeviceInfo, 'vendorId' | 'productId' | 'serial' | 'name'>,
  match: z.infer<typeof DeviceMatchSchema>
): boolean {
  if (match.vendorId && device.vendorId !== match.vendorId.toUpperCase()) return false;
  if (match.productId && device.productId !== match.productId.toUpperCase()) return false;
  if (match.serial && device.serial !== match.serial) return false;
  if (match.name && !device.name.toLowerCase().includes(match.name.toLowerCase())) return false;
  return true;
}

function findDisplays(
  displays: DisplayInfo[],
  match: z.infer<typeof DisplayMatchSchema>
): DisplayInfo[] {
  let found = displays.filter(
    (d) =>
      (match.id === undefined || d.id === match.id.toLowerCase()) &&
      (match.name === undefined || d.name === match.name)
  );
  if (match.index !== undefined) {
    const one = found[match.index];
    found = one ? [one] : [];
  }
  return found;
}

export const registryKeyPath = (hive: string, key: string): string =>
  `${hive}\\${key.replace(/^\\+|\\+$/g, '')}`;

/** The stored key whose path equals `fullPath` ignoring case, as Windows does. */
export function findRegistryKey(registry: RegistryFixture, fullPath: string): string | undefined {
  const wanted = fullPath.toLowerCase();
  return Object.keys(registry).find((k) => k.toLowerCase() === wanted);
}

/**
 * Applies one state mutation in place. Throws when it matches nothing: a scenario that
 * silently does nothing is a bug.
 */
export function mutateState(state: RigState, mutation: StateMutation): void {
  switch (mutation.op) {
    case 'unplugDevice': {
      const gone = state.devices.filter((d) => matchesDevice(d, mutation.match));
      if (gone.length === 0) {
        throw new Error(`unplugDevice matched no device: ${JSON.stringify(mutation.match)}`);
      }
      state.devices = state.devices.filter((d) => !gone.includes(d));
      // A game controller that is unplugged also disappears from DirectInput.
      const isGone = (i: InputDevice): boolean =>
        gone.some((d) => d.vendorId === i.vendorId && d.productId === i.productId);
      const unplugged = (state.unplugged ??= { devices: [], input: [] });
      unplugged.devices.push(...gone);
      unplugged.input.push(...state.input.filter(isGone));
      state.input = state.input
        .filter((i) => !isGone(i))
        .map((device, index) => ({ ...device, index }));
      break;
    }
    case 'plugDevice': {
      if (mutation.match) {
        const match = mutation.match;
        const unplugged = (state.unplugged ??= { devices: [], input: [] });
        const back = unplugged.devices.filter((d) => matchesDevice(d, match));
        if (back.length === 0) {
          throw new Error(`plugDevice matched no unplugged device: ${JSON.stringify(match)}`);
        }
        const isBack = (i: InputDevice): boolean =>
          back.some((d) => d.vendorId === i.vendorId && d.productId === i.productId);
        state.devices.push(...back);
        state.input = [...state.input, ...unplugged.input.filter(isBack)].map((device, index) => ({
          ...device,
          index,
        }));
        unplugged.devices = unplugged.devices.filter((d) => !back.includes(d));
        unplugged.input = unplugged.input.filter((i) => !isBack(i));
        break;
      }
      const device = mutation.device!;
      if (
        state.devices.some((d) => d.instanceId.toLowerCase() === device.instanceId.toLowerCase())
      ) {
        throw new Error(`plugDevice: ${device.instanceId} is already connected`);
      }
      state.devices.push(structuredClone(device));
      if (mutation.controller) {
        state.input.push({
          numAxes: 0,
          numButtons: 32,
          numHats: 0,
          ...mutation.controller,
          index: state.input.length,
        });
      }
      break;
    }
    case 'setController': {
      const { match } = mutation;
      let found = state.input.filter(
        (i) =>
          (match.guid === undefined || i.guid.toLowerCase() === match.guid.toLowerCase()) &&
          (match.name === undefined || i.name.toLowerCase().includes(match.name.toLowerCase())) &&
          (match.vendorId === undefined || i.vendorId === match.vendorId.toUpperCase()) &&
          (match.productId === undefined || i.productId === match.productId.toUpperCase())
      );
      if (match.nth !== undefined) found = found[match.nth] ? [found[match.nth]!] : [];
      if (found.length === 0) {
        throw new Error(`setController matched no controller: ${JSON.stringify(match)}`);
      }
      for (const controller of found) {
        if (mutation.set.guid !== undefined) controller.guid = mutation.set.guid.toUpperCase();
        if (mutation.set.name !== undefined) controller.name = mutation.set.name;
      }
      break;
    }
    case 'hangProvider': {
      const faults = (state.faults ??= { hang: [], startFails: {} });
      faults.hang = faults.hang.filter((p) => p !== mutation.port);
      if (mutation.hang) faults.hang.push(mutation.port);
      break;
    }
    case 'failProvider': {
      const faults = (state.faults ??= { hang: [], startFails: {} });
      const fail = (faults.fail ??= {});
      if (mutation.fail) {
        fail[mutation.port] =
          mutation.message ?? `Windows did not answer the request for ${mutation.port}.`;
      } else {
        delete fail[mutation.port];
      }
      break;
    }
    case 'failProcessStart': {
      const faults = (state.faults ??= { hang: [], startFails: {} });
      if (mutation.mode === 'off') delete faults.startFails[mutation.name.toLowerCase()];
      else faults.startFails[mutation.name.toLowerCase()] = mutation.mode;
      break;
    }
    case 'stopProcess': {
      const before = state.processes.length;
      state.processes = state.processes.filter(
        (p) => p.name.toLowerCase() !== mutation.name.toLowerCase()
      );
      if (state.processes.length === before) {
        throw new Error(`stopProcess matched no process: ${mutation.name}`);
      }
      break;
    }
    case 'startProcess': {
      const pid = Math.max(1000, ...state.processes.map((p) => p.pid)) + 4;
      state.processes.push({ pid, name: mutation.name, path: mutation.path });
      break;
    }
    case 'setDisplay': {
      const found = findDisplays(state.displays, mutation.match);
      if (found.length === 0) {
        throw new Error(`setDisplay matched no display: ${JSON.stringify(mutation.match)}`);
      }
      for (const display of found) {
        Object.assign(display, mutation.set);
        if (mutation.set.id !== undefined) display.id = mutation.set.id.toLowerCase();
        if (!display.enabled)
          Object.assign(display, {
            primary: false,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            rotation: 0,
          });
      }
      break;
    }
    case 'unplugDisplay': {
      const found = new Set(findDisplays(state.displays, mutation.match));
      if (found.size === 0) {
        throw new Error(`unplugDisplay matched no display: ${JSON.stringify(mutation.match)}`);
      }
      state.displays = state.displays.filter((d) => !found.has(d));
      break;
    }
    case 'setAudioDefault':
    case 'unplugAudio': {
      const { match } = mutation;
      const flow = mutation.op === 'setAudioDefault' ? mutation.flow : undefined;
      const device = state.audio.devices.find(
        (d) =>
          (flow === undefined || d.flow === flow) &&
          (match.id === undefined || d.id === match.id) &&
          (match.name === undefined || d.name.toLowerCase().includes(match.name.toLowerCase()))
      );
      if (!device) {
        throw new Error(`${mutation.op} matched no audio device: ${JSON.stringify(match)}`);
      }
      const keys =
        device.flow === 'playback'
          ? (['defaultPlayback', 'defaultCommsPlayback'] as const)
          : (['defaultRecording', 'defaultCommsRecording'] as const);
      if (mutation.op === 'setAudioDefault') {
        if (mutation.role !== 'communications') state.audio[keys[0]] = { ...device };
        if (mutation.role !== 'default') state.audio[keys[1]] = { ...device };
      } else {
        state.audio.devices = state.audio.devices.filter((d) => d !== device);
        const next = state.audio.devices.find((d) => d.flow === device.flow);
        for (const key of keys) {
          if (state.audio[key]?.id !== device.id) continue;
          if (next) state.audio[key] = { ...next };
          else delete state.audio[key];
        }
      }
      break;
    }
    case 'setRegistryValue': {
      const full = registryKeyPath(mutation.hive, mutation.key);
      const existing = findRegistryKey(state.registry, full);
      if (mutation.value === null) {
        const values = existing ? state.registry[existing]! : undefined;
        const name = values
          ? Object.keys(values).find((n) => n.toLowerCase() === mutation.name.toLowerCase())
          : undefined;
        if (!values || name === undefined) {
          throw new Error(`setRegistryValue found no value to delete: ${full}\\${mutation.name}`);
        }
        delete values[name];
      } else {
        const values = (state.registry[existing ?? full] ??= {});
        const name =
          Object.keys(values).find((n) => n.toLowerCase() === mutation.name.toLowerCase()) ??
          mutation.name;
        values[name] = mutation.value as RegistryValue;
      }
      break;
    }
    case 'removeRegistryKey': {
      const full = registryKeyPath(mutation.hive, mutation.key).toLowerCase();
      const doomed = Object.keys(state.registry).filter(
        (k) => k.toLowerCase() === full || k.toLowerCase().startsWith(`${full}\\`)
      );
      if (doomed.length === 0) throw new Error(`removeRegistryKey matched no key: ${full}`);
      for (const key of doomed) delete state.registry[key];
      break;
    }
    case 'setService': {
      const index = state.services.findIndex(
        (s) => s.name.toLowerCase() === mutation.name.toLowerCase()
      );
      if (mutation.state === 'absent') {
        if (index < 0) throw new Error(`setService matched no service: ${mutation.name}`);
        state.services.splice(index, 1);
        break;
      }
      const service: ServiceInfo = {
        name: index >= 0 ? state.services[index]!.name : mutation.name,
        displayName:
          mutation.displayName ?? (index >= 0 ? state.services[index]!.displayName : mutation.name),
        state: mutation.state,
      };
      if (mutation.state === 'running') {
        service.pid = (index >= 0 ? state.services[index]!.pid : undefined) ?? 4242;
      }
      if (index >= 0) state.services[index] = service;
      else state.services.push(service);
      break;
    }
    case 'hideDevice': {
      const devices = state.devices.filter((d) => matchesDevice(d, mutation.match));
      if (devices.length === 0) {
        throw new Error(`hideDevice matched no device: ${JSON.stringify(mutation.match)}`);
      }
      for (const device of devices) {
        const known = state.hidHide.gaming
          .flatMap((g) => g.devices)
          .filter(
            (d) =>
              d.baseContainerDeviceInstancePath.toUpperCase() === device.instanceId.toUpperCase()
          )
          .map((d) => d.deviceInstancePath);
        // A device HidHide did not list as a gaming device still has a HID node of this shape.
        const paths =
          known.length > 0
            ? known
            : [
                `HID\\VID_${device.vendorId}&PID_${device.productId}\\${device.instanceId.split('\\').pop()}`,
              ];
        for (const p of paths) if (!state.hidHide.hidden.includes(p)) state.hidHide.hidden.push(p);
      }
      state.hidHide.installed = true;
      if (mutation.cloak) state.hidHide.cloak = true;
      break;
    }
    case 'setHidHide': {
      if (mutation.installed !== undefined) state.hidHide.installed = mutation.installed;
      if (mutation.cloak !== undefined) state.hidHide.cloak = mutation.cloak;
      if (mutation.inverse !== undefined) state.hidHide.inverse = mutation.inverse;
      if (mutation.apps !== undefined) state.hidHide.apps = [...mutation.apps];
      break;
    }
    case 'plugDisplay': {
      const display = {
        ...structuredClone(mutation.display),
        id: mutation.display.id.toLowerCase(),
      };
      if (state.displays.some((d) => d.id === display.id)) {
        throw new Error(`plugDisplay: ${display.id} is already connected`);
      }
      // As Windows: a new main display takes over from the one that was.
      if (display.enabled && display.primary) {
        for (const other of state.displays) other.primary = false;
      }
      state.displays.push(display);
      break;
    }
  }
}

/** Applies the state mutations to a copy of the state. File mutations are skipped (see seedScenario). */
export function applyMutations(state: RigState, mutations: Mutation[]): RigState {
  const next: RigState = structuredClone(state);
  for (const mutation of mutations) {
    if (!isFileMutation(mutation)) mutateState(next, mutation);
  }
  return next;
}
